import { expect, it } from "@effect/vitest";
import { eventLineup, events, venues } from "@pulse/db/schema";
import { Db } from "@pulse/db/service";
import { Effect } from "effect";

import { getVenue, listEventLineup, listVenueEvents } from "../../src/services/venues";
import { createTestLayer } from "../helpers/db";

const provide = <A, E>(effect: Effect.Effect<A, E, Db>) =>
  effect.pipe(Effect.provide(createTestLayer()));

const future = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000);

const seedVenue = Effect.gen(function* () {
  const { db } = yield* Db;
  const now = new Date();
  yield* Effect.promise(() =>
    db.insert(venues).values({
      id: "the-club",
      name: "The Club",
      kind: "club",
      timezone: "Europe/London",
      createdAt: now,
      updatedAt: now,
    }),
  );
});

const seedEvent = (
  id: string,
  overrides: { startTime: Date; venueId: string | null; visibility?: "public" | "private" },
) =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const now = new Date();
    yield* Effect.promise(() =>
      db.insert(events).values({
        id,
        title: id,
        startTime: overrides.startTime,
        venueId: overrides.venueId,
        visibility: overrides.visibility ?? "public",
        createdByProfileId: "usr_alice",
        createdAt: now,
        updatedAt: now,
      }),
    );
  });

const seedSlot = (eventId: string, artistName: string, slotStart: Date, slotEnd: Date, i: number) =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    yield* Effect.promise(() =>
      db.insert(eventLineup).values({
        id: `lnp_${eventId}_${i}`,
        eventId,
        artistName,
        role: "support",
        slotStart,
        slotEnd,
        orderIndex: i,
        createdAt: new Date(),
      }),
    );
  });

// ---------------------------------------------------------------------------
// getVenue
// ---------------------------------------------------------------------------

it.effect("getVenue returns the row when it exists", () =>
  provide(
    Effect.gen(function* () {
      yield* seedVenue;
      const row = yield* getVenue("the-club");
      expect(row.id).toBe("the-club");
      expect(row.name).toBe("The Club");
      expect(row.kind).toBe("club");
    }),
  ),
);

it.effect("getVenue fails with VenueNotFound for unknown id", () =>
  provide(
    Effect.gen(function* () {
      const err = yield* Effect.flip(getVenue("does-not-exist"));
      expect(err._tag).toBe("VenueNotFound");
    }),
  ),
);

// ---------------------------------------------------------------------------
// listVenueEvents
// ---------------------------------------------------------------------------

it.effect("listVenueEvents defaults to upcoming + only returns the venue's events", () =>
  provide(
    Effect.gen(function* () {
      yield* seedVenue;
      yield* seedEvent("evt_a", { startTime: future(1), venueId: "the-club" });
      yield* seedEvent("evt_b", { startTime: future(3), venueId: "the-club" });
      yield* seedEvent("evt_other", { startTime: future(2), venueId: null });

      const list = yield* listVenueEvents("the-club");
      expect(list.map((e) => e.id).toSorted()).toEqual(["evt_a", "evt_b"]);
    }),
  ),
);

it.effect("listVenueEvents excludes private events", () =>
  provide(
    Effect.gen(function* () {
      yield* seedVenue;
      yield* seedEvent("evt_pub", { startTime: future(1), venueId: "the-club" });
      yield* seedEvent("evt_priv", {
        startTime: future(2),
        venueId: "the-club",
        visibility: "private",
      });
      const list = yield* listVenueEvents("the-club");
      expect(list.map((e) => e.id)).toEqual(["evt_pub"]);
    }),
  ),
);

it.effect("listVenueEvents scope=past returns finished events", () =>
  provide(
    Effect.gen(function* () {
      yield* seedVenue;
      yield* seedEvent("evt_old", { startTime: future(-7), venueId: "the-club" });
      yield* seedEvent("evt_new", { startTime: future(1), venueId: "the-club" });
      const past = yield* listVenueEvents("the-club", { scope: "past" });
      expect(past.map((e) => e.id)).toEqual(["evt_old"]);
    }),
  ),
);

it.effect("listVenueEvents fails with VenueNotFound for unknown id", () =>
  provide(
    Effect.gen(function* () {
      const err = yield* Effect.flip(listVenueEvents("does-not-exist"));
      expect(err._tag).toBe("VenueNotFound");
    }),
  ),
);

// ---------------------------------------------------------------------------
// listEventLineup
// ---------------------------------------------------------------------------

it.effect("listEventLineup orders slots by slotStart asc", () =>
  provide(
    Effect.gen(function* () {
      yield* seedVenue;
      yield* seedEvent("evt_lineup", { startTime: future(1), venueId: "the-club" });
      yield* seedSlot(
        "evt_lineup",
        "Late",
        new Date("2030-06-08T01:00:00.000Z"),
        new Date("2030-06-08T02:30:00.000Z"),
        2,
      );
      yield* seedSlot(
        "evt_lineup",
        "Opener",
        new Date("2030-06-07T22:00:00.000Z"),
        new Date("2030-06-07T23:30:00.000Z"),
        0,
      );
      yield* seedSlot(
        "evt_lineup",
        "Mid",
        new Date("2030-06-07T23:30:00.000Z"),
        new Date("2030-06-08T01:00:00.000Z"),
        1,
      );

      const list = yield* listEventLineup("evt_lineup");
      expect(list.map((s) => s.artistName)).toEqual(["Opener", "Mid", "Late"]);
    }),
  ),
);

it.effect("listEventLineup returns an empty array when there are no slots", () =>
  provide(
    Effect.gen(function* () {
      yield* seedVenue;
      yield* seedEvent("evt_blank", { startTime: future(1), venueId: "the-club" });
      const list = yield* listEventLineup("evt_blank");
      expect(list).toEqual([]);
    }),
  ),
);
