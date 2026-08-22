import { describe, expect, it } from "bun:test";

import { BOOTSTRAP_WEDDING_ID, registrySettings } from "@cire/db";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { createDb, seedDb } from "../db/setup";
import { WEBHOOK_TOLERANCE_SECONDS } from "../services/stripe";
import { appRequest } from "../test-helpers";

/**
 * Stripe's own deliveries.
 *
 * The endpoint has no other authentication: the signature IS the authentication.
 * So what is asserted here is mostly what it REFUSES — an unsigned body, one
 * signed with the wrong secret, one that was changed after signing, and one
 * replayed from outside the tolerance window. Each of those, if accepted, turns
 * this route into an unauthenticated write API against the rows that record
 * money.
 *
 * And one thing it must NOT refuse: an event type this product does not handle.
 * The endpoint belongs to the platform account, not to this feature, and a
 * non-2xx there buys days of Stripe retries for an event nobody was going to act
 * on.
 */

const SECRET = "whsec_test";
const ACCOUNT = "acct_connected";
/** Real seconds: the route signs against its own clock, and should. */
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildApp({ secret = SECRET as string | null } = {}) {
  const db = createDb(":memory:");
  seedDb(db);
  const now = new Date();
  // A wedding whose registry already knows its connected account.
  db.insert(registrySettings)
    .values({
      weddingId: BOOTSTRAP_WEDDING_ID,
      published: true,
      cashGiftsEnabled: false,
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const app = createApp(db, { stripeWebhookSecret: secret });
  return { app, db };
}
type App = ReturnType<typeof buildApp>["app"];

const accountUpdated = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "evt_1",
    type: "account.updated",
    data: {
      object: {
        id: ACCOUNT,
        charges_enabled: true,
        payouts_enabled: true,
        ...overrides,
      },
    },
  });

async function deliver(
  app: App,
  payload: string,
  options: { secret?: string; at?: number; header?: string | null } = {},
): Promise<Response> {
  const at = options.at ?? nowSeconds();
  const header =
    options.header === undefined
      ? `t=${at},v1=${await hmacHex(options.secret ?? SECRET, `${at}.${payload}`)}`
      : options.header;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== null) headers["stripe-signature"] = header;
  return appRequest(app, "/api/stripe/webhook", { method: "POST", headers, body: payload });
}

async function settings(db: ReturnType<typeof buildApp>["db"]) {
  return db
    .select()
    .from(registrySettings)
    .where(eq(registrySettings.weddingId, BOOTSTRAP_WEDDING_ID))
    .get();
}

describe("the endpoint exists only when it can be verified", () => {
  it("is not mounted at all without a signing secret", async () => {
    // Nothing else authenticates it. An endpoint that takes unverified bodies
    // and writes rows is an unauthenticated write API.
    const { app } = buildApp({ secret: null });
    const res = await deliver(app, accountUpdated());
    expect(res.status).toBe(404);
  });
});

describe("what it refuses", () => {
  it("refuses a body nobody signed", async () => {
    const { app, db } = buildApp();
    const res = await deliver(app, accountUpdated(), { header: null });
    expect(res.status).toBe(400);
    expect((await res.json()) as { reason: string }).toEqual({
      error: "invalid_signature",
      reason: "malformed",
    });
    expect((await settings(db))?.stripeChargesEnabled).toBe(false);
  });

  it("refuses a signature from another secret", async () => {
    const { app, db } = buildApp();
    const res = await deliver(app, accountUpdated(), { secret: "whsec_attacker" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe("no-match");
    expect((await settings(db))?.stripeChargesEnabled).toBe(false);
  });

  it("refuses a body changed after it was signed", async () => {
    const { app, db } = buildApp();
    const signed = accountUpdated();
    const at = nowSeconds();
    const header = `t=${at},v1=${await hmacHex(SECRET, `${at}.${signed}`)}`;
    const res = await deliver(app, accountUpdated({ id: "acct_someone_else" }), { header });
    expect(res.status).toBe(400);
    expect((await settings(db))?.stripeChargesEnabled).toBe(false);
  });

  it("refuses a replay from outside the tolerance window", async () => {
    // A valid signature is valid forever; the window is what stops a captured
    // delivery being replayed months later.
    const { app, db } = buildApp();
    const res = await deliver(app, accountUpdated(), {
      at: nowSeconds() - WEBHOOK_TOLERANCE_SECONDS - 60,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe("too-old");
    expect((await settings(db))?.stripeChargesEnabled).toBe(false);
  });
});

describe("account.updated", () => {
  it("caches what Stripe says the account can do", async () => {
    const { app, db } = buildApp();
    const res = await deliver(app, accountUpdated());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, matched: true });

    const row = await settings(db);
    expect(row?.stripeChargesEnabled).toBe(true);
    expect(row?.stripePayoutsEnabled).toBe(true);
    expect(row?.stripeAccountUpdatedAt).not.toBeNull();
  });

  it("never touches the couple's own intent", async () => {
    const { app, db } = buildApp();
    // The couple had turned cash gifts on; Stripe then withdrew the capability.
    await db
      .update(registrySettings)
      .set({ cashGiftsEnabled: true, stripeChargesEnabled: true })
      .where(eq(registrySettings.weddingId, BOOTSTRAP_WEDDING_ID));

    await deliver(app, accountUpdated({ charges_enabled: false, payouts_enabled: false }));

    const row = await settings(db);
    expect(row?.stripeChargesEnabled).toBe(false);
    // Their decision survives. Clearing it would quietly turn the feature off
    // for good; setting it back when the capability returns would be us making
    // a decision they never made. The guest surface reads both columns.
    expect(row?.cashGiftsEnabled).toBe(true);
    expect(row?.published).toBe(true);
  });

  it("acknowledges an account this platform knows nothing about", async () => {
    const { app } = buildApp();
    const res = await deliver(app, accountUpdated({ id: "acct_stranger" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, matched: false });
  });

  it("acknowledges a signed event whose object is not an account", async () => {
    const { app } = buildApp();
    const payload = JSON.stringify({ id: "evt_2", type: "account.updated", data: { object: {} } });
    const res = await deliver(app, payload);
    expect(res.status).toBe(200);
  });
});

describe("events this product does not handle", () => {
  it("acknowledges them rather than buying days of retries", async () => {
    const { app, db } = buildApp();
    const payload = JSON.stringify({
      id: "evt_3",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1" } },
    });
    const res = await deliver(app, payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect((await settings(db))?.stripeChargesEnabled).toBe(false);
  });
});
