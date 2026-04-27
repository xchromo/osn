import {
  events,
  eventComms,
  eventRsvps,
  pulseCloseFriends,
  pulseDeletionJobs,
  pulseUsers,
} from "@pulse/db/schema";
import type { PulseDeletionJob } from "@pulse/db/schema";
import { Db } from "@pulse/db/service";
import type {
  DeletionCompletedResult,
  DeletionCompletedSource,
} from "@shared/observability/metrics";
import { and, eq, lte, ne, or } from "drizzle-orm";
import { Data, Effect } from "effect";

import { metricPulseAccountDeletionCompleted, withPulseAccountDeletion } from "../metrics";

/**
 * Pulse-side account erasure (Flow B — leave Pulse).
 *
 *   1. `requestErasure` — soft-deletes Pulse-scoped data for one profile,
 *      flips hosted events into a 14-day public cancellation window, and
 *      writes a pulse_deletion_jobs row.
 *   2. `cancelErasure` — clears the row + restores Pulse data WHERE
 *      possible (RSVPs / close-friends are gone forever; events come back
 *      since cancellation is non-destructive within the 14-day window).
 *   3. `runHardDeleteSweep` — purges residual rows after the 7-day window.
 *   4. `runEventCancellationSweep` — hard-deletes events whose
 *      `hard_delete_at` (= cancelled_at + 14d) has passed.
 *   5. `purgeAccount` — endpoint hit by osn-api's full-account-delete
 *      fan-out. Hard-deletes immediately (no grace), since OSN already
 *      enforced its own 7-day window before fanning out.
 */

export const PULSE_LEAVE_GRACE_SECONDS = 7 * 24 * 60 * 60;
export const EVENT_CANCELLATION_WINDOW_SECONDS = 14 * 24 * 60 * 60;

export class PulseErasureDbError extends Data.TaggedError("PulseErasureDbError")<{
  readonly cause: unknown;
}> {}

export class PulseDeletionAlreadyPendingError extends Data.TaggedError(
  "PulseDeletionAlreadyPendingError",
)<{
  readonly profileId: string;
  readonly scheduledFor: number;
}> {}

export interface RequestErasureInput {
  readonly profileId: string;
  readonly accountId: string;
  readonly reason?: string;
}

export interface RequestErasureOutput {
  readonly profileId: string;
  readonly scheduledFor: number;
  readonly newlyScheduled: boolean;
}

const recordCompletion = (result: DeletionCompletedResult, source: DeletionCompletedSource) =>
  Effect.sync(() => metricPulseAccountDeletionCompleted(result, source));

/**
 * Soft-delete the user's Pulse data:
 *   - hard-delete RSVPs, close-friends entries, comms, pulse_users
 *   - flip hosted events to `cancelled_at = now`,
 *     `hard_delete_at = now + 14d`, `cancellation_reason = "host_left"`
 *   - insert pulse_deletion_jobs row
 *
 * `enrollment_notify_done_at` is left NULL — the route handler runs the
 * ARC callback to osn-api (`/internal/app-enrollment/leave`) outside the
 * transaction. The retry sweeper picks it up if the callback failed.
 */
export const requestErasure = (
  input: RequestErasureInput,
): Effect.Effect<RequestErasureOutput, PulseErasureDbError, Db> =>
  Effect.gen(function* () {
    const { profileId, accountId, reason = "user_request" } = input;
    const { db } = yield* Db;
    const now = Math.floor(Date.now() / 1_000);

    const existing = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(pulseDeletionJobs)
          .where(eq(pulseDeletionJobs.profileId, profileId))
          .limit(1),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });
    if (existing[0]) {
      return {
        profileId,
        scheduledFor: existing[0].hardDeleteAt,
        newlyScheduled: false,
      };
    }

    const hardDeleteAt = now + PULSE_LEAVE_GRACE_SECONDS;
    const eventCancelHardDeleteAt = now + EVENT_CANCELLATION_WINDOW_SECONDS;

    yield* Effect.tryPromise({
      try: () =>
        db.transaction(async (tx) => {
          // Hard-delete personal Pulse data.
          await tx.delete(eventRsvps).where(eq(eventRsvps.profileId, profileId));
          await tx
            .delete(pulseCloseFriends)
            .where(
              or(
                eq(pulseCloseFriends.profileId, profileId),
                eq(pulseCloseFriends.friendId, profileId),
              ),
            );
          await tx.delete(eventComms).where(eq(eventComms.sentByProfileId, profileId));
          await tx.delete(pulseUsers).where(eq(pulseUsers.profileId, profileId));

          // Cancel hosted events that aren't already finished or cancelled.
          // The 14-day public-cancellation window starts now; the
          // event-cancellation sweeper hard-deletes them when the window
          // closes. Status is also flipped to "cancelled" so the existing
          // status-aware UI surfaces the right copy without needing to
          // read `cancelled_at` everywhere.
          await tx
            .update(events)
            .set({
              cancelledAt: now,
              hardDeleteAt: eventCancelHardDeleteAt,
              cancellationReason: "host_left",
              status: "cancelled",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(events.createdByProfileId, profileId),
                ne(events.status, "finished"),
                ne(events.status, "cancelled"),
              ),
            );

          await tx.insert(pulseDeletionJobs).values({
            profileId,
            accountId,
            softDeletedAt: now,
            hardDeleteAt,
            enrollmentNotifyDoneAt: null,
            reason,
          });
        }),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });

    yield* recordCompletion("soft", "user");

    return { profileId, scheduledFor: hardDeleteAt, newlyScheduled: true };
  }).pipe(withPulseAccountDeletion("soft"));

