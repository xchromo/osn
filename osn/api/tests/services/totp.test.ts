import { it, expect, describe } from "@effect/vitest";
import { base32Decode, deriveTotpCode } from "@shared/crypto/totp";
import { makeLogEmailLive } from "@shared/email";
import { Effect, Layer } from "effect";
import { afterEach, beforeAll, vi } from "vitest";

import { createInMemoryRecoveryLockoutStore } from "../../src/lib/recovery-lockout-store";
import { createAuthService, type AuthConfig } from "../../src/services/auth";
import { TOTP_LOCKOUT_THRESHOLD } from "../../src/services/auth/constants";
import { makeTestAuthConfig } from "../helpers/auth-config";
import { createTestLayer } from "../helpers/db";

/**
 * The TOTP credential's own behaviour. What matters here and is easy to get
 * wrong:
 *
 *   • an accepted code is single use (RFC 6238 §5.2), INCLUDING the one typed
 *     into the enrolment form;
 *   • the next step's code still works, which is the whole reason
 *     `verifyTotpCode` returns the matched step rather than a boolean;
 *   • every failure looks identical on the wire;
 *   • a `totp` step-up token is admitted at `passkey_register` and refused at
 *     `passkey_delete`.
 */

let config: AuthConfig;
let auth: ReturnType<typeof createAuthService>;

beforeAll(async () => {
  config = await makeTestAuthConfig();
  auth = createAuthService(config);
});

const STEP_SECONDS = 30;

function makeLayer() {
  const email = makeLogEmailLive();
  return Layer.merge(createTestLayer(), email.layer);
}

/** Register an account and put a confirmed TOTP credential on it. */
const enrolled = (emailAddr: string, handle: string) =>
  Effect.gen(function* () {
    const profile = yield* auth.registerProfile(emailAddr, handle);
    const stepUpToken = yield* auth.issueStepUpToken(profile.accountId, "passkey", "totp_enroll");
    const { totpSecret, otpauthUri } = yield* auth.beginTotpEnrollment(
      profile.accountId,
      stepUpToken,
    );
    const secret = base32Decode(totpSecret);
    const code = yield* Effect.promise(() =>
      deriveTotpCode(secret, Math.floor(Date.now() / 1000 / STEP_SECONDS)),
    );
    yield* auth.completeTotpEnrollment(profile.accountId, code, "Test phone");
    return { profile, secret, otpauthUri, enrolmentCode: code };
  });

const codeAtStep = (secret: Uint8Array, step: number) =>
  Effect.promise(() => deriveTotpCode(secret, step));

const currentStep = () => Math.floor(Date.now() / 1000 / STEP_SECONDS);

/**
 * Move the wall clock on by one TOTP step.
 *
 * Only `Date` is faked — `setTimeout` stays real, so Effect's scheduler is
 * untouched. This is the honest way to test successive ceremonies: a code two
 * steps ahead of now is OUTSIDE the ±1 drift window and is supposed to be
 * refused, so "the next code still works" can only be shown by letting time
 * pass, not by reaching further up the counter.
 */
const advanceOneStep = () => {
  vi.setSystemTime(new Date(Date.now() + STEP_SECONDS * 1000));
};

afterEach(() => {
  vi.useRealTimers();
});

