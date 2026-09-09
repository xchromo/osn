/**
 * The restricted recovery session (`aud: "osn-recovery"`).
 *
 * Account recovery has to end in something that can enrol a fresh passkey and
 * do nothing else. Every assertion here corresponds to one way that restriction
 * could fail open, so each is written to go red on a specific mistake rather
 * than to describe the happy path.
 *
 * Two families of test live here and they are proved differently:
 *
 *  - **Pins.** `verifyAccessToken` and the downstream JWKS verifier already
 *    reject every audience but `osn-access`; these tests do not add a guard, they
 *    nail down that the recovery session is minted on the far side of one. Their
 *    red is minting the session with the ordinary audience.
 *  - **Guards.** The no-slide rule, the rotation carry-forward and the
 *    restriction lift are new behaviour, and each goes red on its own edit.
 *
 * See `[[wiki/systems/sessions]]` and `wiki/architecture/account-recovery-factors.md` §B.
 */

import { it, expect, describe } from "@effect/vitest";
import { passkeys, sessions } from "@osn/db/schema";
import type { Db } from "@osn/db/service";
import { extractClaims } from "@shared/osn-auth-client/verify";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { beforeAll, afterEach, vi } from "vitest";

import { resolveAccessTokenPrincipal, resolveAccountId } from "../../src/lib/auth-derive";
import { buildSessionCookies, readSessionCookie } from "../../src/lib/cookie-session";
import {
  ACCESS_TOKEN_AUDIENCE,
  RECOVERY_SESSION_TTL_SEC,
  RECOVERY_TOKEN_AUDIENCE,
  isReservedOidcClientId,
} from "../../src/services/auth/constants";

// `completePasskeyRegistration` runs a real WebAuthn attestation through
// `@simplewebauthn/server`, which no unit test can produce. Only the verifier is
// stubbed, so `generateRegistrationOptions` still plants a real challenge.
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: `cred-${Math.random().toString(16).slice(2, 10)}`,
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: undefined,
        },
        aaguid: "00000000-0000-0000-0000-000000000000",
        credentialBackedUp: false,
        credentialDeviceType: "singleDevice",
      },
    })),
  };
});

// Imported AFTER the mock is registered.
const { createAuthService } = await import("../../src/services/auth");
const { makeTestAuthConfig } = await import("../helpers/auth-config");
const { createTestLayerWithSqlite } = await import("../helpers/db");

let config: Awaited<ReturnType<typeof makeTestAuthConfig>>;
let auth: ReturnType<typeof createAuthService>;

beforeAll(async () => {
  config = await makeTestAuthConfig();
  auth = createAuthService(config);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A fresh in-memory database plus the Drizzle handle, so tests can read the row. */
function makeHarness() {
  const { layer, db } = createTestLayerWithSqlite();
  return { layer, db };
}

const sessionRow = (db: ReturnType<typeof makeHarness>["db"], refreshToken: string) =>
  Effect.promise(async () => {
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, auth.hashSessionToken(refreshToken)))
      .limit(1);
    return rows[0];
  });

/** Decodes a JWT payload without verifying it — these tests assert on `aud`. */
function payloadOf(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1]!;
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

const COOKIE_CONFIG = { secure: false } as const;
const JWKS_URL = "https://id.example.test/.well-known/jwks.json";

describe("restricted recovery session — minting", () => {
  it.effect("mints an access token on the recovery audience, still session-bound", () => {
    const { layer, db } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-mint@example.com", "rsmint");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );

      const payload = payloadOf(restricted.accessToken);
      expect(payload["aud"]).toBe(RECOVERY_TOKEN_AUDIENCE);
      // `osn_sid` still rides along: the enrolment sweep has to be able to name
      // the caller's own session on a cookieless call.
      expect(typeof payload["osn_sid"]).toBe("string");

      // The absolute deadline. `expiresAt` IS `restrictedUntil` — the session
      // cannot outlive the window in which enrolling a passkey is plausible.
      const row = yield* sessionRow(db, restricted.refreshToken);
      expect(row?.restrictedUntil).not.toBeNull();
      expect(row!.expiresAt).toBe(row!.restrictedUntil);
      expect(row!.expiresAt - row!.createdAt).toBe(RECOVERY_SESSION_TTL_SEC);
    }).pipe(Effect.provide(layer));
  });

  it.effect("an ordinary session is untouched: access audience, 30-day expiry", () => {
    const { layer, db } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-ord@example.com", "rsord");
      const ordinary = yield* auth.issueTokens(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );

      expect(payloadOf(ordinary.accessToken)["aud"]).toBe(ACCESS_TOKEN_AUDIENCE);
      const row = yield* sessionRow(db, ordinary.refreshToken);
      expect(row?.restrictedUntil).toBeNull();
      expect(row!.expiresAt - row!.createdAt).toBe(2592000);
    }).pipe(Effect.provide(layer));
  });

  it("reserves the audience as an OIDC client id", () => {
    // A relying party registered under this name would mint OIDC tokens whose
    // `aud` collides with the recovery audience's pin.
    expect(isReservedOidcClientId(RECOVERY_TOKEN_AUDIENCE)).toBe(true);
    expect(isReservedOidcClientId(ACCESS_TOKEN_AUDIENCE)).toBe(true);
  });
});