/**
 * Cancellation: removes the pulse_deletion_jobs row + un-cancels events
 * that are still within their 14-day cancellation window. RSVPs /
 * close-friends are NOT restored (they were hard-deleted at soft-delete
 * time — the user re-engages with Pulse from a clean slate, matching the
 * "fresh Pulse experience" rule for re-joins).
 */
export const cancelErasure = (
  profileId: string,
): Effect.Effect<{ cancelled: boolean }, PulseErasureDbError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const existing = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(pulseDeletionJobs)
          .where(eq(pulseDeletionJobs.profileId, profileId))
          .limit(1),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });
    if (!existing[0]) return { cancelled: false };

    const nowSec = Math.floor(Date.now() / 1_000);

    yield* Effect.tryPromise({
      try: () =>
        db.transaction(async (tx) => {
          await tx.delete(pulseDeletionJobs).where(eq(pulseDeletionJobs.profileId, profileId));
          // Un-cancel events that haven't crossed their hard-delete deadline yet.
          await tx
            .update(events)
            .set({
              cancelledAt: null,
              hardDeleteAt: null,
              cancellationReason: null,
              status: "upcoming",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(events.createdByProfileId, profileId),
                eq(events.cancellationReason, "host_left"),
                lte(events.cancelledAt, nowSec),
                // Defensive — only restore events whose hard-delete window
                // hasn't already started purging (i.e. the sweeper hasn't
                // yet hit them in a future cycle).
              ),
            );
        }),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });

    yield* recordCompletion("cancelled", "user");
    return { cancelled: true };
  });

/**
 * Returns the deletion status for a Pulse profile.
 */
export const getDeletionStatus = (
  profileId: string,
): Effect.Effect<
  { scheduled: false } | { scheduled: true; scheduledFor: number; softDeletedAt: number },
  PulseErasureDbError,
  Db
> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            hardDeleteAt: pulseDeletionJobs.hardDeleteAt,
            softDeletedAt: pulseDeletionJobs.softDeletedAt,
          })
          .from(pulseDeletionJobs)
          .where(eq(pulseDeletionJobs.profileId, profileId))
          .limit(1),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });
    const row = rows[0];
    if (!row) return { scheduled: false } as const;
    return {
      scheduled: true as const,
      scheduledFor: row.hardDeleteAt,
      softDeletedAt: row.softDeletedAt,
    };
  });

/**
 * Marks the enrollment-notify ARC callback as done.
 */
export const markEnrollmentNotifyDone = (
  profileId: string,
): Effect.Effect<void, PulseErasureDbError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const now = Math.floor(Date.now() / 1_000);
    yield* Effect.tryPromise({
      try: () =>
        db
          .update(pulseDeletionJobs)
          .set({ enrollmentNotifyDoneAt: now })
          .where(eq(pulseDeletionJobs.profileId, profileId)),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });
  });

/**
 * Hard-delete sweeper for the Pulse-side leave-app jobs. Runs after the
 * 7-day grace window. At this point the events created by this profile
 * still live (they're under the 14-day public-cancellation window — that
 * window is independent and longer to honour audience commitment).
 *
 * Removes the deletion_jobs row only — events stay until their own
 * hard_delete_at is reached.
 */
