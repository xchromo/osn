/**
 * The three unauthenticated account-recovery routes, at the HTTP boundary.
 *
 * What these tests are really pinning is a set of guards that all fail SILENTLY
 * when they break — a uniform 202 still looks uniform when the send is awaited,
 * a cap still returns 202 when it has been removed, and a lockout that shares a
 * counter with another surface looks identical until somebody uses it as a
 * weapon. So each one below is written to go red on a specific edit, named in
 * its comment, and each was confirmed red by making that edit.
 *
 * See `wiki/architecture/account-recovery-factors.md` §B and
 * §"Enumeration, timing and flood control".
 */

import { Database } from "bun:sqlite";

import { sessions, securityEvents } from "@osn/db/schema";
import * as schema from "@osn/db/schema";
import { Db } from "@osn/db/service";
import { applySchema } from "@osn/db/testing";
import { base32Decode, deriveTotpCode } from "@shared/crypto/totp";
import { EmailService, makeLogEmailLive, type SendEmailInput } from "@shared/email";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Effect, Layer } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { createInMemoryRecoveryLockoutStore } from "../../src/lib/recovery-lockout-store";
import { createAuthService, type AuthConfig } from "../../src/services/auth";
import { RECOVERY_TOKEN_AUDIENCE } from "../../src/services/auth/constants";
import { makeTestAuthConfig } from "../helpers/auth-config";
import { createAuthRoutes } from "../helpers/routes";

let config: AuthConfig;

beforeAll(async () => {
  config = await makeTestAuthConfig();
});

const STEP_SECONDS = 30;

const json = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

/** Decode a JWT payload without verifying — we only assert on claims here. */
const payloadOf = (jwt: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;

/**
 * A route app, a service and the raw sqlite handle over ONE layer.
 *
 * `emailLayer` is injectable because one test needs a transport that hangs; the
 * default is the ordinary recorder every other test in this repo uses.
 */
function makeApp(emailLayer?: Layer.Layer<EmailService>, overrides: Partial<AuthConfig> = {}) {
  const sqlite = new Database(":memory:");
  applySchema(sqlite);
  const db = drizzle(sqlite, { schema });
  const recorder = makeLogEmailLive();
  const layer = Layer.merge(Layer.succeed(Db, { db }), emailLayer ?? recorder.layer);
  const merged = { ...config, ...overrides };
  const app = createAuthRoutes(merged, layer);
  const auth = createAuthService(merged);
  const svc = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>);
  const seed = async (emailAddr: string, handle: string) => {
    const profile = await svc(auth.registerProfile(emailAddr, handle));
    return profile;
  };
  return { app, auth, db, svc, seed, recorded: recorder.recorded };
}

/** Pull the 6-digit code out of a rendered recovery email. */
const codeOf = (text: string): string => {
  const match = /\b(\d{6})\b/.exec(text);
  if (!match) throw new Error("no 6-digit code in the recorded email");
  return match[1]!;
};

/** Every recovery code the recorder has captured so far, oldest first. */
const codesSoFar = (recorded: readonly { template: string; text: string }[]): string[] =>
  recorded.filter((r) => r.template === "otp-recovery").map((r) => codeOf(r.text));

/**
 * Drive `begin` and return the code it sent.
 *
 * Waits for the recorder's recovery-mail COUNT to grow, not merely for one to
 * exist: the entry is keyed by account, so a second `begin` replaces the first
 * code, and a helper that stopped at "some mail has arrived" would hand back the
 * superseded one. That is a helper bug that shows up as a confusing 400 in a
 * test about something else entirely.
 */