describe("TOTP enrolment", () => {
  it.effect("enrols, and status reports it without any secret material", () =>
    Effect.gen(function* () {
      const { profile, otpauthUri } = yield* enrolled("totp-a@example.com", "totpa");

      expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);

      const status = yield* auth.getTotpStatus(profile.accountId);
      expect(status.enrolled).toBe(true);
      expect(status.label).toBe("Test phone");

      // Assert the WHOLE body, not a field: a future column added to the
      // projection would otherwise ship silently.
      expect(Object.keys(status).toSorted()).toEqual([
        "createdAt",
        "enrolled",
        "label",
        "lastUsedAt",
      ]);
      expect(JSON.stringify(status)).not.toContain("otpauth");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("refuses enrolment without a step-up token minted for it", () =>
    Effect.gen(function* () {
      const profile = yield* auth.registerProfile("totp-b@example.com", "totpb");
      // A real step-up token, but minted for a DIFFERENT ceremony. Purpose
      // binding, not the AMR list, is what stops this.
      const wrongPurpose = yield* auth.issueStepUpToken(
        profile.accountId,
        "passkey",
        "passkey_register",
      );
      const err = yield* Effect.flip(auth.beginTotpEnrollment(profile.accountId, wrongPurpose));
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("refuses a second credential while one is confirmed", () =>
    Effect.gen(function* () {
      const { profile } = yield* enrolled("totp-c@example.com", "totpc");
      const token = yield* auth.issueStepUpToken(profile.accountId, "passkey", "totp_enroll");
      const err = yield* Effect.flip(auth.beginTotpEnrollment(profile.accountId, token));
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("refuses a wrong code at enroll/complete", () =>
    Effect.gen(function* () {
      const profile = yield* auth.registerProfile("totp-d@example.com", "totpd");
      const token = yield* auth.issueStepUpToken(profile.accountId, "passkey", "totp_enroll");
      yield* auth.beginTotpEnrollment(profile.accountId, token);

      const err = yield* Effect.flip(
        auth.completeTotpEnrollment(profile.accountId, "000000", null),
      );
      expect(err._tag).toBe("AuthError");

      const status = yield* auth.getTotpStatus(profile.accountId);
      expect(status.enrolled).toBe(false);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("refuses enroll/complete when no enrolment is pending", () =>
    Effect.gen(function* () {
      const profile = yield* auth.registerProfile("totp-e@example.com", "totpe");
      const err = yield* Effect.flip(
        auth.completeTotpEnrollment(profile.accountId, "123456", null),
      );
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );
});

describe("TOTP single use (RFC 6238 §5.2)", () => {
  it.effect("accepts a code once and refuses the same code again", () =>
    Effect.gen(function* () {
      const { profile, secret } = yield* enrolled("totp-f@example.com", "totpf");
      // A later step than the enrolment consumed, so this is a clean first use.
      const step = currentStep() + 1;
      const code = yield* codeAtStep(secret, step);

      const first = yield* auth.completeStepUpTotp(profile.accountId, code);
      expect(first.stepUpToken).toMatch(/^eyJ/);

      const err = yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, code));
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("refuses the enrolment code itself at step-up", () =>
    Effect.gen(function* () {
      // The enrolment code is a real code and the most-observed one the
      // credential will ever produce — it is typed into a form. If the row went
      // in with a null step it would stay replayable for the rest of its window.
      const { profile, enrolmentCode } = yield* enrolled("totp-g@example.com", "totpg");
      const err = yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, enrolmentCode));
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("refuses a code from a step at or below the last accepted one", () =>
    Effect.gen(function* () {
      const { profile, secret } = yield* enrolled("totp-h@example.com", "totph");
      const step = currentStep() + 1;
      yield* auth.completeStepUpTotp(profile.accountId, yield* codeAtStep(secret, step));

      // The previous step is still inside the ±1 drift window, so it verifies
      // arithmetically — only the stored step rejects it.
      const older = yield* codeAtStep(secret, step - 1);
      const err = yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, older));
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("still accepts the NEXT step's code straight after a success", () =>
    Effect.gen(function* () {
      // This is the case the boolean-returning alternative would have broken:
      // refusing every code for the rest of the drift window would fail a
      // legitimate second ceremony ~90 seconds later.
      const { profile, secret } = yield* enrolled("totp-i@example.com", "totpi");

      vi.useFakeTimers({ toFake: ["Date"] });
      advanceOneStep();
      yield* auth.completeStepUpTotp(profile.accountId, yield* codeAtStep(secret, currentStep()));

      advanceOneStep();
      const next = yield* auth.completeStepUpTotp(
        profile.accountId,
        yield* codeAtStep(secret, currentStep()),
      );
      expect(next.stepUpToken).toMatch(/^eyJ/);
    }).pipe(Effect.provide(makeLayer())),
  );
});

describe("TOTP failures are indistinguishable on the wire", () => {
  it.effect("answers the same message for a wrong code and for no credential", () =>
    Effect.gen(function* () {
      const { profile } = yield* enrolled("totp-j@example.com", "totpj");
      const noTotp = yield* auth.registerProfile("totp-k@example.com", "totpk");

      const wrong = yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, "000000"));
      const absent = yield* Effect.flip(auth.completeStepUpTotp(noTotp.accountId, "000000"));

      expect(wrong.message).toBe(absent.message);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("answers that same message for a replayed code", () =>
    Effect.gen(function* () {
      const { profile, secret } = yield* enrolled("totp-l@example.com", "totpl");
      const step = currentStep() + 1;
      const code = yield* codeAtStep(secret, step);
      yield* auth.completeStepUpTotp(profile.accountId, code);

      const replayed = yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, code));
      const wrong = yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, "000000"));
      expect(replayed.message).toBe(wrong.message);
    }).pipe(Effect.provide(makeLayer())),
  );
});

describe("TOTP per-account lockout", () => {
  it.effect("blocks even a CORRECT code once the threshold is crossed", () =>
    Effect.gen(function* () {
      const { profile, secret } = yield* enrolled("totp-m@example.com", "totpm");

      for (let i = 0; i < TOTP_LOCKOUT_THRESHOLD; i++) {
        yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, "000000"));
      }

      // The right code, refused: the lockout is keyed on the account, so a
      // rotating fleet cannot spread the guesses past it.
      const good = yield* codeAtStep(secret, currentStep() + 1);
      const err = yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, good));
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("clears the counter after a success", () =>
    Effect.gen(function* () {
      const { profile, secret } = yield* enrolled("totp-n@example.com", "totpn");

      for (let i = 0; i < TOTP_LOCKOUT_THRESHOLD - 1; i++) {
        yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, "000000"));
      }

      vi.useFakeTimers({ toFake: ["Date"] });
      advanceOneStep();
      yield* auth.completeStepUpTotp(profile.accountId, yield* codeAtStep(secret, currentStep()));

      // Were the counter still at threshold-1, one more failure would lock the
      // account and the next correct code would be refused.
      yield* Effect.flip(auth.completeStepUpTotp(profile.accountId, "000000"));
      advanceOneStep();
      const ok = yield* auth.completeStepUpTotp(
        profile.accountId,
        yield* codeAtStep(secret, currentStep()),
      );
      expect(ok.stepUpToken).toMatch(/^eyJ/);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("denies when the lockout store itself fails — fail closed", () =>
    Effect.gen(function* () {
      // A guard is not verified until it has been seen to fail. Recovery codes
      // fail OPEN here on purpose; TOTP must not, because a six-digit code has
      // no wide search space behind the counter.
      const broken = {
        backend: "redis" as const,
        isLocked: () => Promise.resolve(true),
        recordFailure: () => Promise.resolve(TOTP_LOCKOUT_THRESHOLD),
        reset: () => Promise.resolve(),
      };
      const failClosedAuth = createAuthService({ ...config, totpLockoutStore: broken });

      const profile = yield* failClosedAuth.registerProfile("totp-o@example.com", "totpo");
      const err = yield* Effect.flip(
        failClosedAuth.completeStepUpTotp(profile.accountId, "123456"),
      );
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );

  it("the in-memory store honours failClosed on neither read nor write (it cannot fail)", async () => {
    const store = createInMemoryRecoveryLockoutStore({ failClosed: true });
    expect(await store.isLocked("acc_x")).toBe(false);
  });
});

describe("TOTP disable", () => {
  it.effect("removes the credential and is idempotent", () =>
    Effect.gen(function* () {
      const { profile } = yield* enrolled("totp-p@example.com", "totpp");

      const token = yield* auth.issueStepUpToken(profile.accountId, "passkey", "totp_disable");
      const first = yield* auth.disableTotp(profile.accountId, token);
      expect(first.disabled).toBe(true);

      const status = yield* auth.getTotpStatus(profile.accountId);
      expect(status.enrolled).toBe(false);

      const token2 = yield* auth.issueStepUpToken(profile.accountId, "passkey", "totp_disable");
      const second = yield* auth.disableTotp(profile.accountId, token2);
      expect(second.disabled).toBe(false);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("refuses a step-up token minted for another ceremony", () =>
    Effect.gen(function* () {
      const { profile } = yield* enrolled("totp-q@example.com", "totpq");
      const wrong = yield* auth.issueStepUpToken(profile.accountId, "passkey", "recovery_generate");
      const err = yield* Effect.flip(auth.disableTotp(profile.accountId, wrong));
      expect(err._tag).toBe("AuthError");
    }).pipe(Effect.provide(makeLayer())),
  );
});

describe("which gates a totp-AMR step-up token reaches", () => {
  // The design page names three allow-lists; `recoveryGenerateAllowedAmr` is
  // read by five verifiers, so this pins the WHOLE contract rather than the two
  // gates the issue happens to mention.
  const mintTotpToken = (accountId: string, purpose: Parameters<typeof auth.issueStepUpToken>[2]) =>
    auth.issueStepUpToken(accountId, "totp", purpose);

  it.effect("is ACCEPTED at passkey_register", () =>
    Effect.gen(function* () {
      const profile = yield* auth.registerProfile("totp-r@example.com", "totpr");
      const token = yield* mintTotpToken(profile.accountId, "passkey_register");
      const outcome = yield* Effect.result(
        auth.verifyStepUpForPasskeyRegister(profile.accountId, token),
      );
      expect(outcome._tag).toBe("Success");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("is REJECTED at passkey_delete", () =>
    Effect.gen(function* () {
      // The one gate that must stay WebAuthn-only: a stolen access token plus a
      // cloud-synced authenticator seed must not delete the victim's passkeys.
      const profile = yield* auth.registerProfile("totp-s@example.com", "totps");
      const token = yield* mintTotpToken(profile.accountId, "passkey_delete");
      const err = yield* Effect.flip(auth.verifyStepUpForPasskeyDelete(profile.accountId, token));
      expect(err.message).toBe("Step-up factor not permitted");
    }).pipe(Effect.provide(makeLayer())),
  );

  // `recoveryGenerateAllowedAmr` gates FIVE ceremonies, not the one its name
  // suggests. Written out per gate rather than table-driven so each names the
  // verifier it actually exercises.
  it.effect("is ACCEPTED at recovery_generate", () =>
    Effect.gen(function* () {
      const profile = yield* auth.registerProfile("totp-rg@example.com", "totprg");
      const token = yield* mintTotpToken(profile.accountId, "recovery_generate");
      const outcome = yield* Effect.result(
        auth.verifyStepUpForRecoveryGenerate(profile.accountId, token),
      );
      expect(outcome._tag).toBe("Success");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("is ACCEPTED at account_delete, which shares that allow-list", () =>
    Effect.gen(function* () {
      const profile = yield* auth.registerProfile("totp-ad@example.com", "totpad");
      const token = yield* mintTotpToken(profile.accountId, "account_delete");
      const outcome = yield* Effect.result(
        auth.verifyStepUpForAccountDelete(profile.accountId, token),
      );
      expect(outcome._tag).toBe("Success");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("is ACCEPTED at account_export, which shares that allow-list", () =>
    Effect.gen(function* () {
      const profile = yield* auth.registerProfile("totp-ae@example.com", "totpae");
      const token = yield* mintTotpToken(profile.accountId, "account_export");
      const outcome = yield* Effect.result(
        auth.verifyStepUpForAccountExport(profile.accountId, token),
      );
      expect(outcome._tag).toBe("Success");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("is REJECTED at email_change, which keeps its own inline allow-list", () =>
    Effect.gen(function* () {
      // `email-change.ts` hard-codes `new Set(["webauthn","otp"])` — a fourth
      // allow-list no config knob reaches. Left narrow deliberately: the `otp`
      // arm there proves control of the CURRENT mailbox, which a TOTP seed does
      // not, and email change is the silent-takeover pivot.
      const profile = yield* auth.registerProfile("totp-t@example.com", "totpt");
      const token = yield* mintTotpToken(profile.accountId, "email_change");
      const err = yield* Effect.flip(
        auth.completeEmailChange(profile.accountId, "123456", token, null),
      );
      expect(err.message).toBe("Step-up factor not permitted");
    }).pipe(Effect.provide(makeLayer())),
  );
});

describe("TOTP without an encryption key", () => {
  it.effect("fails closed rather than storing anything in plain text", () =>
    Effect.gen(function* () {
      const { totpEncryptionKey: _dropped, ...withoutKey } = config;
      void _dropped;
      const keyless = createAuthService(withoutKey);

      const profile = yield* keyless.registerProfile("totp-u@example.com", "totpu");
      const token = yield* keyless.issueStepUpToken(profile.accountId, "passkey", "totp_enroll");

      const err = yield* Effect.flip(keyless.beginTotpEnrollment(profile.accountId, token));
      expect(err.message).toBe("TOTP is not configured");
    }).pipe(Effect.provide(makeLayer())),
  );
});
