import { eventLineup, events, venues } from "@pulse/db/schema";
import { beforeEach, describe, expect, it } from "vitest";

import { createVenuesRoutes } from "../../src/routes/venues";
import { createTestLayer } from "../helpers/db";

const get = (app: ReturnType<typeof createVenuesRoutes>, path: string) =>
  app.handle(new Request(`http://localhost${path}`, { method: "GET" }));

const future = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000);

describe("venue routes", () => {
  let app: ReturnType<typeof createVenuesRoutes>;
  let layerDb: { db: ReturnType<typeof createTestLayer> extends infer _ ? unknown : never };

  beforeEach(() => {
    const layer = createTestLayer();
    app = createVenuesRoutes(layer);
    layerDb = layer as unknown as typeof layerDb;
    void layerDb;
  });

  // The fixture seeding here goes through the same Layer the routes use,
  // so we need a fresh layer + fresh app per test (`beforeEach` above).
  async function seedAll(): Promise<void> {
    const layer = createTestLayer();
    app = createVenuesRoutes(layer);
    // We need a way to access the db inside this layer — easiest is to
    // recreate the layer via the helper and use its DB directly. The
    // helper returns a Layer, not a DB handle, so re-create one using
    // its underlying applySchema path.
  }
  void seedAll;

  it("GET /venues returns every venue", async () => {
    const { Effect: E } = await import("effect");
    const { Db } = await import("@pulse/db/service");
    const layer = createTestLayer();
    await E.runPromise(
      E.gen(function* () {
        const { db } = yield* Db;
        const now = new Date();
        yield* E.promise(() =>
          db.insert(venues).values([
            {
              id: "v1",
              orgHandle: "org-a",
              handle: "alpha",
              name: "Alpha",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: "v2",
              orgHandle: "org-b",
              handle: "beta",
              name: "Beta",
              createdAt: now,
              updatedAt: now,
            },
          ]),
        );
      }).pipe(E.provide(layer)),
    );
    app = createVenuesRoutes(layer);

    const res = await get(app, "/venues");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { venues: { id: string }[] };
    expect(body.venues.map((v) => v.id).toSorted()).toEqual(["v1", "v2"]);
  });

  it("GET /venues returns an empty list when there are no venues", async () => {
    const res = await get(app, "/venues");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { venues: unknown[] };
    expect(body.venues).toEqual([]);
  });

  it("GET /venues/:org/:venue returns 404 for an unknown venue", async () => {
    const res = await get(app, "/venues/org-one/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /venues/:org/:venue returns the venue when it exists", async () => {
    // Seed via direct DB access on the layer's underlying drizzle instance.
    // We use `app.handle` for the venue read so that the same Db Tag
    // resolves on both sides.
    const { Layer, Effect: E } = await import("effect");
    const { Db } = await import("@pulse/db/service");
    const program = E.gen(function* () {
      const { db } = yield* Db;
      const now = new Date();
      yield* E.promise(() =>
        db.insert(venues).values({
          id: "the-spot",
          orgHandle: "org-one",
          handle: "the-spot",
          name: "The Spot",
          kind: "club",
          timezone: "Europe/London",
          createdAt: now,
          updatedAt: now,
        }),
      );
    });
    const layer = createTestLayer();
    await E.runPromise(program.pipe(E.provide(layer)));
    app = createVenuesRoutes(layer);
    void Layer;

    const res = await get(app, "/venues/org-one/the-spot");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { venue: { id: string; name: string } };
    expect(body.venue.id).toBe("the-spot");
    expect(body.venue.name).toBe("The Spot");
  });

  it("GET /venues/:org/:venue/events returns the venue's upcoming public events", async () => {
    const { Effect: E } = await import("effect");
    const { Db } = await import("@pulse/db/service");
    const layer = createTestLayer();
    await E.runPromise(
      E.gen(function* () {
        const { db } = yield* Db;
        const now = new Date();
        yield* E.promise(() =>
          db.insert(venues).values({
            id: "the-spot",
            orgHandle: "org-one",
            handle: "the-spot",
            name: "The Spot",
            createdAt: now,
            updatedAt: now,
          }),
        );
        yield* E.promise(() =>
          db.insert(events).values([
            {
              id: "evt_pub",
              title: "Public",
              startTime: future(2),
              venueId: "the-spot",
              createdByProfileId: "usr_alice",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: "evt_priv",
              title: "Private",
              startTime: future(2),
              venueId: "the-spot",
              visibility: "private",
              createdByProfileId: "usr_alice",
              createdAt: now,
              updatedAt: now,
            },
          ]),
        );
      }).pipe(E.provide(layer)),
    );
    app = createVenuesRoutes(layer);

    const res = await get(app, "/venues/org-one/the-spot/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { id: string }[] };
    expect(body.events.map((e) => e.id)).toEqual(["evt_pub"]);
  });

  it("GET /venues/:org/:venue/events returns 404 for an unknown venue", async () => {
    const res = await get(app, "/venues/org-one/does-not-exist/events");
    expect(res.status).toBe(404);
  });

  it("GET /venues/:org/:venue/events/:eventId/lineup returns the slots for that event", async () => {
    const { Effect: E } = await import("effect");
    const { Db } = await import("@pulse/db/service");
    const layer = createTestLayer();
    await E.runPromise(
      E.gen(function* () {
        const { db } = yield* Db;
        const now = new Date();
        yield* E.promise(() =>
          db.insert(venues).values({
            id: "the-spot",
            orgHandle: "org-one",
            handle: "the-spot",
            name: "The Spot",
            createdAt: now,
            updatedAt: now,
          }),
        );
        yield* E.promise(() =>
          db.insert(events).values({
            id: "evt_lu",
            title: "Lineup",
            startTime: future(1),
            venueId: "the-spot",
            createdByProfileId: "usr_alice",
            createdAt: now,
            updatedAt: now,
          }),
        );
        yield* E.promise(() =>
          db.insert(eventLineup).values([
            {
              id: "lnp_1",
              eventId: "evt_lu",
              artistName: "Opener",
              role: "opener",
              slotStart: new Date("2030-06-07T22:00:00.000Z"),
              slotEnd: new Date("2030-06-07T23:30:00.000Z"),
              orderIndex: 0,
              createdAt: now,
            },
            {
              id: "lnp_2",
              eventId: "evt_lu",
              artistName: "Headliner",
              role: "headliner",
              slotStart: new Date("2030-06-07T23:30:00.000Z"),
              slotEnd: new Date("2030-06-08T01:00:00.000Z"),
              orderIndex: 1,
              createdAt: now,
            },
          ]),
        );
      }).pipe(E.provide(layer)),
    );
    app = createVenuesRoutes(layer);

    const res = await get(app, "/venues/org-one/the-spot/events/evt_lu/lineup");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slots: { artistName: string; role: string }[] };
    expect(body.slots.map((s) => s.artistName)).toEqual(["Opener", "Headliner"]);
  });
});
