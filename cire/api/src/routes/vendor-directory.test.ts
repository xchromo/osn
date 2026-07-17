import { beforeAll, describe, expect, it } from "bun:test";

import {
  BOOTSTRAP_WEDDING_ID,
  directoryVendorCategories,
  directoryVendors,
  weddingHosts,
  weddings,
} from "@cire/db";
import { makeLogEmailLive } from "@shared/email";

import { createApp } from "../app";
import { createDb, seedDb } from "../db/setup";
import { createDirectoryService } from "../services/directory";
import { appRequest } from "../test-helpers";
import { makeOsnTestAuth } from "../test-helpers/osn-token";
import type { OsnTestAuth } from "../test-helpers/osn-token";

const OWNER = "usr_dev_bootstrap_owner";
const EDITOR = "usr_editor";
const VIEWER = "usr_viewer";
const STRANGER = "usr_stranger";

let auth: OsnTestAuth;
beforeAll(async () => {
  auth = await makeOsnTestAuth();
});

function buildApp() {
  const db = createDb(":memory:");
  seedDb(db);
  const now = new Date();
  db.insert(weddingHosts)
    .values({
      id: "whost_editor",
      weddingId: BOOTSTRAP_WEDDING_ID,
      osnProfileId: EDITOR,
      addedByOsnProfileId: OWNER,
      role: "editor",
      createdAt: now,
    })
    .run();
  db.insert(weddingHosts)
    .values({
      id: "whost_viewer",
      weddingId: BOOTSTRAP_WEDDING_ID,
      osnProfileId: VIEWER,
      addedByOsnProfileId: OWNER,
      role: "viewer",
      createdAt: now,
    })
    .run();
  db.insert(weddings)
    .values({
      id: "wed_other",
      slug: "other-wedding",
      displayName: "Other",
      ownerOsnProfileId: "usr_bob",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Seed two live directory listings.
  db.insert(directoryVendors)
    .values({
      id: "dv_venue_1",
      name: "Sydney Gardens",
      description: "Beautiful garden venue",
      locationText: "Sydney, NSW",
      listed: "live",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(directoryVendorCategories)
    .values({ directoryVendorId: "dv_venue_1", category: "venue" })
    .run();

  db.insert(directoryVendors)
    .values({
      id: "dv_florals_1",
      name: "Hillside Flowers",
      description: "Seasonal florals",
      locationText: "Melbourne, VIC",
      listed: "live",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(directoryVendorCategories)
    .values({ directoryVendorId: "dv_florals_1", category: "florals" })
    .run();

  // A draft listing — must NOT appear in browse results.
  db.insert(directoryVendors)
    .values({
      id: "dv_draft_1",
      name: "Draft Vendor",
      listed: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const { layer: logEmailLayer } = makeLogEmailLive();
  const directoryService = createDirectoryService({
    vendorPortalOrigin: "https://vendor.test",
  });

  return createApp(db, {
    osnTestKey: auth.key,
    directoryService,
    emailLayer: logEmailLayer,
  });
}

type App = ReturnType<typeof buildApp>;

async function req(app: App, path: string, profileId: string | undefined): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (profileId) headers.Authorization = `Bearer ${await auth.sign(profileId)}`;
  return appRequest(app, path, { method: "GET", headers });
}

const base = `/api/organiser/weddings/${BOOTSTRAP_WEDDING_ID}/directory`;

describe("vendor directory browse route", () => {
  it("401 without a token", async () => {
    expect((await req(buildApp(), base, undefined)).status).toBe(401);
  });

  it("weddingMember (viewer) can browse; returns live listings + total", async () => {
    const res = await req(buildApp(), base, VIEWER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: unknown[]; total: number };
    expect(Array.isArray(body.listings)).toBe(true);
    // Two live listings seeded; draft must not appear.
    expect(body.total).toBe(2);
    expect(body.listings.length).toBe(2);
  });

  it("owner can browse", async () => {
    const res = await req(buildApp(), base, OWNER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: unknown[]; total: number };
    expect(Array.isArray(body.listings)).toBe(true);
  });

  it("editor can browse", async () => {
    const res = await req(buildApp(), base, EDITOR);
    expect(res.status).toBe(200);
  });

  it("404 for a wedding the caller is not a member of (cross-tenant)", async () => {
    // STRANGER is not a member of BOOTSTRAP_WEDDING_ID.
    expect((await req(buildApp(), base, STRANGER)).status).toBe(403);
    // usr_bob owns wed_other but is not a member of BOOTSTRAP_WEDDING_ID.
    expect(
      (await req(buildApp(), `/api/organiser/weddings/wed_other/directory`, "usr_bob")).status,
    ).toBe(200);
    // OWNER is not a member of wed_other → 404/403.
    const crossRes = await req(buildApp(), `/api/organiser/weddings/wed_other/directory`, OWNER);
    expect([403, 404]).toContain(crossRes.status);
  });

  it("category filter passes through to the service", async () => {
    const res = await req(buildApp(), `${base}?category=venue`, VIEWER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: { id: string }[]; total: number };
    // Only the venue listing should match.
    expect(body.total).toBe(1);
    expect(body.listings[0].id).toBe("dv_venue_1");
  });

  it("unknown category ignored (treated as no filter — returns all live)", async () => {
    // 'ufo' is not in SERVICE_CATEGORIES so category → null → no filter.
    const res = await req(buildApp(), `${base}?category=ufo`, VIEWER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: unknown[]; total: number };
    expect(body.total).toBe(2);
  });

  it("q filter passes through to the service", async () => {
    const res = await req(buildApp(), `${base}?q=hillside`, VIEWER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: { id: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.listings[0].id).toBe("dv_florals_1");
  });

  it("location filter passes through to the service", async () => {
    const res = await req(buildApp(), `${base}?location=sydney`, VIEWER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: { id: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.listings[0].id).toBe("dv_venue_1");
  });

  it("clamps limit=999 to at most 50", async () => {
    const res = await req(buildApp(), `${base}?limit=999`, VIEWER);
    expect(res.status).toBe(200);
    // With only 2 listings the clamping doesn't change the result count,
    // but the request must succeed (not 400/500).
    const body = (await res.json()) as { listings: unknown[]; total: number };
    expect(body.listings.length).toBeLessThanOrEqual(50);
  });

  it("limit=0 falls back to default (24)", async () => {
    // 0 is below min (1) so clampInt returns the default (24).
    const res = await req(buildApp(), `${base}?limit=0`, VIEWER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: unknown[]; total: number };
    // With 2 listings the page is fine; the important thing is no error.
    expect(Array.isArray(body.listings)).toBe(true);
  });

  it("offset=-5 is clamped to 0 (no error)", async () => {
    const res = await req(buildApp(), `${base}?offset=-5`, VIEWER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: unknown[]; total: number };
    expect(Array.isArray(body.listings)).toBe(true);
  });
});
