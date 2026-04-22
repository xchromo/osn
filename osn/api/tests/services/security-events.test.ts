import { it, expect, describe } from "@effect/vitest";
import { Effect } from "effect";
import { beforeAll } from "vitest";

import { createAuthService } from "../../src/services/auth";
import { makeTestAuthConfig } from "../helpers/auth-config";
import { createTestLayer } from "../helpers/db";

/**
 * M-PK1b: security_events audit trail + out-of-band notification.
 *
 * Invariants we care about:
 *   • generateRecoveryCodesForAccount writes one unacked security_events row
 *     per call, in the same transaction as the code swap.
 *   • listUnacknowledgedSecurityEvents surfaces only unacked rows, newest
 *     first, with the coarse UA label we threaded in from the route.
 *   • acknowledgeSecurityEvent is idempotent on missing / already-acked IDs
 *     and scoped to the owning account.
 *   • If `sendEmail` rejects, the recovery codes still commit — the email
 *     is defence in depth, not the primary signal.
 */

let baseConfig: Awaited<ReturnType<typeof makeTestAuthConfig>>;

beforeAll(async () => {
  baseConfig = await makeTestAuthConfig();
});

const registered = (auth: ReturnType<typeof createAuthService>, email: string, handle: string) =>
  Effect.gen(function* () {
    const profile = yield* auth.registerProfile(email, handle);
    return profile;
  });

describe("generateRecoveryCodesForAccount → security_events", () => {
  it.effect("creates exactly one unacked row per generate call", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const profile = yield* registered(auth, "sev-one@example.com", "sevone");

      yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      const afterFirst = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(afterFirst.events).toHaveLength(1);
      expect(afterFirst.events[0]!.kind).toBe("recovery_code_generate");
      expect(afterFirst.events[0]!.id).toMatch(/^sev_[a-f0-9]{12}$/);

      yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      const afterSecond = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(afterSecond.events).toHaveLength(2);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("captures the UA label + ip hash when passed as eventMeta", () =>
    Effect.gen(function* () {
      const auth = createAuthService({ ...baseConfig, sessionIpPepper: "x".repeat(32) });
      const profile = yield* registered(auth, "sev-meta@example.com", "sevmeta");

      yield* auth.generateRecoveryCodesForAccount(profile.accountId, {
        uaLabel: "Firefox on macOS",
        ip: "203.0.113.7",
      });

      const { events } = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(events[0]!.uaLabel).toBe("Firefox on macOS");
      expect(events[0]!.ipHash).toMatch(/^[a-f0-9]{64}$/);
    }).pipe(Effect.provide(createTestLayer())),
  );

  // The email notification is best-effort. A failing sendEmail must not
  // roll back the generate — that would let an attacker DoS the recovery
  // surface by making the inbox reject mail.
  it.effect("generate still succeeds when sendEmail rejects", () =>
    Effect.gen(function* () {
      const auth = createAuthService({
        ...baseConfig,
        sendEmail: async () => {
          throw new Error("simulated SMTP failure");
        },
      });
      const profile = yield* registered(auth, "sev-mailfail@example.com", "sevmailfail");

      const { recoveryCodes: codes } = yield* auth.generateRecoveryCodesForAccount(
        profile.accountId,
      );
      expect(codes).toHaveLength(10);

      // Audit row still committed.
      const { events } = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(events).toHaveLength(1);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("invokes sendEmail when configured", () =>
    Effect.gen(function* () {
      const sent: Array<{ to: string; subject: string; body: string }> = [];
      const auth = createAuthService({
        ...baseConfig,
        sendEmail: async (to, subject, body) => {
          sent.push({ to, subject, body });
        },
      });
      const profile = yield* registered(auth, "sev-mail@example.com", "sevmail");

      yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe("sev-mail@example.com");
      expect(sent[0]!.subject).toMatch(/recovery code/i);
      // S-L5: codes themselves are NEVER in the notification body.
      expect(sent[0]!.body).not.toMatch(/[0-9a-f]{4}-[0-9a-f]{4}/);
    }).pipe(Effect.provide(createTestLayer())),
  );
});

describe("listUnacknowledgedSecurityEvents", () => {
  it.effect("returns all unacked rows and respects the newest-first contract", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const profile = yield* registered(auth, "sev-order@example.com", "sevorder");

      yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      yield* auth.generateRecoveryCodesForAccount(profile.accountId);

      const { events } = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(events).toHaveLength(2);
      // createdAt is measured in seconds; back-to-back calls may land in
      // the same second. The contract is non-strict: the SQL orders
      // `desc(createdAt)`, so the first entry is never older.
      expect(events[0]!.createdAt).toBeGreaterThanOrEqual(events[1]!.createdAt);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("does not leak events from another account", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const a = yield* registered(auth, "sev-a@example.com", "seva");
      const b = yield* registered(auth, "sev-b@example.com", "sevb");

      yield* auth.generateRecoveryCodesForAccount(a.accountId);
      yield* auth.generateRecoveryCodesForAccount(b.accountId);

      const listA = yield* auth.listUnacknowledgedSecurityEvents(a.accountId);
      expect(listA.events).toHaveLength(1);
      expect(listA.events[0]!.id).toMatch(/^sev_/);
    }).pipe(Effect.provide(createTestLayer())),
  );

  // T-S1: the service caps results at .limit(50). A regression that drops
  // the cap (or the isNull filter) would silently leak unbounded data into
  // the Settings banner.
  it.effect("caps results at 50 even when more unacked rows exist", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const profile = yield* registered(auth, "sev-cap@example.com", "sevcap");
      for (let i = 0; i < 55; i++) {
        yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      }
      const { events } = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(events).toHaveLength(50);
    }).pipe(Effect.provide(createTestLayer())),
  );

  // T-S1: ack + list mixed state — only unacked rows survive the filter.
  it.effect("excludes acknowledged rows when mixed with unacked rows", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const profile = yield* registered(auth, "sev-mix@example.com", "sevmix");

      yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      yield* auth.generateRecoveryCodesForAccount(profile.accountId);

      const beforeAck = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(beforeAck.events).toHaveLength(3);

      // Ack the newest row; the other two must still surface.
      yield* auth.acknowledgeSecurityEvent(profile.accountId, beforeAck.events[0]!.id);
      const afterAck = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(afterAck.events).toHaveLength(2);
      const ids = new Set(afterAck.events.map((e) => e.id));
      expect(ids.has(beforeAck.events[0]!.id)).toBe(false);
    }).pipe(Effect.provide(createTestLayer())),
  );
});

