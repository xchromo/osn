import { it, expect, describe } from "@effect/vitest";
import {
  events,
  eventComms,
  eventRsvps,
  pulseCloseFriends,
  pulseDeletionJobs,
  pulseUsers,
} from "@pulse/db/schema";
import { Db } from "@pulse/db/service";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import * as accountErasure from "../../src/services/accountErasure";
import { createTestLayer, seedEvent } from "../helpers/db";

const ACCOUNT_ID = "acc_pulse_test_account";
const PROFILE_ID = "usr_pulse_test_profile";

const seedPulseData = (): Effect.Effect<{ eventId: string }, never, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const event = yield* seedEvent({
      title: "Hosted",
      startTime: new Date(Date.now() + 86_400_000),
      createdByProfileId: PROFILE_ID,
    });
    yield* Effect.promise(() =>
      db.insert(eventRsvps).values({
        id: "rsvp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        eventId: event.id,
        profileId: PROFILE_ID,
        status: "going",
      }),
    );
    yield* Effect.promise(() =>
      db.insert(pulseCloseFriends).values({
        id: "pcf_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        profileId: PROFILE_ID,
        friendId: "usr_friend_one",
      }),
    );
    yield* Effect.promise(() =>
      db.insert(eventComms).values({
        id: "evtcomm_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        eventId: event.id,
        channel: "email",
        body: "hello",
        sentByProfileId: PROFILE_ID,
        sentAt: new Date(),
      }),
    );
    yield* Effect.promise(() =>
      db.insert(pulseUsers).values({ profileId: PROFILE_ID, attendanceVisibility: "connections" }),
    );
    return { eventId: event.id };
  });

describe("pulse account-erasure: requestErasure", () => {
  it.effect("hard-deletes personal Pulse data + flips hosted events into cancellation window", () =>
    Effect.gen(function* () {
      yield* seedPulseData();
      const result = yield* accountErasure.requestErasure({
        profileId: PROFILE_ID,
        accountId: ACCOUNT_ID,
      });
      expect(result.newlyScheduled).toBe(true);

      const { db } = yield* Db;
      // RSVPs gone.
      const rsvps = yield* Effect.promise(() =>
        db.select().from(eventRsvps).where(eq(eventRsvps.profileId, PROFILE_ID)),
      );
      expect(rsvps).toHaveLength(0);
      // Close-friends gone.
      const cf = yield* Effect.promise(() =>
        db.select().from(pulseCloseFriends).where(eq(pulseCloseFriends.profileId, PROFILE_ID)),
      );
      expect(cf).toHaveLength(0);
      // Comms gone.
      const cm = yield* Effect.promise(() =>
        db.select().from(eventComms).where(eq(eventComms.sentByProfileId, PROFILE_ID)),
      );
      expect(cm).toHaveLength(0);
      // pulse_users gone.
      const pu = yield* Effect.promise(() =>
        db.select().from(pulseUsers).where(eq(pulseUsers.profileId, PROFILE_ID)),
      );
      expect(pu).toHaveLength(0);
      // Hosted events still exist but flipped to cancelled.
      const ev = yield* Effect.promise(() =>
        db.select().from(events).where(eq(events.createdByProfileId, PROFILE_ID)),
      );
      expect(ev).toHaveLength(1);
      expect(ev[0].status).toBe("cancelled");
      expect(ev[0].cancelledAt).not.toBeNull();
      expect(ev[0].cancellationReason).toBe("host_left");
      expect(ev[0].hardDeleteAt).not.toBeNull();
      // Job row exists with 7-day window.
      const jobs = yield* Effect.promise(() =>
        db.select().from(pulseDeletionJobs).where(eq(pulseDeletionJobs.profileId, PROFILE_ID)),
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0].accountId).toBe(ACCOUNT_ID);
      expect(jobs[0].enrollmentNotifyDoneAt).toBeNull();
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("idempotent — second call returns the original schedule", () =>
    Effect.gen(function* () {
      yield* seedPulseData();
      const a = yield* accountErasure.requestErasure({
        profileId: PROFILE_ID,
        accountId: ACCOUNT_ID,
      });
      const b = yield* accountErasure.requestErasure({
        profileId: PROFILE_ID,
        accountId: ACCOUNT_ID,
      });
      expect(b.newlyScheduled).toBe(false);
      expect(b.scheduledFor).toBe(a.scheduledFor);
    }).pipe(Effect.provide(createTestLayer())),
  );
});

describe("pulse account-erasure: purgeAccount (full-account fan-out)", () => {
  it.effect("hard-deletes hosted events + all personal data with no grace window", () =>
    Effect.gen(function* () {
      yield* seedPulseData();
      const result = yield* accountErasure.purgeAccount(ACCOUNT_ID, [PROFILE_ID]);
      expect(result.purged).toBe(1);
      const { db } = yield* Db;
      const remaining = yield* Effect.promise(() =>
        db.select().from(events).where(eq(events.createdByProfileId, PROFILE_ID)),
      );
      expect(remaining).toHaveLength(0);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("idempotent on empty profileIds", () =>
    Effect.gen(function* () {
      const r = yield* accountErasure.purgeAccount(ACCOUNT_ID, []);
      expect(r.purged).toBe(0);
    }).pipe(Effect.provide(createTestLayer())),
  );
});

describe("pulse account-erasure: cancellation + sweepers", () => {
  it.effect("cancelErasure restores cancelled events still inside their window", () =>
    Effect.gen(function* () {
      yield* seedPulseData();
      yield* accountErasure.requestErasure({ profileId: PROFILE_ID, accountId: ACCOUNT_ID });
      const cancelled = yield* accountErasure.cancelErasure(PROFILE_ID);
      expect(cancelled.cancelled).toBe(true);
      const { db } = yield* Db;
      const ev = yield* Effect.promise(() =>
        db.select().from(events).where(eq(events.createdByProfileId, PROFILE_ID)),
      );
      expect(ev[0].cancelledAt).toBeNull();
      expect(ev[0].status).toBe("upcoming");
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("hard-delete sweeper removes deletion-jobs past the grace window", () =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      yield* Effect.promise(() =>
        db.insert(pulseDeletionJobs).values({
          profileId: PROFILE_ID,
          accountId: ACCOUNT_ID,
          softDeletedAt: 1_000,
          hardDeleteAt: 2_000,
          enrollmentNotifyDoneAt: 1_500,
          reason: "user_request",
        }),
      );
      const r = yield* accountErasure.runHardDeleteSweep({ nowMs: 5_000_000 });
      expect(r.purged).toBe(1);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("event-cancellation sweeper hard-deletes events past hardDeleteAt", () =>
    Effect.gen(function* () {
      yield* seedPulseData();
      const { db } = yield* Db;
      // Manually flip the event into cancelled state with a hard-delete in the past.
      yield* Effect.promise(() =>
        db
          .update(events)
          .set({ cancelledAt: 1_000, hardDeleteAt: 2_000, cancellationReason: "host_left" })
          .where(eq(events.createdByProfileId, PROFILE_ID)),
      );
      const r = yield* accountErasure.runEventCancellationSweep({ nowMs: 5_000_000 });
      expect(r.purged).toBe(1);
      const remaining = yield* Effect.promise(() =>
        db.select().from(events).where(eq(events.createdByProfileId, PROFILE_ID)),
      );
      expect(remaining).toHaveLength(0);
    }).pipe(Effect.provide(createTestLayer())),
  );
});