describe("restricted recovery session — every verifier rejects it", () => {
  // These are pins, not guards: `verifyAccessToken` already rejects a foreign
  // audience. What they prove is that the recovery session is minted on the far
  // side of that pin. Each carries an ordinary-token control, so a harness that
  // is broken for an unrelated reason fails loudly instead of passing green.

  it.effect("verifyAccessToken rejects it; accepts an ordinary token", () => {
    const { layer } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-vat@example.com", "rsvat");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const ordinary = yield* auth.issueTokens(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );

      const err = yield* Effect.flip(auth.verifyAccessToken(restricted.accessToken));
      expect(err._tag).toBe("AuthError");

      const ok = yield* auth.verifyAccessToken(ordinary.accessToken);
      expect(ok.profileId).toBe(user.id);
    }).pipe(Effect.provide(layer));
  });

  it.effect("verifyRecoveryAccessToken is the mirror: takes recovery, refuses ordinary", () => {
    const { layer } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-vrat@example.com", "rsvrat");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const ordinary = yield* auth.issueTokens(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );

      const ok = yield* auth.verifyRecoveryAccessToken(restricted.accessToken);
      expect(ok.profileId).toBe(user.id);

      // The narrow verifier must not become a second way in for a full token.
      const err = yield* Effect.flip(auth.verifyRecoveryAccessToken(ordinary.accessToken));
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("resolveAccessTokenPrincipal and resolveAccountId both return null", () => {
    const { layer } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-derive@example.com", "rsderive");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const ordinary = yield* auth.issueTokens(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const runWithDb = <A, E>(eff: Effect.Effect<A, E, Db>) =>
        Effect.runPromise(eff.pipe(Effect.provide(layer)) as Effect.Effect<A, never, never>);

      expect(
        yield* Effect.promise(() =>
          resolveAccessTokenPrincipal(auth, `Bearer ${restricted.accessToken}`),
        ),
      ).toBeNull();
      expect(
        yield* Effect.promise(() =>
          resolveAccessTokenPrincipal(auth, `Bearer ${ordinary.accessToken}`),
        ),
      ).not.toBeNull();

      expect(
        yield* Effect.promise(() =>
          resolveAccountId(auth, runWithDb, `Bearer ${restricted.accessToken}`),
        ),
      ).toBeNull();
      expect(
        yield* Effect.promise(() =>
          resolveAccountId(auth, runWithDb, `Bearer ${ordinary.accessToken}`),
        ),
      ).toEqual({ accountId: user.accountId });
    }).pipe(Effect.provide(layer));
  });

  it.effect("the downstream JWKS verifier rejects it — stands in for pulse, zap and cire", () => {
    const { layer } = makeHarness();
    return Effect.gen(function* () {
      // `@shared/osn-auth-client` is how pulse/api, zap/api and cire/api all
      // verify an OSN access token, and none of them can reach this service's
      // database. This is the only test in the repository that runs a token
      // minted here through the verifier they actually use, so it is what
      // stands in for all three.
      //
      // Both calls share one key and one audience option; only the token
      // differs. Without the ordinary-token control this would also pass with
      // the wrong key, which is a test that cannot go red.
      const user = yield* auth.registerProfile("rs-jwks@example.com", "rsjwks");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const ordinary = yield* auth.issueTokens(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const options = { testKey: config.jwtPublicKey, audience: ACCESS_TOKEN_AUDIENCE };

      const rejected = yield* Effect.promise(() =>
        extractClaims(`Bearer ${restricted.accessToken}`, JWKS_URL, options),
      );
      expect(rejected).toBeNull();

      const accepted = yield* Effect.promise(() =>
        extractClaims(`Bearer ${ordinary.accessToken}`, JWKS_URL, options),
      );
      expect(accepted?.profileId).toBe(user.id);
    }).pipe(Effect.provide(layer));
  });
});