// T-S2: the defensive "account row missing" branch in notifyRecoveryRegeneration
// is unreachable in production (FK + step-up guarantee an account exists), but
// a silent drift that removes the null-check could leak a "sent" metric for a
// notification that never actually dispatched. Pin it.
describe("notifyRecoveryRegeneration (defensive branches)", () => {
  it.effect("resolves without error when the account row is missing", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      // No account created — the lookup short-circuits on `account === undefined`.
      yield* auth.notifyRecoveryRegeneration("acc_doesnotexist00");
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("resolves without error when sendEmail is not configured (local-dev branch)", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig); // no sendEmail
      const profile = yield* registered(auth, "sev-nolocal@example.com", "sevnolocal");
      yield* auth.notifyRecoveryRegeneration(profile.accountId);
    }).pipe(Effect.provide(createTestLayer())),
  );
});

describe("acknowledgeSecurityEvent", () => {
  it.effect("acking a row removes it from the unacked list", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const profile = yield* registered(auth, "sev-ack@example.com", "sevack");

      yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      const { events } = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(events).toHaveLength(1);

      const result = yield* auth.acknowledgeSecurityEvent(profile.accountId, events[0]!.id);
      expect(result.acknowledged).toBe(true);

      const after = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);
      expect(after.events).toHaveLength(0);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("acking a nonexistent id returns { acknowledged: false }", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const profile = yield* registered(auth, "sev-miss@example.com", "sevmiss");

      const result = yield* auth.acknowledgeSecurityEvent(profile.accountId, "sev_000000000000");
      expect(result.acknowledged).toBe(false);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("acking an id scoped to another account is a no-op", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const owner = yield* registered(auth, "sev-owner@example.com", "sevowner");
      const other = yield* registered(auth, "sev-other@example.com", "sevother");

      yield* auth.generateRecoveryCodesForAccount(owner.accountId);
      const { events } = yield* auth.listUnacknowledgedSecurityEvents(owner.accountId);

      // `other` tries to ack owner's event — must silently fail.
      const stolen = yield* auth.acknowledgeSecurityEvent(other.accountId, events[0]!.id);
      expect(stolen.acknowledged).toBe(false);

      // Owner's list is untouched.
      const stillThere = yield* auth.listUnacknowledgedSecurityEvents(owner.accountId);
      expect(stillThere.events).toHaveLength(1);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("double-ack is idempotent: second call returns false", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const profile = yield* registered(auth, "sev-double@example.com", "sevdouble");
      yield* auth.generateRecoveryCodesForAccount(profile.accountId);
      const { events } = yield* auth.listUnacknowledgedSecurityEvents(profile.accountId);

      const first = yield* auth.acknowledgeSecurityEvent(profile.accountId, events[0]!.id);
      const second = yield* auth.acknowledgeSecurityEvent(profile.accountId, events[0]!.id);
      expect(first.acknowledged).toBe(true);
      expect(second.acknowledged).toBe(false);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("malformed ids are rejected at the service boundary without hitting the DB", () =>
    Effect.gen(function* () {
      const auth = createAuthService(baseConfig);
      const profile = yield* registered(auth, "sev-malformed@example.com", "sevmalformed");

      const result = yield* auth.acknowledgeSecurityEvent(profile.accountId, "not-a-valid-id");
      expect(result.acknowledged).toBe(false);
    }).pipe(Effect.provide(createTestLayer())),
  );
});
