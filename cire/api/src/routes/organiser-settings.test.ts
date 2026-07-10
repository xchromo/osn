import { beforeAll, describe, expect, it } from "bun:test";

import { BOOTSTRAP_WEDDING_ID, weddingHosts, weddings } from "@cire/db";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import type { Db } from "../db";
import { createDb, seedDb } from "../db/setup";
import type { Geocoder } from "../services/geocode";
import { appRequest } from "../test-helpers";
import { makeOsnTestAuth } from "../test-helpers/osn-token";
import type { OsnTestAuth } from "../test-helpers/osn-token";

const OWNER = "usr_dev_bootstrap_owner";
const CO_HOST = "usr_cohost";
const STRANGER = "usr_stranger";

let auth: OsnTestAuth;

beforeAll(async () => {
  auth = await makeOsnTestAuth();
});

const stubGeocoder: Geocoder = {
  async geocode(query: string) {
    if (query === "nowhere") return { status: "not_found" };
    if (query === "down") return { status: "unavailable" };
    return {
      status: "ok",
      point: {
        lat: -33.8688,
        lng: 151.2093,
        locality: "Sydney",
        adminArea: "NSW",
        countryCode: "AU",
        formattedAddress: "Sydney NSW, Australia",
      },
    };
  },
};

function buildApp(options: { geocoder?: Geocoder | null } = {}) {
  const db = createDb(":memory:");
  seedDb(db);
  const now = new Date();
  db.insert(weddingHosts)
    .values({
      id: "whost_1",
      weddingId: BOOTSTRAP_WEDDING_ID,
      osnProfileId: CO_HOST,
      addedByOsnProfileId: OWNER,
      role: "host",
      createdAt: now,
    })
    .run();
  db.insert(weddings)
    .values({
      id: "wed_other",
      slug: "other-wedding",
      displayName: "Other Wedding",
      ownerOsnProfileId: "usr_bob",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const app = createApp(db, { osnTestKey: auth.key, geocoder: options.geocoder });
  return { db, app };
}

type App = ReturnType<typeof buildApp>["app"];

async function req(
  app: App,
  method: string,
  path: string,
  profileId?: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (profileId) headers.Authorization = `Bearer ${await auth.sign(profileId)}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return appRequest(app, path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

const SETTINGS_PATH = `/api/organiser/weddings/${BOOTSTRAP_WEDDING_ID}/settings`;

describe("GET /api/organiser/weddings/:weddingId/settings", () => {
  it("returns 401 without a token", async () => {
    const { app } = buildApp();
    expect((await req(app, "GET", SETTINGS_PATH)).status).toBe(401);
  });

  it("returns 403 for a non-member", async () => {
    const { app } = buildApp();
    expect((await req(app, "GET", SETTINGS_PATH, STRANGER)).status).toBe(403);
  });

  it("returns 404 for an unknown wedding", async () => {
    const { app } = buildApp();
    const res = await req(app, "GET", "/api/organiser/weddings/wed_missing/settings", OWNER);
    expect(res.status).toBe(404);
  });

  it("returns the profile with defaults for the owner", async () => {
    const { app } = buildApp();
    const res = await req(app, "GET", SETTINGS_PATH, OWNER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      wedding: Record<string, unknown>;
      geocodingAvailable: boolean;
    };
    expect(body.wedding).toEqual({
      id: BOOTSTRAP_WEDDING_ID,
      slug: "cire-wedding",
      displayName: "Cire Wedding",
      weddingDate: null,
      locationName: null,
      locationLat: null,
      locationLng: null,
      pricingRegion: null,
      guestCountEstimate: null,
      currency: "AUD",
      budgetTotalMinor: null,
    });
    expect(body.geocodingAvailable).toBe(false);
  });

  it("admits a co-host and reports geocoding availability", async () => {
    const { app } = buildApp({ geocoder: stubGeocoder });
    const res = await req(app, "GET", SETTINGS_PATH, CO_HOST);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { geocodingAvailable: boolean };
    expect(body.geocodingAvailable).toBe(true);
  });
});

describe("PUT /api/organiser/weddings/:weddingId/settings", () => {
  it("returns 401 without a token", async () => {
    const { app } = buildApp();
    expect((await req(app, "PUT", SETTINGS_PATH, undefined, {})).status).toBe(401);
  });

  it("returns 403 for a co-host (settings are owner-only)", async () => {
    const { app } = buildApp();
    expect((await req(app, "PUT", SETTINGS_PATH, CO_HOST, {})).status).toBe(403);
  });

  it("returns 404 for an unknown wedding", async () => {
    const { app } = buildApp();
    const res = await req(app, "PUT", "/api/organiser/weddings/wed_missing/settings", OWNER, {});
    expect(res.status).toBe(404);
  });

  it("saves a full profile and persists it", async () => {
    const { app, db } = buildApp();
    const res = await req(app, "PUT", SETTINGS_PATH, OWNER, {
      displayName: "  Aisha & Ben  ",
      weddingDate: "2027-03-20",
      locationName: "Sydney NSW",
      locationLat: -33.8688,
      locationLng: 151.2093,
      pricingRegion: "au-nsw",
      guestCountEstimate: 120,
      currency: "AUD",
      budgetTotalMinor: 4_500_000,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wedding: { displayName: string; weddingDate: string } };
    expect(body.wedding.displayName).toBe("Aisha & Ben");
    expect(body.wedding.weddingDate).toBe("2027-03-20");

    const row = getWedding(db);
    expect(row.weddingDate).toBe("2027-03-20");
    expect(row.locationLat).toBe(-33.8688);
    expect(row.pricingRegion).toBe("au-nsw");
    expect(row.budgetTotalMinor).toBe(4_500_000);
  });

  it("patches only the provided fields", async () => {
    const { app, db } = buildApp();
    await req(app, "PUT", SETTINGS_PATH, OWNER, { weddingDate: "2027-03-20" });
    const res = await req(app, "PUT", SETTINGS_PATH, OWNER, { guestCountEstimate: 80 });
    expect(res.status).toBe(200);
    const row = getWedding(db);
    expect(row.weddingDate).toBe("2027-03-20");
    expect(row.guestCountEstimate).toBe(80);
    expect(row.displayName).toBe("Cire Wedding");
  });

  it("clears a nullable field with an explicit null", async () => {
    const { app, db } = buildApp();
    await req(app, "PUT", SETTINGS_PATH, OWNER, { weddingDate: "2027-03-20" });
    const res = await req(app, "PUT", SETTINGS_PATH, OWNER, { weddingDate: null });
    expect(res.status).toBe(200);
    expect(getWedding(db).weddingDate).toBeNull();
  });

  it("renames the slug and 409s a collision", async () => {
    const { app, db } = buildApp();
    const ok = await req(app, "PUT", SETTINGS_PATH, OWNER, { slug: "aisha-and-ben" });
    expect(ok.status).toBe(200);
    expect(getWedding(db).slug).toBe("aisha-and-ben");

    const clash = await req(app, "PUT", SETTINGS_PATH, OWNER, { slug: "other-wedding" });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: string }).error).toBe("slug_taken");
    // The failed rename must not have moved the slug.
    expect(getWedding(db).slug).toBe("aisha-and-ben");
  });

  it("keeps the same slug idempotently (no self-collision)", async () => {
    const { app } = buildApp();
    const res = await req(app, "PUT", SETTINGS_PATH, OWNER, { slug: "cire-wedding" });
    expect(res.status).toBe(200);
  });

  it("400s malformed JSON, bad shapes, and impossible dates", async () => {
    const { app } = buildApp();
    const rawRes = await appRequest(app, SETTINGS_PATH, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${await auth.sign(OWNER)}`,
        "Content-Type": "application/json",
      },
      body: "{not json",
    });
    expect(rawRes.status).toBe(400);

    for (const bad of [
      { weddingDate: "20-03-2027" },
      { weddingDate: "2027-02-31" },
      { slug: "Bad Slug!" },
      { currency: "dollars" },
      { locationLat: 123 },
      { guestCountEstimate: 2.5 },
      { pricingRegion: "au-sydney" },
      { budgetTotalMinor: -1 },
      { displayName: "   " },
    ]) {
      const res = await req(app, "PUT", SETTINGS_PATH, OWNER, bad);
      expect(res.status).toBe(400);
    }
  });

  it("rejects a merged half-coordinate (lat without lng)", async () => {
    const { app } = buildApp();
    const res = await req(app, "PUT", SETTINGS_PATH, OWNER, { locationLat: -33.8 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("location_point_incomplete");

    // …and clearing one half of a stored pair is equally incomplete.
    await req(app, "PUT", SETTINGS_PATH, OWNER, { locationLat: -33.8, locationLng: 151.2 });
    const clear = await req(app, "PUT", SETTINGS_PATH, OWNER, { locationLng: null });
    expect(clear.status).toBe(400);
  });
});