describe("restricted recovery session — rotation and expiry", () => {
  it.effect("refresh re-mints the recovery audience and does not move the deadline", () => {
    const { layer, db } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-rot@example.com", "rsrot");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const before = yield* sessionRow(db, restricted.refreshToken);

      const rotated = yield* auth.refreshTokens(restricted.refreshToken);

      // Without the carry-forward the restriction would die on the first silent
      // refresh, five minutes in, and this token would be a full one.
      expect(payloadOf(rotated.accessToken)["aud"]).toBe(RECOVERY_TOKEN_AUDIENCE);

      const after = yield* sessionRow(db, rotated.refreshToken);
      expect(after?.restrictedUntil).toBe(before!.restrictedUntil);
      // The absolute deadline survives rotation. `nowSec + refreshTokenTtl`
      // here would silently hand the session 30 days.
      expect(after!.expiresAt).toBe(before!.expiresAt);
    }).pipe(Effect.provide(layer));
  });

  it.effect("the sliding window never extends a restricted session", () => {
    const { layer, db } = makeHarness();
    return Effect.gen(function* () {
      // The guard this pins is not optional bookkeeping. `shouldExtend` is
      // `expiresAt - now < halfTtl`, and a restricted session's whole 15-minute
      // life sits far inside half of a 30-day TTL — so the comparison ALONE is
      // always true, and without an explicit `restrictedUntil === null` the one
      // session that must expire on schedule is the one that gets extended.
      const user = yield* auth.registerProfile("rs-slide@example.com", "rsslide");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const before = yield* sessionRow(db, restricted.refreshToken);

      // `verifyRefreshToken` is where the sliding write happens.
      yield* auth.verifyRefreshToken(restricted.refreshToken, { allowRestricted: true });

      const after = yield* sessionRow(db, restricted.refreshToken);
      expect(after!.expiresAt).toBe(before!.expiresAt);
    }).pipe(Effect.provide(layer));
  });

  it.effect("an ordinary session DOES slide — the control for the test above", () => {
    const { layer, db } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-slide2@example.com", "rsslide2");
      const ordinary = yield* auth.issueTokens(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const before = yield* sessionRow(db, ordinary.refreshToken);

      // Past the half-TTL, where the sliding window fires. Only `Date` is
      // faked: faking timers wholesale would stall Effect's scheduler.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + 16 * 24 * 60 * 60 * 1000));

      yield* auth.verifyRefreshToken(ordinary.refreshToken);

      const after = yield* sessionRow(db, ordinary.refreshToken);
      // Strictly greater. Equality would pass on a session that never slid.
      expect(after!.expiresAt).toBeGreaterThan(before!.expiresAt);
    }).pipe(Effect.provide(layer));
  });

  it.effect("a restricted session is dead 15 minutes after issue", () => {
    const { layer } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-exp@example.com", "rsexp");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const ordinary = yield* auth.issueTokens(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + (RECOVERY_SESSION_TTL_SEC + 60) * 1000));

      // Refresh with the OPAQUE token, never the JWT — the access token's own
      // 5-minute `exp` has also lapsed under the moved clock, so asserting on
      // the JWT would prove nothing about the session.
      const err = yield* Effect.flip(auth.refreshTokens(restricted.refreshToken));
      expect(err._tag).toBe("AuthError");

      // Same instant, same clock: an ordinary session is still alive. This is
      // what separates "the restriction expired it" from "the harness moved
      // time and everything died".
      const stillGood = yield* auth.refreshTokens(ordinary.refreshToken);
      expect(payloadOf(stillGood.accessToken)["aud"]).toBe(ACCESS_TOKEN_AUDIENCE);
    }).pipe(Effect.provide(layer));
  });

  it.effect("verifyRefreshToken refuses a restricted session unless asked", () => {
    const { layer } = makeHarness();
    return Effect.gen(function* () {
      // The default is what keeps a recovery cookie out of `GET /authorize`,
      // which resolves the signed-in user from the cookie rather than from an
      // access token. Without it a restricted session would complete an OIDC
      // authorization and sign the user into every relying party — full access
      // at a different service, from a session that has none here.
      const user = yield* auth.registerProfile("rs-vrt@example.com", "rsvrt");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );

      const err = yield* Effect.flip(auth.verifyRefreshToken(restricted.refreshToken));
      expect(err._tag).toBe("AuthError");

      const allowed = yield* auth.verifyRefreshToken(restricted.refreshToken, {
        allowRestricted: true,
      });
      expect(allowed.accountId).toBe(user.accountId);
      expect(allowed.restrictedUntil).not.toBeNull();
    }).pipe(Effect.provide(layer));
  });
});

