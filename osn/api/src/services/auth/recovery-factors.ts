/**
 * Account recovery by a factor that is neither a passkey nor a recovery code:
 * a code emailed to the address on file, or a code from the account's
 * authenticator app.
 *
 * These are the two paths back in for a user who has lost the device and never
 * printed the codes. Neither is a login factor. Both end in the **restricted
 * recovery session** `tokens.ts` builds — `aud: "osn-recovery"`, a 15-minute
 * absolute lifetime, rejected by every verifier in this service and in the three
 * downstream services — whose only privilege is enrolling a passkey. See
 * `[[wiki/architecture/account-recovery-factors]]` §B.
 *
 * Four properties carry this module, and each is enforced here rather than at
 * the routes:
 *
 * - **`begin` answers the same 202 whether or not the identifier resolves**, and
 *   costs roughly the same either way. A uniform body is not enough on its own:
 *   the mail send is the oracle, so it is dispatched detached and both branches
 *   return at probe cost.
 * - **The recipient is the victim.** The address is the account holder's own, so
 *   the send is capped per resolved account as well as per IP.
 * - **Completion matches `consumeRecoveryCode`**: every session on the account
 *   is revoked and the audit row is written in the same batch, before the new
 *   session exists.
 * - **Every code check is constant-time**, and no code reaches a log line, a
 *   metric attribute, an error body or the OpenAPI document.
 */

import { securityEvents, sessions } from "@osn/db/schema";
import { Db } from "@osn/db/service";
import { timingSafeEqualString } from "@shared/crypto/timing-safe";
import { verifyTotpCode } from "@shared/crypto/totp";
import { commitBatch } from "@shared/db-utils";
import { type EmailError, EmailService } from "@shared/email";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { RECOVERY_LOCKOUT_THRESHOLD } from "../../lib/recovery-lockout-store";
import {
  metricAuthOtpSent,
  metricRecoveryEmailBegin,
  metricRecoveryLockout,
  metricSecurityEventRecorded,
  metricSessionSecurityInvalidation,
  withAuthLogin,
  withAuthRecovery,
} from "../../metrics";
import { MAX_OTP_ATTEMPTS, RECOVERY_OTP_TTL_MS } from "./constants";
import type { AuthContext } from "./context";
import { AuthError, DatabaseError } from "./errors";
import {
  genId,
  genOtpCode,
  hashSessionToken,
  logDevOtp,
  looksLikeEmail,
  normaliseIdentifier,
  probeAccountId,
} from "./helpers";
import type { ProfilesModule } from "./profiles";
import type { SecurityEventsModule } from "./security-events";
import type { TokensModule } from "./tokens";
import type { TotpModule } from "./totp";
import type { ProfileWithEmail, PublicProfile, SessionMeta, TokenSet } from "./types";
import { toPublicProfile } from "./types";

/**
 * The single failure message every rejected code check answers with. A caller
 * learns the attempt failed and nothing else — not whether the identifier names
 * an account, not whether a code is pending, not whether the account is locked
 * out. `publicError` flattens it to `{ error: "invalid_request" }` before it
 * reaches the wire; the string is what appears in a server-side log.
 */
const GENERIC_FAILURE = "Invalid or expired code";

/** What `begin` answers, on every branch. */
export interface RecoveryEmailBeginResult {
  readonly status: "accepted";
}

