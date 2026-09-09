/**
 * Route-level pins on the `osn-recovery` audience.
 *
 * The service-level tests prove `verifyAccessToken` rejects the audience. These
 * prove the rejection actually reaches the wire at every route that could turn a
 * restricted session into something more, and that the two routes which DO
 * accept it accept it for the right reason.
 *
 * Every test carries an ordinary-access-token control, because a 401 is also
 * what a broken harness returns.
 *
 * See `wiki/architecture/account-recovery-factors.md` §B.
 */

import { passkeys } from "@osn/db/schema";
import type { Db } from "@osn/db/service";
import { Effect } from "effect";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

import { createGraphRoutes } from "../../src/routes/graph";
import { createOrganisationRoutes } from "../../src/routes/organisation";
import { createRecommendationRoutes } from "../../src/routes/recommendations";
import { createAuthService } from "../../src/services/auth";
import { makeTestAuthConfig } from "../helpers/auth-config";
import { createTestLayerWithSqlite } from "../helpers/db";
// Wrapped factory (trust XFF under app.handle). See helpers/routes.
import { createAuthRoutes } from "../helpers/routes";

let config: Awaited<ReturnType<typeof makeTestAuthConfig>>;

beforeAll(async () => {
  config = await makeTestAuthConfig();
});

describe("the osn-recovery audience at the route boundary", () => {
  let layer: ReturnType<typeof createTestLayerWithSqlite>["layer"];
  let db: ReturnType<typeof createTestLayerWithSqlite>["db"];
  let auth: ReturnType<typeof createAuthService>;
  let authApp: ReturnType<typeof createAuthRoutes>;
  let graphApp: ReturnType<typeof createGraphRoutes>;
  let orgApp: ReturnType<typeof createOrganisationRoutes>;
  let recsApp: ReturnType<typeof createRecommendationRoutes>;

  beforeEach(() => {
    const harness = createTestLayerWithSqlite();
    layer = harness.layer;
    db = harness.db;
    auth = createAuthService(config);
    authApp = createAuthRoutes(config, layer);
    graphApp = createGraphRoutes(config, layer);
    orgApp = createOrganisationRoutes(config, layer);
    recsApp = createRecommendationRoutes(config, layer);
  });

  const runWithLayer = <A>(eff: Effect.Effect<A, unknown, Db>): Promise<A> =>
    Effect.runPromise(eff.pipe(Effect.provide(layer)) as Effect.Effect<A, never, never>);

  /** An account holding both kinds of token, so every test has its own control. */
  async function tokensFor(email: string, handle: string) {
    const user = await runWithLayer(auth.registerProfile(email, handle));
    const ordinary = await runWithLayer(
      auth.issueTokens(user.id, user.accountId, user.email, user.handle, user.displayName),
    );
    const restricted = await runWithLayer(
      auth.issueRecoverySession(user.id, user.accountId, user.email, user.handle, user.displayName),
    );
    return { user, ordinary: ordinary.accessToken, restricted: restricted.accessToken };
  }

  // ---------------------------------------------------------------------------
  // The three routes that call `verifyAccessToken` directly rather than through
  // `resolveAccessTokenPrincipal`. Each is its own copy of the check, so each
  // is its own way to fail open.
  // ---------------------------------------------------------------------------

  it("graph refuses a recovery bearer", async () => {
    const { ordinary, restricted } = await tokensFor("ra-graph@example.com", "ragraph");
    const url = "http://localhost/graph/connections";

    const refused = await graphApp.handle(
      new Request(url, { headers: { Authorization: `Bearer ${restricted}` } }),
    );
    expect(refused.status).toBe(401);

    const allowed = await graphApp.handle(
      new Request(url, { headers: { Authorization: `Bearer ${ordinary}` } }),
    );
    expect(allowed.status).toBe(200);
  });

  it("organisation refuses a recovery bearer", async () => {
    const { ordinary, restricted } = await tokensFor("ra-org@example.com", "raorg");
    const url = "http://localhost/organisations";

    const refused = await orgApp.handle(
      new Request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${restricted}`, "Content-Type": "application/json" },
        body: JSON.stringify({ handle: "ra_org_one", name: "Org One" }),
      }),
    );
    expect(refused.status).toBe(401);

    const allowed = await orgApp.handle(
      new Request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ordinary}`, "Content-Type": "application/json" },
        body: JSON.stringify({ handle: "ra_org_two", name: "Org Two" }),
      }),
    );
    expect(allowed.status).toBe(201);
  });

  it("recommendations refuses a recovery bearer", async () => {
    const { ordinary, restricted } = await tokensFor("ra-recs@example.com", "rarecs");
    const url = "http://localhost/recommendations/connections";

    const refused = await recsApp.handle(
      new Request(url, { headers: { Authorization: `Bearer ${restricted}` } }),
    );
    expect(refused.status).toBe(401);

    const allowed = await recsApp.handle(
      new Request(url, { headers: { Authorization: `Bearer ${ordinary}` } }),
    );
    expect(allowed.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // The two routes that re-mint. These matter most: both turn one credential
  // into another, so accepting the recovery audience at either would launder a
  // restricted session into a full one in a single call.
  // ---------------------------------------------------------------------------

  it("POST /profiles/switch refuses a recovery bearer", async () => {
    // It mints a fresh access token on the ORDINARY audience from whatever
    // token authenticated the call — so this gate is the only thing between a
    // recovery token and a full one.
    const { user, ordinary, restricted } = await tokensFor("ra-switch@example.com", "raswitch");
    const body = JSON.stringify({ profile_id: user.id });

    const refused = await authApp.handle(
      new Request("http://localhost/profiles/switch", {
        method: "POST",
        headers: { Authorization: `Bearer ${restricted}`, "Content-Type": "application/json" },
        body,
      }),
    );
    expect(refused.status).toBe(401);

    const allowed = await authApp.handle(
      new Request("http://localhost/profiles/switch", {
        method: "POST",
        headers: { Authorization: `Bearer ${ordinary}`, "Content-Type": "application/json" },
        body,
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("POST /login/cross-device/:id/approve refuses a recovery bearer", async () => {
    // The worst of the two. Approval issues a full, unrestricted session for
    // ANOTHER device, so without this gate a restricted session becomes an
    // unrestricted one on hardware of the caller's choosing.
    const { ordinary, restricted } = await tokensFor("ra-cdl@example.com", "racdl");

    const begun = await authApp.handle(
      new Request("http://localhost/login/cross-device/begin", { method: "POST" }),
    );
    // The wire field is `cdlSecret` (it matches the log-redaction deny-list);
    // the approve body calls it `secret`. Reading the wrong one produces a 422
    // from body validation BEFORE the auth check, which would make this test
    // pass for a reason that has nothing to do with the audience.
    const { requestId, cdlSecret } = (await begun.json()) as {
      requestId: string;
      cdlSecret: string;
    };
    expect(typeof cdlSecret).toBe("string");
    const url = `http://localhost/login/cross-device/${requestId}/approve`;
    const secret = cdlSecret;

    const refused = await authApp.handle(
      new Request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${restricted}`, "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      }),
    );
    expect(refused.status).toBe(401);

    const allowed = await authApp.handle(
      new Request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ordinary}`, "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      }),
    );
    expect(allowed.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // The one place the audience IS accepted.
  // ---------------------------------------------------------------------------

  it("/passkey/register/begin takes a recovery bearer past the step-up gate", async () => {
    const { user, ordinary, restricted } = await tokensFor("ra-enrol@example.com", "raenrol");
    // Losing the phone does not delete its passkey row, so the account still
    // holds a credential — the common recovery case, and the one the step-up
    // gate would otherwise make unrecoverable.
    await runWithLayer(
      Effect.promise(() =>
        db.insert(passkeys).values({
          id: "pk_raenrol00001",
          accountId: user.accountId,
          credentialId: "ra-enrol-credential",
          publicKey: "AQIDBA==",
          counter: 0,
          transports: null,
          createdAt: new Date(),
          label: null,
          lastUsedAt: null,
          aaguid: null,
          backupEligible: false,
          backupState: false,
          updatedAt: Math.floor(Date.now() / 1000),
        }),
      ),
    );
    const url = "http://localhost/passkey/register/begin";
    const body = JSON.stringify({ profileId: user.id });

    // An ordinary token with no step-up token is refused: "Step-up required" is
    // an AuthError, which `publicError` maps to 400 invalid_request.
    const refused = await authApp.handle(
      new Request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ordinary}`, "Content-Type": "application/json" },
        body,
      }),
    );
    expect(refused.status).toBe(400);

    const allowed = await authApp.handle(
      new Request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${restricted}`, "Content-Type": "application/json" },
        body,
      }),
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()) as { challenge?: string }).toHaveProperty("challenge");
  });

  it("a recovery bearer still cannot reach the step-up ceremony it bypasses", async () => {
    // The bypass must not be reachable as a general privilege. If a restricted
    // session could mint a step-up token it would reach /recovery/generate,
    // DELETE /account, GET /account/export and /account/email/complete — every
    // route the restriction exists to prevent.
    const { ordinary, restricted } = await tokensFor("ra-stepup@example.com", "rastepup");
    const url = "http://localhost/step-up/passkey/begin";

    const refused = await authApp.handle(
      new Request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${restricted}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(refused.status).toBe(401);

    const allowed = await authApp.handle(
      new Request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ordinary}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(allowed.status).not.toBe(401);
  });
});
