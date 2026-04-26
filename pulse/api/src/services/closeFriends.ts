import { pulseCloseFriends } from "@pulse/db/schema";
import { Db } from "@pulse/db/service";
import { and, eq, inArray } from "drizzle-orm";
import { Data, Effect } from "effect";

import {
  metricCloseFriendAdded,
  metricCloseFriendRemoved,
  metricCloseFriendsBatchSize,
  metricCloseFriendsListed,
} from "../metrics";
import { getConnectionIds, GraphBridgeError } from "./graphBridge";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CloseFriendNotFound extends Data.TaggedError("CloseFriendNotFound")<{
  readonly profileId: string;
  readonly friendId: string;
}> {}

export class NotEligibleForCloseFriend extends Data.TaggedError("NotEligibleForCloseFriend")<{
  readonly reason: "self" | "not_a_connection";
}> {}

export class DatabaseError extends Data.TaggedError("CloseFriendDatabaseError")<{
  readonly cause: unknown;
}> {}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on `IN (...)` parameter counts to stay well under SQLite's variable limit. */
const MAX_BATCH_SIZE = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const genId = (): string => "pcf_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mark `friendId` as a close friend of `profileId`. Eligibility:
 *   - the two profiles must be different
 *   - they must already be connected in the OSN core graph (verified
 *     via `graphBridge.getConnectionIds`)
 *
 * Idempotent: a duplicate insert is a no-op (the unique pair index
 * collapses it). The `Duplicate` outcome is reported via the metric
 * but not surfaced as an error to the caller — the post-state is the
 * same regardless.
 */
export const addCloseFriend = (
  profileId: string,
  friendId: string,
): Effect.Effect<void, NotEligibleForCloseFriend | GraphBridgeError | DatabaseError, Db> =>
  Effect.gen(function* () {
    if (profileId === friendId) {
      metricCloseFriendAdded("self");
      return yield* Effect.fail(new NotEligibleForCloseFriend({ reason: "self" }));
    }

    const connections = yield* getConnectionIds(profileId);
    if (!connections.has(friendId)) {
      metricCloseFriendAdded("not_eligible");
      return yield* Effect.fail(new NotEligibleForCloseFriend({ reason: "not_a_connection" }));
    }

    const { db } = yield* Db;
    const before = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ _: pulseCloseFriends.id })
          .from(pulseCloseFriends)
          .where(
            and(
              eq(pulseCloseFriends.profileId, profileId),
              eq(pulseCloseFriends.friendId, friendId),
            ),
          )
          .limit(1),
      catch: (cause) => new DatabaseError({ cause }),
    });

    if (before.length > 0) {
      metricCloseFriendAdded("duplicate");
      return;
    }

    yield* Effect.tryPromise({
      try: () =>
        db
          .insert(pulseCloseFriends)
          .values({ id: genId(), profileId, friendId, createdAt: new Date() })
          .onConflictDoNothing(),
      catch: (cause) => new DatabaseError({ cause }),
    });
    metricCloseFriendAdded("ok");
  }).pipe(Effect.withSpan("pulse.closeFriends.add"));

/**
 * Remove `friendId` from `profileId`'s close-friends list. Fails with
 * `CloseFriendNotFound` when no row exists; this lets the route map to
 * a 404 cleanly.
 */
export const removeCloseFriend = (
  profileId: string,
  friendId: string,
): Effect.Effect<void, CloseFriendNotFound | DatabaseError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: pulseCloseFriends.id })
          .from(pulseCloseFriends)
          .where(
            and(
              eq(pulseCloseFriends.profileId, profileId),
              eq(pulseCloseFriends.friendId, friendId),
            ),
          )
          .limit(1),
      catch: (cause) => new DatabaseError({ cause }),
    });
    if (rows.length === 0) {
      metricCloseFriendRemoved("not_found");
      return yield* Effect.fail(new CloseFriendNotFound({ profileId, friendId }));
    }
    yield* Effect.tryPromise({
      try: () => db.delete(pulseCloseFriends).where(eq(pulseCloseFriends.id, rows[0]!.id)),
      catch: (cause) => new DatabaseError({ cause }),
    });
    metricCloseFriendRemoved("ok");
  }).pipe(Effect.withSpan("pulse.closeFriends.remove"));

/**
 * Return the friendIds in `profileId`'s close-friends list. The caller
 * owns the join with profile display metadata — this service stays
 * focused on the local table.
 */
export const listCloseFriendIds = (profileId: string): Effect.Effect<string[], DatabaseError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ friendId: pulseCloseFriends.friendId })
          .from(pulseCloseFriends)
          .where(eq(pulseCloseFriends.profileId, profileId)),
      catch: (cause) => new DatabaseError({ cause }),
    });
    const ids = rows.map((r) => r.friendId);
    metricCloseFriendsListed(ids.length);
    return ids;
  }).pipe(Effect.withSpan("pulse.closeFriends.list"));

/**
 * Directional check: has `profileId` marked `friendId` as a close friend?
 * Pure Pulse-side lookup; never delegates to OSN.
 */
export const isCloseFriendOf = (
  profileId: string,
  friendId: string,
): Effect.Effect<boolean, DatabaseError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ _: pulseCloseFriends.id })
          .from(pulseCloseFriends)
          .where(
            and(
              eq(pulseCloseFriends.profileId, profileId),
              eq(pulseCloseFriends.friendId, friendId),
            ),
          )
          .limit(1),
      catch: (cause) => new DatabaseError({ cause }),
    });
    return rows.length > 0;
  }).pipe(Effect.withSpan("pulse.closeFriends.check"));

/**
 * Reverse batch lookup. Given a viewer and a set of attendee profile IDs,
 * return the subset of attendees who have marked `viewerId` as a close
 * friend. Used by the RSVP service to stamp the `isCloseFriend` display
 * flag without N round-trips.
 *
 * Always clamped to `MAX_BATCH_SIZE` to stay within SQLite's variable
 * limit and prevent a malicious caller from blowing up the query.
 */
export const getCloseFriendsOfBatch = (
  viewerId: string,
  profileIds: readonly string[],
): Effect.Effect<Set<string>, DatabaseError, Db> =>
  Effect.gen(function* () {
    metricCloseFriendsBatchSize(profileIds.length);
    if (profileIds.length === 0) return new Set<string>();
    const clamped =
      profileIds.length > MAX_BATCH_SIZE ? profileIds.slice(0, MAX_BATCH_SIZE) : profileIds;
    const { db } = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ profileId: pulseCloseFriends.profileId })
          .from(pulseCloseFriends)
          .where(
            and(
              eq(pulseCloseFriends.friendId, viewerId),
              inArray(pulseCloseFriends.profileId, [...clamped]),
            ),
          ),
      catch: (cause) => new DatabaseError({ cause }),
    });
    return new Set(rows.map((r) => r.profileId));
  }).pipe(Effect.withSpan("pulse.closeFriends.batch_of"));

/**
 * Convenience wrapper for the feed-ranking path: returns the viewer's
 * close-friends list as a `Set` for O(1) "is the organiser a close
 * friend?" lookups during `events.list`.
 */
export const getCloseFriendIdsForViewer = (
  viewerId: string,
): Effect.Effect<Set<string>, DatabaseError, Db> =>
  Effect.gen(function* () {
    const ids = yield* listCloseFriendIds(viewerId);
    return new Set(ids);
  }).pipe(Effect.withSpan("pulse.closeFriends.ids_for_viewer"));
