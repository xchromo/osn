import { expect, it } from "@effect/vitest";
import { eventRsvps, pulseUsers } from "@pulse/db/schema";
import { Db } from "@pulse/db/service";
import { Effect } from "effect";

import {
  DiscoveryValidationError,
  discoverEvents,
  type DiscoveryLookups,
} from "../../src/services/discovery";
import { createTestLayer, seedEvent } from "../helpers/db";

const FUTURE = (msOffset: number) => new Date(Date.now() + msOffset).toISOString();
const PAST = "2020-01-01T10:00:00.000Z";

// Helpers
const rsvp = (
  eventId: string,
  profileId: string,
  status: "going" | "interested" | "invited" = "going",
) =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    yield* Effect.promise(() =>
      db.insert(eventRsvps).values({
        id: `rsvp_${eventId}_${profileId}`,
        eventId,
        profileId,
        status,
        createdAt: new Date(),
      }),
    );
  });

const setAttendanceVisibility = (profileId: string, v: "connections" | "no_one") =>
  Effect.gen(function* () {
    const { db } = yield* Db;
    const now = new Date();
    yield* Effect.promise(() =>
      db
        .insert(pulseUsers)
        .values({ profileId, attendanceVisibility: v, createdAt: now, updatedAt: now }),
    );
  });

const stubLookups = (connectionIds: string[] = []): DiscoveryLookups => ({
  getConnectionIds: () => Effect.succeed(new Set(connectionIds)),
});

const provide = <A, E>(effect: Effect.Effect<A, E, Db>) =>
  effect.pipe(Effect.provide(createTestLayer()));

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

it.effect("surfaces public events to anonymous viewers", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Public", startTime: FUTURE(60_000), visibility: "public" });
      const result = yield* discoverEvents({}, null, stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Public"]);
    }),
  ),
);

it.effect("hides private events from anonymous viewers", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Secret", startTime: FUTURE(60_000), visibility: "private" });
      const result = yield* discoverEvents({}, null, stubLookups());
      expect(result.events).toEqual([]);
    }),
  ),
);

it.effect("surfaces private events to the organiser", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({
        title: "Mine",
        startTime: FUTURE(60_000),
        visibility: "private",
        createdByProfileId: "usr_alice",
      });
      const result = yield* discoverEvents({}, "usr_alice", stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Mine"]);
    }),
  ),
);

it.effect("surfaces private events to invited viewers (RSVP row)", () =>
  provide(
    Effect.gen(function* () {
      const event = yield* seedEvent({
        title: "Invite-only",
        startTime: FUTURE(60_000),
        visibility: "private",
        createdByProfileId: "usr_alice",
      });
      yield* rsvp(event.id, "usr_bob", "invited");
      const result = yield* discoverEvents({}, "usr_bob", stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Invite-only"]);
    }),
  ),
);

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

it.effect("filters by category", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Show", startTime: FUTURE(60_000), category: "music" });
      yield* seedEvent({ title: "Game", startTime: FUTURE(60_000), category: "sports" });
      const result = yield* discoverEvents({ category: "music" }, null, stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Show"]);
    }),
  ),
);

it.effect("excludes past events by default (from >= now)", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Future", startTime: FUTURE(60_000) });
      yield* seedEvent({ title: "Past", startTime: PAST });
      const result = yield* discoverEvents({}, null, stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Future"]);
    }),
  ),
);

it.effect("honours an explicit from/to window", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Near", startTime: FUTURE(60_000) });
      yield* seedEvent({ title: "Far", startTime: FUTURE(365 * 24 * 60 * 60_000) });
      const result = yield* discoverEvents({ to: FUTURE(24 * 60 * 60_000) }, null, stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Near"]);
    }),
  ),
);

it.effect("excludes finished and cancelled events", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Live", startTime: FUTURE(60_000), status: "upcoming" });
      yield* seedEvent({ title: "Dead", startTime: FUTURE(60_000), status: "cancelled" });
      yield* seedEvent({ title: "Done", startTime: FUTURE(60_000), status: "finished" });
      const result = yield* discoverEvents({}, null, stubLookups());
      expect(result.events.map((e) => e.title).toSorted()).toEqual(["Live"]);
    }),
  ),
);

// ---------------------------------------------------------------------------
// Location (bbox + haversine)
// ---------------------------------------------------------------------------