async function requestCode(
  app: ReturnType<typeof makeApp>["app"],
  recorded: ReturnType<typeof makeApp>["recorded"],
  identifier: string,
): Promise<string> {
  const before = codesSoFar(recorded()).length;
  const res = await app.handle(
    json("/login/recovery/email/begin", {
      method: "POST",
      body: JSON.stringify({ identifier }),
    }),
  );
  expect(res.status).toBe(202);
  // The send is detached, so the fibre has usually not run by the time the
  // response resolves — which is the property the suite above pins.
  for (let i = 0; i < 100 && codesSoFar(recorded()).length === before; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const codes = codesSoFar(recorded());
  expect(codes.length).toBe(before + 1);
  return codes.at(-1)!;
}

describe("POST /login/recovery/email/begin", () => {
  it("answers an identical 202 whether or not the identifier resolves", async () => {
    const { app, seed } = makeApp();
    await seed("rb-known@example.com", "rbknown");

    const known = await app.handle(
      json("/login/recovery/email/begin", {
        method: "POST",
        body: JSON.stringify({ identifier: "rb-known@example.com" }),
      }),
    );
    const unknown = await app.handle(
      json("/login/recovery/email/begin", {
        method: "POST",
        body: JSON.stringify({ identifier: "rb-nobody@example.com" }),
      }),
    );

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.json()).toEqual({ status: "accepted" });
    expect(await unknown.json()).toEqual({ status: "accepted" });
    // Nothing else may differ either — a stray header is an oracle too.
    expect(known.headers.get("cache-control")).toBe("no-store");
    expect(unknown.headers.get("cache-control")).toBe("no-store");
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });

  it(
    "does not await the mail send, and still sends it",
    // SHORTER than the forked send's own 10-second `Effect.timeout`, so an
    // awaited implementation fails HERE rather than passing slowly if vitest's
    // 5-second default is ever raised.
    { timeout: 4000 },
    async () => {
      // THE oracle this endpoint exists to close. Every other OTP send in this
      // service awaits the provider; a Resend round trip is hundreds of
      // milliseconds against a sub-millisecond database probe, so awaiting here
      // would separate a resolving identifier from a non-resolving one however
      // uniform the body is.
      //
      // Goes red on: replacing `Effect.forkDetach` with a direct `yield*` — the
      // handler then blocks on `gate` and this test times out. The explicit
      // `testTimeout` below is load-bearing: it is SHORTER than the 10-second
      // `Effect.timeout` on the forked send, so an awaited implementation fails
      // here rather than passing slowly if somebody raises vitest's default.
      //
      // The second assertion is what stops a fibre that is never scheduled (or
      // is cancelled) from passing identically to one that works.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const sent: SendEmailInput[] = [];
      const hangingEmail = Layer.succeed(EmailService, {
        send: (input: SendEmailInput) =>
          Effect.promise(async () => {
            await gate;
            sent.push(input);
          }),
      });

      const { app, seed } = makeApp(hangingEmail);
      await seed("rb-hang@example.com", "rbhang");

      const res = await app.handle(
        json("/login/recovery/email/begin", {
          method: "POST",
          body: JSON.stringify({ identifier: "rb-hang@example.com" }),
        }),
      );
      // Returned while the transport is still parked.
      expect(res.status).toBe(202);
      expect(sent).toHaveLength(0);

      release();
      for (let i = 0; i < 100 && sent.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      expect(sent).toHaveLength(1);
      expect(sent[0]!.template).toBe("otp-recovery");
      expect(sent[0]!.to).toBe("rb-hang@example.com");
    },
  );

  it("refuses a handle", async () => {
    // A handle is public. `/login/passkey/begin` may take one because it sends
    // nothing; this endpoint puts mail in an inbox, so accepting one would turn
    // a public identifier into a way to mail a stranger.
    // Goes red on: dropping the `looksLikeEmail` guard (the handle then
    // resolves and the route answers 202).
    const { app, seed, recorded } = makeApp();
    await seed("rb-handle@example.com", "rbhandle");

    const res = await app.handle(
      json("/login/recovery/email/begin", {
        method: "POST",
        body: JSON.stringify({ identifier: "rbhandle" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recorded().filter((r) => r.template === "otp-recovery")).toHaveLength(0);
  });

  it("caps the fourth send in 24h, still answers 202, and does not burn the pending code", async () => {
    // The recipient is the victim: an uncapped endpoint floods the account
    // holder's inbox and trains them to expect recovery mail. Per-IP limiting
    // does not reach it — a rotating fleet defeats per-IP keys.
    //
    // Goes red on: removing the cap check (a fourth email is recorded), or
    // moving the store write above the cap check (the third code stops working
    // — which is the denial-of-service the cap would otherwise become).
    const { app, seed, recorded } = makeApp();
    await seed("rb-cap@example.com", "rbcap");

    await requestCode(app, recorded, "rb-cap@example.com");
    await requestCode(app, recorded, "rb-cap@example.com");
    const third = await requestCode(app, recorded, "rb-cap@example.com");

    const fourth = await app.handle(
      json("/login/recovery/email/begin", {
        method: "POST",
        body: JSON.stringify({ identifier: "rb-cap@example.com" }),
      }),
    );
    expect(fourth.status).toBe(202);
    expect(await fourth.json()).toEqual({ status: "accepted" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recorded().filter((r) => r.template === "otp-recovery")).toHaveLength(3);

    // The capped call must not have replaced the code the user is holding.
    const completed = await app.handle(
      json("/login/recovery/email/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rb-cap@example.com", code: third }),
      }),
    );
    expect(completed.status).toBe(200);
  });
});

describe("POST /login/recovery/email/complete", () => {
  it("issues a restricted recovery session and sets the session cookie", async () => {
    const { app, seed, recorded } = makeApp();
    await seed("rc-ok@example.com", "rcok");
    const code = await requestCode(app, recorded, "rc-ok@example.com");

    const res = await app.handle(
      json("/login/recovery/email/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rc-ok@example.com", code }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { access_token: string };
      profile: { handle: string };
    };
    expect(body.profile.handle).toBe("rcok");
    // The audience is the whole restriction: every verifier in this service and
    // the three downstream services pin `osn-access` and so reject this.
    // Goes red on: passing `false` for `restricted` in `issueSession`.
    expect(payloadOf(body.session.access_token)["aud"]).toBe(RECOVERY_TOKEN_AUDIENCE);
    // Goes red on: dropping `buildSessionCookies` — without the cookie
    // `completePasskeyRegistration` answers 409 `session_stale` at the one step
    // this session exists to perform.
    expect(res.headers.get("set-cookie")).toContain("osn_session=");
    // The refresh token stays in the cookie and never in the body.
    expect(Object.keys(body.session).toSorted()).toEqual([
      "access_token",
      "expires_in",
      "scope",
      "token_type",
    ]);
  });

  it("revokes every other session and writes account_recovered", async () => {
    // Matches `consumeRecoveryCode`: a second recovery ceremony that revoked
    // less, or recorded less, would be a quieter way into the same account.
    // Goes red on: dropping the `delete(sessions)` from the batch, or writing
    // the security event outside it.
    const { app, auth, db, svc, seed, recorded } = makeApp();
    const profile = await seed("rc-wipe@example.com", "rcwipe");
    await svc(
      auth.issueTokens(
        profile.id,
        profile.accountId,
        profile.email,
        profile.handle,
        profile.displayName,
      ),
    );
    const before = await db
      .select()
      .from(sessions)
      .where(eq(sessions.accountId, profile.accountId));
    expect(before).toHaveLength(1);

    const code = await requestCode(app, recorded, "rc-wipe@example.com");
    const res = await app.handle(
      json("/login/recovery/email/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rc-wipe@example.com", code }),
      }),
    );
    expect(res.status).toBe(200);

    // Exactly one session survives: the restricted one just issued.
    const after = await db.select().from(sessions).where(eq(sessions.accountId, profile.accountId));
    expect(after).toHaveLength(1);
    expect(after[0]!.restrictedUntil).not.toBeNull();
    expect(after[0]!.id).not.toBe(before[0]!.id);

    const events = await db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.accountId, profile.accountId));
    expect(events.map((e) => e.kind)).toContain("account_recovered");
  });

  it("burns the pending entry after MAX_OTP_ATTEMPTS wrong codes, lockout aside", async () => {
    // `MAX_OTP_ATTEMPTS` and `RECOVERY_LOCKOUT_THRESHOLD` are both 5, so on a
    // stock service the two fire on the SAME attempt and a test written the
    // obvious way passes whichever one is doing the work. Written that way this
    // test stayed green with the attempt bump deleted — the lockout was
    // refusing the final code.
    //
    // So the lockout is lifted out of the way (threshold 100) and the per-entry
    // cap is left as the only thing that can refuse the correct code.
    // Goes red on: dropping the attempt bump.
    const { app, seed, recorded } = makeApp(undefined, {
      recoveryOtpLockoutStore: createInMemoryRecoveryLockoutStore({ threshold: 100 }),
    });
    await seed("rc-att@example.com", "rcatt");
    const code = await requestCode(app, recorded, "rc-att@example.com");

    for (let i = 0; i < 5; i++) {
      const bad = await app.handle(
        json("/login/recovery/email/complete", {
          method: "POST",
          body: JSON.stringify({ identifier: "rc-att@example.com", code: "000000" }),
        }),
      );
      expect(bad.status).toBe(400);
    }

    const res = await app.handle(
      json("/login/recovery/email/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rc-att@example.com", code }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("does not count an attempt when no code is pending", async () => {
    // Counting it would hand anyone who knows the identifier a lever to lock the
    // owner out of their own recovery without ever guessing a digit.
    // Goes red on: moving `recordFailure` above the pending-entry check.
    const { app, seed, recorded } = makeApp();
    await seed("rc-nopend@example.com", "rcnopend");

    for (let i = 0; i < 6; i++) {
      const res = await app.handle(
        json("/login/recovery/email/complete", {
          method: "POST",
          body: JSON.stringify({ identifier: "rc-nopend@example.com", code: "000000" }),
        }),
      );
      expect(res.status).toBe(400);
    }

    // The counter never moved, so a code requested now still works.
    const code = await requestCode(app, recorded, "rc-nopend@example.com");
    const res = await app.handle(
      json("/login/recovery/email/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rc-nopend@example.com", code }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("locks the account out across a second code request", async () => {
    // What the lockout adds over the per-entry cap: they coincide on the FIRST
    // entry (both are 5), so the counter's real job is the second and third.
    // Without it the 3-per-24h send cap would still allow fifteen guesses.
    // Goes red on: dropping `recordFailure` or the `isLocked` gate.
    const { app, db, seed, recorded } = makeApp();
    const profile = await seed("rc-lock@example.com", "rclock");

    await requestCode(app, recorded, "rc-lock@example.com");
    for (let i = 0; i < 5; i++) {
      await app.handle(
        json("/login/recovery/email/complete", {
          method: "POST",
          body: JSON.stringify({ identifier: "rc-lock@example.com", code: "000000" }),
        }),
      );
    }

    // A fresh, genuinely correct code is refused while the lockout stands —
    // and with the same generic error, so "locked" is not its own oracle.
    const second = await requestCode(app, recorded, "rc-lock@example.com");
    const res = await app.handle(
      json("/login/recovery/email/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rc-lock@example.com", code: second }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });

    const events = await db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.accountId, profile.accountId));
    expect(events.map((e) => e.kind)).toContain("recovery_otp_lockout");
  });

  it("answers a wrong code and an unknown identifier byte-identically", async () => {
    // `publicError` collapses every AuthError to the same envelope, so this is
    // mostly a guard against somebody adding a `message` to one branch — and
    // against either branch leaking a cookie.
    const { app, seed } = makeApp();
    await seed("rc-same@example.com", "rcsame");

    const wrongCode = await app.handle(
      json("/login/recovery/email/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rc-same@example.com", code: "000000" }),
      }),
    );
    const unknown = await app.handle(
      json("/login/recovery/email/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rc-nobody@example.com", code: "000000" }),
      }),
    );

    expect(wrongCode.status).toBe(unknown.status);
    expect(await wrongCode.json()).toEqual(await unknown.json());
    expect(wrongCode.headers.get("set-cookie")).toBeNull();
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /login/recovery/totp/complete", () => {
  /** Enrol a confirmed TOTP credential and hand back its secret. */
  async function enrolTotp(
    app: ReturnType<typeof makeApp>["app"],
    auth: ReturnType<typeof makeApp>["auth"],
    svc: ReturnType<typeof makeApp>["svc"],
    accountId: string,
    accessToken: string,
  ): Promise<Uint8Array> {
    const stepUp = await svc(auth.issueStepUpToken(accountId, "passkey", "totp_enroll"));
    const begun = (await (
      await app.handle(
        json("/totp/enroll/begin", {
          method: "POST",
          body: JSON.stringify({ step_up_token: stepUp }),
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      )
    ).json()) as { totpSecret: string };
    const secret = base32Decode(begun.totpSecret);
    await app.handle(
      json("/totp/enroll/complete", {
        method: "POST",
        body: JSON.stringify({
          code: await deriveTotpCode(secret, Math.floor(Date.now() / 1000 / STEP_SECONDS)),
        }),
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    return secret;
  }

  async function seedEnrolled(emailAddr: string, handle: string) {
    const harness = makeApp();
    const profile = await harness.seed(emailAddr, handle);
    const tokens = await harness.svc(
      harness.auth.issueTokens(
        profile.id,
        profile.accountId,
        profile.email,
        profile.handle,
        profile.displayName,
      ),
    );
    const secret = await enrolTotp(
      harness.app,
      harness.auth,
      harness.svc,
      profile.accountId,
      tokens.accessToken,
    );
    return { ...harness, profile, tokens, secret };
  }

  it("mints a restricted session from a code, by handle", async () => {
    const { app, secret } = await seedEnrolled("rt-ok@example.com", "rtok");
    const step = Math.floor(Date.now() / 1000 / STEP_SECONDS) + 1;

    const res = await app.handle(
      json("/login/recovery/totp/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rtok", code: await deriveTotpCode(secret, step) }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { access_token: string } };
    expect(payloadOf(body.session.access_token)["aud"]).toBe(RECOVERY_TOKEN_AUDIENCE);
    expect(res.headers.get("set-cookie")).toContain("osn_session=");
  });

  it("refuses a replayed code", async () => {
    // RFC 6238 §5.2. `verifyTotpCode` is stateless, so single use is the
    // conditional UPDATE in `consumeStep` — a replay off the wire would
    // otherwise be an account takeover, not a repeated ceremony.
    // Goes red on: bypassing `checkTotpCode`'s `consumeStep`.
    const { app, secret } = await seedEnrolled("rt-replay@example.com", "rtreplay");
    const step = Math.floor(Date.now() / 1000 / STEP_SECONDS) + 1;
    const code = await deriveTotpCode(secret, step);

    const first = await app.handle(
      json("/login/recovery/totp/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rtreplay", code }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      json("/login/recovery/totp/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rtreplay", code }),
      }),
    );
    expect(second.status).toBe(400);
  });

  it("refuses an account with no confirmed credential, and an unknown identifier, alike", async () => {
    // `confirmedCredential` filters on `confirmedAt`, and the not-enrolled
    // branch still pays for a full verification so it cannot be timed apart.
    const { app, seed } = makeApp();
    await seed("rt-none@example.com", "rtnone");

    const notEnrolled = await app.handle(
      json("/login/recovery/totp/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rtnone", code: "000000" }),
      }),
    );
    const unknown = await app.handle(
      json("/login/recovery/totp/complete", {
        method: "POST",
        body: JSON.stringify({ identifier: "rtnobody", code: "000000" }),
      }),
    );

    expect(notEnrolled.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(await notEnrolled.json()).toEqual(await unknown.json());
  });

  it("does not lock the authenticated step-up ceremony", async () => {
    // The finding this test exists for. `checkTotpCode` is shared with
    // `POST /step-up/totp/complete`, which is authenticated; this route is not,
    // and it accepts a PUBLIC handle. On a shared counter, five requests from
    // anyone who knows the handle would lock the owner's step-up for fifteen
    // minutes — taking passkey_register, recovery_generate, totp_enroll,
    // totp_disable, account_delete and account_export with it — repeatedly and
    // indefinitely.
    //
    // Goes red on: passing "step_up" instead of "recovery" in
    // `completeTotpRecovery`, or dropping the `scope` parameter so both share a
    // key.
    const { app, tokens, secret } = await seedEnrolled("rt-lock@example.com", "rtlock");

    // Spend the recovery surface's whole allowance from the public handle.
    for (let i = 0; i < 6; i++) {
      const res = await app.handle(
        json("/login/recovery/totp/complete", {
          method: "POST",
          body: JSON.stringify({ identifier: "rtlock", code: "000000" }),
        }),
      );
      expect(res.status).toBe(400);
    }

    // The owner's authenticated ceremony is untouched.
    const step = Math.floor(Date.now() / 1000 / STEP_SECONDS) + 1;
    const stepUp = await app.handle(
      json("/step-up/totp/complete", {
        method: "POST",
        body: JSON.stringify({
          code: await deriveTotpCode(secret, step),
          purpose: "passkey_register",
        }),
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      }),
    );
    expect(stepUp.status).toBe(200);
  });
});