export function createRecoveryFactorsModule(
  ctx: AuthContext,
  profiles: ProfilesModule,
  tokens: TokensModule,
  totp: TotpModule,
  securityEventsModule: SecurityEventsModule,
) {
  const { stores, hashIp, recoveryEmailBeginCap, recoveryOtpLockoutStore } = ctx;
  const { resolveIdentifier } = profiles;
  const { issueRecoverySession } = tokens;
  const { checkTotpCode } = totp;

  const ACCEPTED: RecoveryEmailBeginResult = { status: "accepted" };
  const otpTtlMinutes = RECOVERY_OTP_TTL_MS / 60_000;

  /**
   * Burn one ceremony-store read without creating anything.
   *
   * The unknown-identifier branches use this to pay for the store round trips a
   * resolving caller makes, so response latency does not separate an address
   * that names an account from one that does not. `probeAccountId` is a fresh
   * random id per call (never a fixed sentinel an attacker could seed a row
   * under — see its docstring), so the read is guaranteed to miss at the same
   * indexed cost as a real one.
   *
   * A READ, deliberately. The obvious alternative — running the real cap check
   * or the real lockout against a probe id — writes a counter key per probe
   * request, each with a multi-hour TTL, which turns a latency-equalising
   * measure into unbounded key growth driven by an unauthenticated endpoint.
   */
  const burnProbeRead = (): Effect.Effect<void> =>
    Effect.promise(() => stores.pendingRecoveryOtp.get(probeAccountId())).pipe(Effect.asVoid);

  /**
   * Send the recovery code, off the request's latency path.
   *
   * Forked detached with a timeout, the shape `notifyRecovery` uses. Awaiting it
   * would make the response an account-existence oracle that no amount of body
   * uniformity can close: a Resend round trip is hundreds of milliseconds and
   * the non-resolving branch's probe is sub-millisecond, so the two branches
   * would be trivially separable by anyone with a stopwatch.
   *
   * The provider's response body — which can echo the recipient — is never
   * logged; only the bounded outcome metric is emitted.
   *
   * A detached fibre is not currently guaranteed to run to completion on the
   * deployed Worker: the request context is torn down once the response is
   * returned, and nothing hands this fibre to `ExecutionContext.waitUntil`.
   * Tracked in xchromo/osn#971, which covers all five detached sends in this
   * service.
   */
  const sendRecoveryOtp = (
    recipientEmail: string,
    code: string,
  ): Effect.Effect<void, AuthError, EmailService> =>
    Effect.gen(function* () {
      const email = yield* EmailService;
      yield* email
        .send({
          template: "otp-recovery",
          to: recipientEmail,
          data: { code, ttlMinutes: otpTtlMinutes },
        })
        .pipe(
          Effect.mapError(
            (cause: EmailError) => new AuthError({ message: `recovery_send_${cause.reason}` }),
          ),
        );
    }).pipe(Effect.withSpan("auth.recovery.otp_send"));

  /**
   * `POST /login/recovery/email/begin` — email an account-recovery code.
   *
   * Always answers {@link ACCEPTED}. The caller cannot tell a delivered code
   * from an unknown address from an account that has hit its cap, and the three
   * branches are told apart only on a dashboard.
   *
   * The identifier must be an **email address**: this endpoint puts mail in
   * somebody's inbox, and a handle is public, so accepting one would turn a
   * public identifier into a way to mail a stranger. `/login/passkey/begin` can
   * take a handle precisely because it sends nothing. The check is syntactic —
   * it reads only the submitted string and never touches the database — so
   * refusing a handle discloses nothing about any account.
   */
  const beginEmailRecovery = (
    identifier: string,
  ): Effect.Effect<RecoveryEmailBeginResult, AuthError | DatabaseError, Db | EmailService> =>
    Effect.gen(function* () {
      const normalised = normaliseIdentifier(identifier).trim().toLowerCase();
      if (!looksLikeEmail(normalised)) {
        return yield* Effect.fail(
          new AuthError({ message: "Enter the email address on the account" }),
        );
      }

      const profile = yield* resolveIdentifier(normalised);
      if (!profile) {
        // Match the resolving branch's two store round trips — one standing in
        // for the cap check, one for the entry write — so the branches cost the
        // same. Parity is APPROXIMATE, not exact, exactly as
        // `consumeRecoveryCode` concedes for its own: the resolving branch also
        // runs `genOtpCode` and a SHA-256, both sub-microsecond and both dwarfed
        // by a single store hop. What the detached send removes is the term that
        // actually mattered.
        yield* burnProbeRead();
        yield* burnProbeRead();
        metricRecoveryEmailBegin("unknown_identifier");
        return ACCEPTED;
      }

      // Keyed on the RESOLVED accountId, never the submitted identifier. Keying
      // on the identifier would let an attacker exhaust a victim's allowance by
      // naming them, and would make the cap itself an existence oracle.
      const allowed = yield* Effect.promise(() => recoveryEmailBeginCap.check(profile.accountId));
      if (!allowed) {
        // Return WITHOUT parking a code. Parking one here would invalidate the
        // code the user is already holding from an earlier send — a denial of
        // service on the account holder, dressed as flood control.
        metricRecoveryEmailBegin("capped");
        return ACCEPTED;
      }

      const code = genOtpCode();
      yield* Effect.promise(() =>
        stores.pendingRecoveryOtp.set(
          profile.accountId,
          {
            codeHash: hashSessionToken(code),
            attempts: 0,
            expiresAt: Date.now() + RECOVERY_OTP_TTL_MS,
          },
          RECOVERY_OTP_TTL_MS,
        ),
      );

      // Inert unless the runtime tier is `local` — the same helper the
      // registration, step-up and email-change ceremonies use, and the only way
      // to complete this flow on a dev machine with no inbox.
      yield* logDevOtp("recovery", code);

      yield* Effect.forkDetach(
        sendRecoveryOtp(profile.email, code).pipe(
          Effect.timeout("10 seconds"),
          Effect.catch(() => Effect.void),
        ),
      );

      metricAuthOtpSent("recovery");
      metricRecoveryEmailBegin("sent");
      return ACCEPTED;
    }).pipe(withAuthRecovery("email_begin"));

  /**
   * Everything both factors do once the code has been believed.
   *
   * Matches `consumeRecoveryCode` deliberately and in detail — that function is
   * the existing recovery ceremony and a second one that revoked less, or
   * recorded less, would be a quieter way into the same account.
   *
   * The wipe and the audit row commit together, and both happen BEFORE the new
   * session is issued. Two reasons, and the ordering satisfies both: a wipe
   * after issuance would delete the session it had just minted, and batching the
   * audit row with the wipe rather than the insert means a failure between the
   * two leaves a recorded recovery and no session — loud and safe — rather than
   * a session nobody can see was created.
   */
  const completeRecoveryFactor = (
    profile: ProfileWithEmail,
    sessionMeta?: SessionMeta,
  ): Effect.Effect<
    { session: TokenSet; profile: PublicProfile },
    AuthError | DatabaseError,
    Db | EmailService
  > =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const nowSec = Math.floor(Date.now() / 1000);

      const securityEventRow: typeof securityEvents.$inferInsert = {
        id: genId("sev_"),
        accountId: profile.accountId,
        kind: "account_recovered",
        createdAt: nowSec,
        acknowledgedAt: null,
        ipHash: sessionMeta?.ip ? hashIp(sessionMeta.ip) : null,
        uaLabel: sessionMeta?.uaLabel ?? null,
      };

      yield* Effect.tryPromise({
        try: () =>
          commitBatch(db, [
            db.delete(sessions).where(eq(sessions.accountId, profile.accountId)),
            db.insert(securityEvents).values(securityEventRow),
          ]),
        catch: (cause) => new DatabaseError({ cause }),
      });

      metricSessionSecurityInvalidation("account_recovered");
      metricSecurityEventRecorded("account_recovered");

      // The audit row is the primary signal and it is already committed; the
      // email is the confirmation, so user-visible latency must not track
      // mailer health. Same detached-with-timeout shape as every other notice,
      // and the same caveat — see xchromo/osn#971.
      yield* Effect.forkDetach(
        securityEventsModule
          .notifySecurityEventByAccountId(profile.accountId, "account_recovered", "recovery-used")
          .pipe(
            Effect.timeout("10 seconds"),
            Effect.catch(() => Effect.void),
          ),
      );

      const session = yield* issueRecoverySession(
        profile.id,
        profile.accountId,
        profile.email,
        profile.handle,
        profile.displayName,
        sessionMeta,
      );

      return { session, profile: toPublicProfile(profile, profile.email) };
    });

  /**
   * `POST /login/recovery/email/complete` — exchange the emailed code for a
   * restricted recovery session.
   *
   * Accepts an email address or a handle. The email-only rule belongs to
   * `begin`, which sends mail; this route sends nothing, and answers the same
   * generic failure to anyone not holding the code.
   */
  const completeEmailRecovery = (
    identifier: string,
    code: string,
    sessionMeta?: SessionMeta,
  ): Effect.Effect<
    { session: TokenSet; profile: PublicProfile },
    AuthError | DatabaseError,
    Db | EmailService
  > =>
    Effect.gen(function* () {
      const normalised = normaliseIdentifier(identifier);
      const profile = yield* resolveIdentifier(normalised);

      // Hashed up front on every branch so both pay the same SHA-256, whether or
      // not there is anything to compare it against.
      const codeHash = hashSessionToken(code);

      if (!profile) {
        yield* burnProbeRead();
        return yield* Effect.fail(new AuthError({ message: GENERIC_FAILURE }));
      }

      // Fail-closed: an unreachable counter behind a six-digit code is no
      // throttle at all. The pending code lives in the same store, so an outage
      // fails this ceremony at the next read regardless — closing here costs
      // nothing that was still working.
      const locked = yield* Effect.promise(() =>
        recoveryOtpLockoutStore.isLocked(profile.accountId),
      );
      if (locked) {
        // Read anyway, for latency parity with the branch below, and answer the
        // same generic failure: a locked account must be indistinguishable from
        // a wrong code, or the lockout becomes its own oracle.
        yield* Effect.promise(() => stores.pendingRecoveryOtp.get(profile.accountId));
        metricRecoveryLockout("locked");
        return yield* Effect.fail(new AuthError({ message: GENERIC_FAILURE }));
      }

      const entry = yield* Effect.promise(() => stores.pendingRecoveryOtp.get(profile.accountId));
      if (!entry || Date.now() > entry.expiresAt) {
        // Deliberately NOT counted as a failed attempt. There is no pending code
        // here, so this is not a guess against anything — and counting it would
        // hand anyone who knows the identifier a lever to lock the owner out of
        // their own recovery without ever guessing a digit.
        return yield* Effect.fail(new AuthError({ message: GENERIC_FAILURE }));
      }

      if (!timingSafeEqualString(entry.codeHash, codeHash)) {
        const attempts = entry.attempts + 1;
        if (attempts >= MAX_OTP_ATTEMPTS) {
          yield* Effect.promise(() => stores.pendingRecoveryOtp.delete(profile.accountId));
        } else {
          yield* Effect.promise(() =>
            stores.pendingRecoveryOtp.set(
              profile.accountId,
              { ...entry, attempts },
              Math.max(0, entry.expiresAt - Date.now()),
            ),
          );
        }
        // The per-entry cap and this counter coincide on the first entry by
        // construction (both are 5). What the counter adds is the SECOND and
        // THIRD entries: without it the 3-per-24h send cap would still allow
        // fifteen guesses inside the lockout window.
        const failures = yield* Effect.promise(() =>
          recoveryOtpLockoutStore.recordFailure(profile.accountId),
        );
        if (failures >= RECOVERY_LOCKOUT_THRESHOLD) {
          metricRecoveryLockout("locked");
          yield* recordLockoutEvent(profile.accountId, sessionMeta);
        } else {
          metricRecoveryLockout("recorded");
        }
        return yield* Effect.fail(new AuthError({ message: GENERIC_FAILURE }));
      }

      yield* Effect.promise(() => stores.pendingRecoveryOtp.delete(profile.accountId));
      yield* Effect.promise(() => recoveryOtpLockoutStore.reset(profile.accountId));
      metricRecoveryLockout("reset");

      return yield* completeRecoveryFactor(profile, sessionMeta);
    }).pipe(withAuthRecovery("email_complete"), withAuthLogin("email_recovery"));

  /**
   * Write the `recovery_otp_lockout` audit row when an account crosses the
   * failed-attempt threshold, so the owner sees "repeated failed recovery
   * attempts" in the security banner even though every attempt answered the
   * same generic error over the wire.
   *
   * Best-effort: a write failure is logged and never turns the already-correct
   * generic failure into a 500. Mirrors `recordRecoveryLockoutEvent` in
   * `recovery.ts`.
   */
  const recordLockoutEvent = (
    accountId: string,
    eventMeta?: SessionMeta,
  ): Effect.Effect<void, never, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const nowSec = Math.floor(Date.now() / 1000);
      yield* Effect.tryPromise({
        try: () =>
          db.insert(securityEvents).values({
            id: genId("sev_"),
            accountId,
            kind: "recovery_otp_lockout",
            createdAt: nowSec,
            acknowledgedAt: null,
            ipHash: eventMeta?.ip ? hashIp(eventMeta.ip) : null,
            uaLabel: eventMeta?.uaLabel ?? null,
          }),
        catch: (cause) => new DatabaseError({ cause }),
      }).pipe(
        Effect.tap(() => Effect.sync(() => metricSecurityEventRecorded("recovery_otp_lockout"))),
        Effect.catch((cause) =>
          Effect.logWarning("auth.recovery.otp_lockout: audit write failed").pipe(
            Effect.annotateLogs({ error: String(cause) }),
          ),
        ),
      );
    }).pipe(Effect.withSpan("auth.recovery.otp_lockout"));

  /**
   * `POST /login/recovery/totp/complete` — exchange an authenticator code for a
   * restricted recovery session.
   *
   * The path for a user who has lost the device **and** cannot reach the
   * mailbox. `checkTotpCode` owns the per-account lockout, the single-use step
   * consumption RFC 6238 §5.2 requires, and the constant-cost branch for an
   * account with no authenticator — going through it rather than re-deriving the
   * check is what keeps all three from being forgotten here.
   *
   * The `"recovery"` scope is load-bearing: it keys the lockout separately from
   * `POST /step-up/totp/complete`, so failures at this unauthenticated route
   * cannot lock the authenticated ceremony for anyone who knows a handle.
   */
  const completeTotpRecovery = (
    identifier: string,
    code: string,
    sessionMeta?: SessionMeta,
  ): Effect.Effect<
    { session: TokenSet; profile: PublicProfile },
    AuthError | DatabaseError,
    Db | EmailService
  > =>
    Effect.gen(function* () {
      const normalised = normaliseIdentifier(identifier);
      const profile = yield* resolveIdentifier(normalised);

      if (!profile) {
        // Mirror the cost of the branch `checkTotpCode` would have taken: one
        // store read, then a full verification against an empty secret. That is
        // the same trick `checkTotpCode` plays for an account with no
        // credential — it derives and compares the same number of candidates
        // against a dummy key — extended to the case where the IDENTIFIER, not
        // the credential, is what is missing. No counter is touched: a probe id
        // must not leave a lockout key behind.
        yield* burnProbeRead();
        yield* Effect.promise(() => verifyTotpCode({ secret: new Uint8Array(0), code }));
        return yield* Effect.fail(new AuthError({ message: GENERIC_FAILURE }));
      }

      yield* checkTotpCode(profile.accountId, code, "recovery");
      return yield* completeRecoveryFactor(profile, sessionMeta);
    }).pipe(withAuthRecovery("totp_complete"), withAuthLogin("totp_recovery"));

  return {
    beginEmailRecovery,
    completeEmailRecovery,
    completeTotpRecovery,
  };
}

export type RecoveryFactorsModule = ReturnType<typeof createRecoveryFactorsModule>;