describe("restricted recovery session — the session cookie", () => {
  it.effect("round-trips through the cookie the recovery route sets", () => {
    const { layer } = makeHarness();
    return Effect.gen(function* () {
      // Not a guard — every function below is unchanged by this work. It is the
      // assertion the issue asked for here rather than in the branch that adds
      // the endpoint: `completePasskeyRegistration`'s sweep derives the caller
      // from this cookie and answers `session_stale` (409) when it cannot, so a
      // recovery route that forgets `buildSessionCookies` produces a session
      // that cannot finish the one thing it exists to do.
      const user = yield* auth.registerProfile("rs-cookie@example.com", "rscookie");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );

      // Exactly what `POST /login/recovery/complete` does with its token set.
      const setCookie = buildSessionCookies(restricted.refreshToken, COOKIE_CONFIG);
      const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
      const token = readSessionCookie(cookieHeader, COOKIE_CONFIG);
      expect(token).toBe(restricted.refreshToken);

      const caller = yield* auth.classifyCallerSession(user.accountId, user.id, {
        cookieSessionHash: auth.hashSessionToken(token!),
        sessionBinding: null,
      });
      expect(caller._tag).toBe("resolved");

      // The failure it is protecting against: a cookie that names no live row
      // is `stale`, which the route turns into the 409.
      const stale = yield* auth.classifyCallerSession(user.accountId, user.id, {
        cookieSessionHash: auth.hashSessionToken("ses_deadbeef"),
        sessionBinding: null,
      });
      expect(stale._tag).toBe("stale");
    }).pipe(Effect.provide(layer));
  });
});

describe("restricted recovery session — enrolling a passkey lifts the restriction", () => {
  const fakeAttestation = () =>
    ({
      id: "x",
      rawId: "x",
      response: {},
      type: "public-key",
      clientExtensionResults: {},
    }) as never;

  it.effect("clears restrictedUntil, and the next token is an ordinary one", () => {
    const { layer, db } = makeHarness();
    return Effect.gen(function* () {
      const user = yield* auth.registerProfile("rs-lift@example.com", "rslift");
      const restricted = yield* auth.issueRecoverySession(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const callerHash = auth.hashSessionToken(restricted.refreshToken);

      yield* auth.beginPasskeyRegistration(user.accountId);
      yield* auth.completePasskeyRegistration(user.accountId, fakeAttestation(), callerHash);

      const row = yield* sessionRow(db, restricted.refreshToken);
      expect(row?.restrictedUntil).toBeNull();
      // The 15-minute deadline goes with it: the session the user is holding
      // must not die a few minutes after they have finished recovering.
      expect(row!.expiresAt - row!.createdAt).toBeGreaterThan(RECOVERY_SESSION_TTL_SEC);

      const rotated = yield* auth.refreshTokens(restricted.refreshToken);
      expect(payloadOf(rotated.accessToken)["aud"]).toBe(ACCESS_TOKEN_AUDIENCE);
    }).pipe(Effect.provide(layer));
  });

  it.effect("leaves an ordinary caller's session expiry alone", () => {
    const { layer, db } = makeHarness();
    return Effect.gen(function* () {
      // `liftSessionRestriction` runs on every passkey registration, so it has
      // to be inert on the everyday path — an ordinary add must not quietly
      // reset the caller's session clock.
      const user = yield* auth.registerProfile("rs-lift2@example.com", "rslift2");
      const ordinary = yield* auth.issueTokens(
        user.id,
        user.accountId,
        user.email,
        user.handle,
        user.displayName,
      );
      const before = yield* sessionRow(db, ordinary.refreshToken);

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + 60_000));

      yield* auth.beginPasskeyRegistration(user.accountId);
      yield* auth.completePasskeyRegistration(
        user.accountId,
        fakeAttestation(),
        auth.hashSessionToken(ordinary.refreshToken),
      );

      const after = yield* sessionRow(db, ordinary.refreshToken);
      expect(after!.expiresAt).toBe(before!.expiresAt);
      expect(after?.restrictedUntil).toBeNull();
    }).pipe(Effect.provide(layer));
  });

  it.effect("a recovery session enrols past the step-up gate; an ordinary one does not", () => {
    const { layer, db } = makeHarness();
    return Effect.gen(function* () {
      // The common recovery case, not an edge: losing a phone does not delete
      // its passkey row, so the account still has ≥1 credential and the
      // step-up gate would otherwise make recovery impossible.
      const user = yield* auth.registerProfile("rs-gate@example.com", "rsgate");
      yield* Effect.promise(() =>
        db.insert(passkeys).values({
          id: "pk_seeded00001",
          accountId: user.accountId,
          credentialId: "seeded-credential",
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
      );

      // No step-up token, account already holds a passkey.
      const refused = yield* Effect.flip(auth.beginPasskeyRegistration(user.accountId));
      expect(refused._tag).toBe("AuthError");

      const allowed = yield* auth.beginPasskeyRegistration(user.accountId, undefined, {
        viaRecoverySession: true,
      });
      expect(allowed.options.challenge).toBeTruthy();
    }).pipe(Effect.provide(layer));
  });
});