it.effect("bbox + haversine drops events outside the radius", () =>
  provide(
    Effect.gen(function* () {
      // London (51.5074, -0.1278) — inside a 50km radius of London.
      yield* seedEvent({
        title: "London",
        startTime: FUTURE(60_000),
        latitude: 51.5074,
        longitude: -0.1278,
      });
      // Paris (48.8566, 2.3522) — ~344km away, outside a 50km radius.
      yield* seedEvent({
        title: "Paris",
        startTime: FUTURE(60_000),
        latitude: 48.8566,
        longitude: 2.3522,
      });
      const result = yield* discoverEvents(
        { lat: 51.5074, lng: -0.1278, radiusKm: 50 },
        null,
        stubLookups(),
      );
      expect(result.events.map((e) => e.title)).toEqual(["London"]);
    }),
  ),
);

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

it.effect("friendsOnly surfaces events organised by a connection", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({
        title: "Friend's party",
        startTime: FUTURE(60_000),
        createdByProfileId: "usr_friend",
      });
      yield* seedEvent({
        title: "Stranger's party",
        startTime: FUTURE(60_000),
        createdByProfileId: "usr_stranger",
      });
      const result = yield* discoverEvents(
        { friendsOnly: true },
        "usr_alice",
        stubLookups(["usr_friend"]),
      );
      expect(result.events.map((e) => e.title)).toEqual(["Friend's party"]);
    }),
  ),
);

it.effect("friendsOnly surfaces events RSVPed by a connection", () =>
  provide(
    Effect.gen(function* () {
      const event = yield* seedEvent({
        title: "Friend is going",
        startTime: FUTURE(60_000),
        createdByProfileId: "usr_stranger",
      });
      yield* rsvp(event.id, "usr_friend", "going");
      yield* seedEvent({
        title: "Strangers only",
        startTime: FUTURE(60_000),
        createdByProfileId: "usr_stranger",
      });
      const result = yield* discoverEvents(
        { friendsOnly: true },
        "usr_alice",
        stubLookups(["usr_friend"]),
      );
      expect(result.events.map((e) => e.title)).toEqual(["Friend is going"]);
    }),
  ),
);

it.effect("friendsOnly hides RSVPs from users with attendanceVisibility=no_one", () =>
  provide(
    Effect.gen(function* () {
      const event = yield* seedEvent({
        title: "Hidden friend",
        startTime: FUTURE(60_000),
        createdByProfileId: "usr_stranger",
      });
      yield* rsvp(event.id, "usr_friend", "going");
      yield* setAttendanceVisibility("usr_friend", "no_one");
      const result = yield* discoverEvents(
        { friendsOnly: true },
        "usr_alice",
        stubLookups(["usr_friend"]),
      );
      expect(result.events).toEqual([]);
    }),
  ),
);

it.effect("friendsOnly includes RSVPs from users with default attendanceVisibility", () =>
  provide(
    Effect.gen(function* () {
      const event = yield* seedEvent({
        title: "Default visibility",
        startTime: FUTURE(60_000),
        createdByProfileId: "usr_stranger",
      });
      yield* rsvp(event.id, "usr_friend", "going");
      // No pulseUsers row → default "connections" via COALESCE.
      const result = yield* discoverEvents(
        { friendsOnly: true },
        "usr_alice",
        stubLookups(["usr_friend"]),
      );
      expect(result.events.map((e) => e.title)).toEqual(["Default visibility"]);
    }),
  ),
);

it.effect("friendsOnly short-circuits when viewer has no connections", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({
        title: "Solo",
        startTime: FUTURE(60_000),
        createdByProfileId: "usr_stranger",
      });
      const result = yield* discoverEvents({ friendsOnly: true }, "usr_alice", stubLookups([]));
      expect(result.events).toEqual([]);
    }),
  ),
);

it.effect("friendsOnly requires a viewer", () =>
  provide(
    Effect.gen(function* () {
      const err = yield* Effect.flip(
        discoverEvents({ friendsOnly: true }, null, stubLookups(["usr_friend"])),
      );
      expect(err).toBeInstanceOf(DiscoveryValidationError);
    }),
  ),
);

it.effect("friendsOnly excludes the viewer's own RSVPs as a signal", () =>
  provide(
    Effect.gen(function* () {
      const event = yield* seedEvent({
        title: "My own RSVP",
        startTime: FUTURE(60_000),
        createdByProfileId: "usr_stranger",
      });
      yield* rsvp(event.id, "usr_alice", "going");
      // Viewer is alice; her RSVP should not count as a friend signal
      // (connection set does not include her).
      const result = yield* discoverEvents(
        { friendsOnly: true },
        "usr_alice",
        stubLookups(["usr_other"]),
      );
      expect(result.events).toEqual([]);
    }),
  ),
);

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

it.effect("filters by priceMax in the given currency", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({
        title: "Cheap",
        startTime: FUTURE(60_000),
        priceAmount: 500,
        priceCurrency: "USD",
      });
      yield* seedEvent({
        title: "Pricey",
        startTime: FUTURE(60_000),
        priceAmount: 10_000,
        priceCurrency: "USD",
      });
      const result = yield* discoverEvents({ priceMax: 50, currency: "USD" }, null, stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Cheap"]);
    }),
  ),
);