describe("POST /api/organiser/weddings/:weddingId/settings/geocode", () => {
  const GEOCODE_PATH = `${SETTINGS_PATH}/geocode`;

  it("returns 401 without a token", async () => {
    const { app } = buildApp();
    expect((await req(app, "POST", GEOCODE_PATH, undefined, { query: "Sydney" })).status).toBe(401);
  });

  it("returns 403 for a co-host", async () => {
    const { app } = buildApp({ geocoder: stubGeocoder });
    expect((await req(app, "POST", GEOCODE_PATH, CO_HOST, { query: "Sydney" })).status).toBe(403);
  });

  it("answers unavailable when no geocoder is configured (key-optional)", async () => {
    const { app } = buildApp();
    const res = await req(app, "POST", GEOCODE_PATH, OWNER, { query: "Sydney" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });

  it("returns the point + derived pricing region on a hit", async () => {
    const { app } = buildApp({ geocoder: stubGeocoder });
    const res = await req(app, "POST", GEOCODE_PATH, OWNER, { query: "Sydney NSW" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; pricingRegion: string };
    expect(body.status).toBe("ok");
    expect(body.pricingRegion).toBe("au-nsw");
  });

  it("passes through not_found and unavailable", async () => {
    const { app } = buildApp({ geocoder: stubGeocoder });
    expect(
      await (await req(app, "POST", GEOCODE_PATH, OWNER, { query: "nowhere" })).json(),
    ).toEqual({ status: "not_found" });
    expect(await (await req(app, "POST", GEOCODE_PATH, OWNER, { query: "down" })).json()).toEqual({
      status: "unavailable",
    });
  });

  it("400s an empty query", async () => {
    const { app } = buildApp({ geocoder: stubGeocoder });
    expect((await req(app, "POST", GEOCODE_PATH, OWNER, { query: "   " })).status).toBe(400);
  });
});

function getWedding(db: Db) {
  const row = db.select().from(weddings).where(eq(weddings.id, BOOTSTRAP_WEDDING_ID)).get();
  if (!row) throw new Error("bootstrap wedding missing");
  return row;
}
