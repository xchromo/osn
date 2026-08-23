import { describe, expect, it } from "bun:test";

import {
  BOOTSTRAP_WEDDING_ID,
  families,
  registryContributions,
  registryItems,
  registrySettings,
  weddings,
} from "@cire/db";
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

/**
 * A seeded household of the bootstrap wedding. Read from the database rather
 * than hardcoded: the seed mints family ids as uuids, so the only honest way to
 * name one is to look it up.
 */
const ITEM_ID = "reg_pan";

function buildApp({ secret = SECRET as string | null } = {}) {
  const db = createDb(":memory:");
  seedDb(db);
  const now = new Date();
  db.insert(registryItems)
    .values({
      id: ITEM_ID,
      weddingId: BOOTSTRAP_WEDDING_ID,
      kind: "product",
      title: "Copper pan",
      quantityWanted: 1,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
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
  const familyId = db.select({ id: families.id }).from(families).get()?.id as string;
  const app = createApp(db, { stripeWebhookSecret: secret });
  return { app, db, familyId };
}
type App = ReturnType<typeof buildApp>["app"];

const accountUpdated = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "evt_1",
    type: "account.updated",
    created: nowSeconds(),
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

  /**
   * S-H1. Stripe does not guarantee delivery order and retries a failed
   * delivery for three days, so an older event carrying `charges_enabled: true`
   * can arrive AFTER Stripe has disabled the account. This column is the only
   * gate on whether a couple may show guests a contribute button, so applying
   * it would re-open a payment surface Stripe has shut.
   */
  it("refuses an event older than what the row already holds", async () => {
    const { app, db } = buildApp();
    const late = nowSeconds();

    // What Stripe said most recently: the account can no longer charge.
    await deliver(
      app,
      JSON.stringify({
        id: "evt_disable",
        type: "account.updated",
        created: late,
        account: ACCOUNT,
        data: { object: { id: ACCOUNT, charges_enabled: false, payouts_enabled: false } },
      }),
    );
    expect((await settings(db))?.stripeChargesEnabled).toBe(false);

    // An OLDER delivery, retried into the window, saying the opposite.
    const res = await deliver(
      app,
      JSON.stringify({
        id: "evt_enable",
        type: "account.updated",
        created: late - 120,
        account: ACCOUNT,
        data: { object: { id: ACCOUNT, charges_enabled: true, payouts_enabled: true } },
      }),
    );

    // Acknowledged — Stripe must not retry it — but not applied.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, matched: false });
    expect((await settings(db))?.stripeChargesEnabled).toBe(false);
  });

  it("applies an event newer than what the row holds", async () => {
    const { app, db } = buildApp();
    const first = nowSeconds() - 300;
    await deliver(
      app,
      JSON.stringify({
        id: "evt_old",
        type: "account.updated",
        created: first,
        account: ACCOUNT,
        data: { object: { id: ACCOUNT, charges_enabled: false, payouts_enabled: false } },
      }),
    );
    await deliver(app, accountUpdated());
    expect((await settings(db))?.stripeChargesEnabled).toBe(true);
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

const CONTRIBUTION_ID = "rct_1";

/**
 * The `pending` row a completed session settles. The route writes this BEFORE
 * handing the guest a payment page — see `createPendingContribution` — so a
 * webhook with nothing to settle is a session cire never created.
 */
function seedPending(
  db: ReturnType<typeof buildApp>["db"],
  familyId: string,
  over: { id?: string; sessionId?: string; weddingId?: string; status?: string } = {},
) {
  const now = new Date();
  db.insert(registryContributions)
    .values({
      id: over.id ?? CONTRIBUTION_ID,
      weddingId: over.weddingId ?? BOOTSTRAP_WEDDING_ID,
      itemId: null,
      familyId,
      status: (over.status ?? "pending") as "pending",
      amountMinor: 12_500,
      currency: "AUD",
      stripeCheckoutSessionId: over.sessionId ?? "cs_1",
      stripePaymentIntentId: null,
      message: "Enjoy Japan",
      displayName: "The Ashworths",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

const checkoutCompleted = (
  overrides: {
    account?: string | null;
    session?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  } = {},
) =>
  JSON.stringify({
    id: "evt_gift",
    type: "checkout.session.completed",
    created: nowSeconds(),
    account: overrides.account === undefined ? ACCOUNT : overrides.account,
    data: {
      object: {
        id: "cs_1",
        payment_intent: "pi_1",
        payment_status: "paid",
        metadata: { contributionId: CONTRIBUTION_ID, ...overrides.metadata },
        ...overrides.session,
      },
    },
  });

async function gifts(db: ReturnType<typeof buildApp>["db"]) {
  return db.select().from(registryContributions).all();
}

describe("checkout.session.completed — settling the row, never inventing one", () => {
  it("settles the pending gift the route wrote", async () => {
    const { app, db, familyId } = buildApp();
    seedPending(db, familyId);

    const res = await deliver(app, checkoutCompleted());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "settled" });
    const [gift] = await gifts(db);
    expect(gift?.status).toBe("succeeded");
    expect(gift?.stripePaymentIntentId).toBe("pi_1");
    // The note and the name were never in Stripe's metadata — they are on the
    // row because we put them there (C-H2).
    expect(gift?.message).toBe("Enjoy Japan");
    expect(gift?.displayName).toBe("The Ashworths");
    // FX stays null: the primary-currency equivalent comes from the balance
    // transaction, which is not on this event, and the columns are
    // all-or-nothing.
    expect(gift?.primaryAmountMinor).toBeNull();
    expect(gift?.fxRate).toBeNull();
  });

  it("settles once however many times Stripe delivers it", async () => {
    // At-least-once delivery makes a duplicate the ordinary case, not the edge.
    const { app, db, familyId } = buildApp();
    seedPending(db, familyId);
    const payload = checkoutCompleted();

    expect(await (await deliver(app, payload)).json()).toEqual({
      received: true,
      outcome: "settled",
    });
    expect(await (await deliver(app, payload)).json()).toEqual({
      received: true,
      outcome: "duplicate",
    });
    expect(await gifts(db)).toHaveLength(1);
  });

  it("leaves an unpaid-but-complete session pending, not as money that arrived", async () => {
    const { app, db, familyId } = buildApp();
    seedPending(db, familyId);
    await deliver(app, checkoutCompleted({ session: { payment_status: "unpaid" } }));
    expect((await gifts(db))[0]?.status).toBe("pending");
  });

  /**
   * THE FORGERY CASE (S-M1). This endpoint also hears about sessions a
   * connected account created for ITSELF, where every metadata field is
   * whatever its owner typed. Settling against a row we wrote is what makes
   * that worthless: there is no row, and one cannot be conjured from the event.
   */
  it("writes nothing for a session cire never created", async () => {
    const { app, db } = buildApp();
    const res = await deliver(
      app,
      checkoutCompleted({ metadata: { contributionId: "rct_forged" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "unknown" });
    expect(await gifts(db)).toHaveLength(0);
  });

  it("refuses a gift whose wedding does not own the account it came from", async () => {
    const { app, db, familyId } = buildApp();
    seedPending(db, familyId);
    const res = await deliver(app, checkoutCompleted({ account: "acct_someone_else" }));
    expect(await res.json()).toEqual({ received: true, outcome: "rejected" });
    expect((await gifts(db))[0]?.status).toBe("pending");
  });

  it("refuses a settlement aimed at another session", async () => {
    // One contribution cannot be settled by a different session's event.
    const { app, db, familyId } = buildApp();
    seedPending(db, familyId, { sessionId: "cs_other" });
    const res = await deliver(app, checkoutCompleted());
    expect(await res.json()).toEqual({ received: true, outcome: "rejected" });
    expect((await gifts(db))[0]?.status).toBe("pending");
  });

  it("acknowledges a completed session carrying none of our metadata", async () => {
    const { app, db } = buildApp();
    const payload = JSON.stringify({
      id: "evt_x",
      type: "checkout.session.completed",
      created: nowSeconds(),
      account: ACCOUNT,
      data: { object: { id: "cs_9", metadata: {} } },
    });
    const res = await deliver(app, payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "unknown" });
    expect(await gifts(db)).toHaveLength(0);
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