it.effect("priceMax includes free (null-priced) events", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Free", startTime: FUTURE(60_000) });
      yield* seedEvent({
        title: "Paid",
        startTime: FUTURE(60_000),
        priceAmount: 500,
        priceCurrency: "USD",
      });
      const result = yield* discoverEvents({ priceMax: 10, currency: "USD" }, null, stubLookups());
      expect(result.events.map((e) => e.title).toSorted()).toEqual(["Free", "Paid"]);
    }),
  ),
);

it.effect("priceMax=0 returns only free events", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Free", startTime: FUTURE(60_000) });
      yield* seedEvent({
        title: "Paid",
        startTime: FUTURE(60_000),
        priceAmount: 500,
        priceCurrency: "USD",
      });
      const result = yield* discoverEvents({ priceMax: 0, currency: "USD" }, null, stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Free"]);
    }),
  ),
);

it.effect("priceMin excludes free (null-priced) events", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({ title: "Free", startTime: FUTURE(60_000) });
      yield* seedEvent({
        title: "Paid",
        startTime: FUTURE(60_000),
        priceAmount: 2000,
        priceCurrency: "USD",
      });
      const result = yield* discoverEvents({ priceMin: 10, currency: "USD" }, null, stubLookups());
      expect(result.events.map((e) => e.title)).toEqual(["Paid"]);
    }),
  ),
);

it.effect("price filter excludes events in other currencies", () =>
  provide(
    Effect.gen(function* () {
      yield* seedEvent({
        title: "USD event",
        startTime: FUTURE(60_000),
        priceAmount: 1000,
        priceCurrency: "USD",
      });
      yield* seedEvent({
        title: "EUR event",
        startTime: FUTURE(60_000),
        priceAmount: 1000,
        priceCurrency: "EUR",
      });
      const result = yield* discoverEvents(
        { priceMin: 5, priceMax: 20, currency: "USD" },
        null,
        stubLookups(),
      );
      expect(result.events.map((e) => e.title)).toEqual(["USD event"]);
    }),
  ),
);

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

it.effect("returns a stable cursor and paginates without gaps", () =>
  provide(
    Effect.gen(function* () {
      const titles = ["A", "B", "C", "D", "E"];
      for (let i = 0; i < titles.length; i++) {
        yield* seedEvent({
          title: titles[i]!,
          startTime: FUTURE(60_000 + i * 60_000),
        });
      }
      const first = yield* discoverEvents({ limit: 2 }, null, stubLookups());
      expect(first.events.map((e) => e.title)).toEqual(["A", "B"]);
      expect(first.nextCursor).not.toBeNull();

      const second = yield* discoverEvents(
        {
          limit: 2,
          cursorStartTime: first.nextCursor!.startTime,
          cursorId: first.nextCursor!.id,
        },
        null,
        stubLookups(),
      );
      expect(second.events.map((e) => e.title)).toEqual(["C", "D"]);

      const third = yield* discoverEvents(
        {
          limit: 2,
          cursorStartTime: second.nextCursor!.startTime,
          cursorId: second.nextCursor!.id,
        },
        null,
        stubLookups(),
      );
      expect(third.events.map((e) => e.title)).toEqual(["E"]);
      // Last page still returns a cursor; caller stops when events.length < limit.
    }),
  ),
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

it.effect("rejects lat without lng/radiusKm", () =>
  provide(
    Effect.gen(function* () {
      const err = yield* Effect.flip(discoverEvents({ lat: 51.5 }, null, stubLookups()));
      expect(err).toBeInstanceOf(DiscoveryValidationError);
    }),
  ),
);

it.effect("rejects priceMin without currency", () =>
  provide(
    Effect.gen(function* () {
      const err = yield* Effect.flip(discoverEvents({ priceMin: 10 }, null, stubLookups()));
      expect(err).toBeInstanceOf(DiscoveryValidationError);
    }),
  ),
);

it.effect("rejects priceMin > priceMax", () =>
  provide(
    Effect.gen(function* () {
      const err = yield* Effect.flip(
        discoverEvents({ priceMin: 50, priceMax: 10, currency: "USD" }, null, stubLookups()),
      );
      expect(err).toBeInstanceOf(DiscoveryValidationError);
    }),
  ),
);

it.effect("rejects partial cursor (startTime without id)", () =>
  provide(
    Effect.gen(function* () {
      const err = yield* Effect.flip(
        discoverEvents({ cursorStartTime: FUTURE(60_000) }, null, stubLookups()),
      );
      expect(err).toBeInstanceOf(DiscoveryValidationError);
    }),
  ),
);