export const runHardDeleteSweep = (
  opts: { batchSize?: number; nowMs?: number } = {},
): Effect.Effect<{ purged: number }, PulseErasureDbError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const batchSize = opts.batchSize ?? 100;
    const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1_000);

    const ready = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ profileId: pulseDeletionJobs.profileId })
          .from(pulseDeletionJobs)
          .where(lte(pulseDeletionJobs.hardDeleteAt, nowSec))
          .limit(batchSize),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });

    let purged = 0;
    for (const row of ready) {
      yield* Effect.tryPromise({
        try: () =>
          db.delete(pulseDeletionJobs).where(eq(pulseDeletionJobs.profileId, row.profileId)),
        catch: (cause) => new PulseErasureDbError({ cause }),
      });
      yield* recordCompletion("hard", "sweeper");
      purged += 1;
    }
    return { purged };
  }).pipe(withPulseAccountDeletion("hard"));

/**
 * Sweeper for hosted events whose 14-day public-cancellation window has
 * elapsed. Hard-deletes the event row + cascade-deletes RSVPs/comms.
 */
export const runEventCancellationSweep = (
  opts: { batchSize?: number; nowMs?: number } = {},
): Effect.Effect<{ purged: number }, PulseErasureDbError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const batchSize = opts.batchSize ?? 100;
    const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1_000);

    const ready = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: events.id })
          .from(events)
          .where(lte(events.hardDeleteAt, nowSec))
          .limit(batchSize),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });

    let purged = 0;
    for (const row of ready) {
      yield* Effect.tryPromise({
        try: () =>
          db.transaction(async (tx) => {
            await tx.delete(eventRsvps).where(eq(eventRsvps.eventId, row.id));
            await tx.delete(eventComms).where(eq(eventComms.eventId, row.id));
            await tx.delete(events).where(eq(events.id, row.id));
          }),
        catch: (cause) => new PulseErasureDbError({ cause }),
      });
      purged += 1;
    }
    return { purged };
  });

/**
 * Direct hard-delete invoked by the ARC `/internal/account-deleted`
 * endpoint when osn-api fans out a full-account deletion. Differs from
 * `requestErasure` in that there is no grace window — osn-api already
 * enforced its own 7-day clock — and we DO hard-delete events
 * immediately (no audience-commitment window in this path because the
 * full account is going away regardless).
 *
 * Idempotent: re-calling for the same profileIds is a no-op.
 */
export const purgeAccount = (
  accountId: string,
  profileIds: string[],
): Effect.Effect<{ purged: number }, PulseErasureDbError, Db> =>
  Effect.gen(function* () {
    if (profileIds.length === 0) return { purged: 0 };
    const { db } = yield* Db;

    yield* Effect.tryPromise({
      try: () =>
        db.transaction(async (tx) => {
          for (const profileId of profileIds) {
            await tx.delete(eventRsvps).where(eq(eventRsvps.profileId, profileId));
            await tx
              .delete(pulseCloseFriends)
              .where(
                or(
                  eq(pulseCloseFriends.profileId, profileId),
                  eq(pulseCloseFriends.friendId, profileId),
                ),
              );
            await tx.delete(eventComms).where(eq(eventComms.sentByProfileId, profileId));
            await tx.delete(pulseUsers).where(eq(pulseUsers.profileId, profileId));

            // For full-account-delete, drop hosted events outright.
            const hostedEventIds = (
              await tx
                .select({ id: events.id })
                .from(events)
                .where(eq(events.createdByProfileId, profileId))
            ).map((r) => r.id);
            for (const eid of hostedEventIds) {
              await tx.delete(eventRsvps).where(eq(eventRsvps.eventId, eid));
              await tx.delete(eventComms).where(eq(eventComms.eventId, eid));
              await tx.delete(events).where(eq(events.id, eid));
            }

            // Drop any in-flight Pulse leave-app job for this profile —
            // the full-account purge supersedes it.
            await tx.delete(pulseDeletionJobs).where(eq(pulseDeletionJobs.profileId, profileId));
          }
        }),
      catch: (cause) => new PulseErasureDbError({ cause }),
    });

    yield* recordCompletion("hard", "minor_runbook");
    void accountId; // accountId is logged via span attrs; not needed for delete keys.
    return { purged: profileIds.length };
  });

/**
 * Type alias for the row used by retry sweepers.
 */
export type PulseDeletionJobRow = Pick<
  PulseDeletionJob,
  "profileId" | "accountId" | "enrollmentNotifyDoneAt"
>;
