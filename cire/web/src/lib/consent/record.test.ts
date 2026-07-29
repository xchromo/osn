import { describe, expect, it } from "vitest";

import {
  allGrants,
  CONSENT_POLICY_VERSION,
  CONSENT_RECORD_VERSION,
  decodeConsentRecord,
  defaultGrants,
  encodeConsentRecord,
  isGranted,
  makeConsentRecord,
  normaliseGrants,
} from "./record";

const NOW = new Date("2026-07-29T10:00:00.000Z");

describe("defaultGrants", () => {
  it("switches every optional category OFF and the required one ON", () => {
    // This is the opt-in invariant: a guest who has never been asked is in
    // exactly the same state as one who pressed "Reject all".
    expect(defaultGrants()).toEqual({
      necessary: true,
      functional: false,
      embeds: false,
      analytics: false,
    });
  });
});

describe("normaliseGrants", () => {
  it("forces required categories on regardless of the input", () => {
    // Nothing — not a stale cookie, not a caller mistake — may switch off the
    // storage the invite needs to function at all.
    expect(normaliseGrants({ necessary: false, embeds: true }).necessary).toBe(true);
  });

  it("drops unknown keys instead of carrying them into the record", () => {
    const grants = normaliseGrants({ embeds: true, marketing: true, __proto__: true });
    expect(grants).toEqual({
      necessary: true,
      functional: false,
      embeds: true,
      analytics: false,
    });
    expect("marketing" in grants).toBe(false);
  });

  it("treats any non-`true` value as a refusal", () => {
    // A truthy-but-not-true value ("yes", 1) must never be read as consent.
    const grants = normaliseGrants({ embeds: "yes", analytics: 1, functional: null });
    expect(grants.embeds).toBe(false);
    expect(grants.analytics).toBe(false);
    expect(grants.functional).toBe(false);
  });

  it("fills in missing categories as refused", () => {
    expect(normaliseGrants({}).embeds).toBe(false);
  });

  it("returns the safe default for non-object input", () => {
    expect(normaliseGrants(null)).toEqual(defaultGrants());
    expect(normaliseGrants("embeds")).toEqual(defaultGrants());
  });
});

describe("encode/decode round trip", () => {
  it("preserves the grants, the timestamp and both versions", () => {
    const record = makeConsentRecord({ ...defaultGrants(), embeds: true }, NOW);
    const decoded = decodeConsentRecord(encodeConsentRecord(record));

    expect(decoded).not.toBeNull();
    expect(decoded!.grants.embeds).toBe(true);
    expect(decoded!.grants.analytics).toBe(false);
    expect(decoded!.decidedAt).toBe(NOW.toISOString());
    expect(decoded!.v).toBe(CONSENT_RECORD_VERSION);
    expect(decoded!.policy).toBe(CONSENT_POLICY_VERSION);
  });

  it("round-trips an accept-all record", () => {
    const decoded = decodeConsentRecord(encodeConsentRecord(makeConsentRecord(allGrants(), NOW)));
    expect(decoded!.grants).toEqual(allGrants());
  });

  it("round-trips a reject-all record as a real decision, not an absence", () => {
    // The distinction the whole design turns on: "refused everything" must
    // decode to a record (so we stop asking), not to null (which re-prompts).
    const decoded = decodeConsentRecord(
      encodeConsentRecord(makeConsentRecord(defaultGrants(), NOW)),
    );
    expect(decoded).not.toBeNull();
    expect(decoded!.grants.embeds).toBe(false);
  });
});

describe("decodeConsentRecord — inputs it must refuse to trust", () => {
  it("returns null for absent input", () => {
    expect(decodeConsentRecord(null)).toBeNull();
    expect(decodeConsentRecord(undefined)).toBeNull();
    expect(decodeConsentRecord("")).toBeNull();
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(decodeConsentRecord("not-json")).toBeNull();
    expect(decodeConsentRecord(encodeURIComponent("{ broken"))).toBeNull();
  });

  it("returns null for invalid percent-escapes rather than throwing", () => {
    expect(decodeConsentRecord("%E0%A4%A")).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(decodeConsentRecord(encodeURIComponent(JSON.stringify("granted")))).toBeNull();
    expect(decodeConsentRecord(encodeURIComponent(JSON.stringify(null)))).toBeNull();
  });

  it("returns null when the storage version does not match", () => {
    const stale = encodeURIComponent(
      JSON.stringify({
        v: CONSENT_RECORD_VERSION + 1,
        policy: CONSENT_POLICY_VERSION,
        decidedAt: NOW.toISOString(),
        grants: allGrants(),
      }),
    );
    expect(decodeConsentRecord(stale)).toBeNull();
  });

  it("returns null when the POLICY version does not match, so the guest is re-asked", () => {
    // The load-bearing rule: consent given against an older disclosure was never
    // informed about whatever vendor was added since, so it cannot be reused.
    const stale = encodeURIComponent(
      JSON.stringify({
        v: CONSENT_RECORD_VERSION,
        policy: "2020-01-01",
        decidedAt: NOW.toISOString(),
        grants: allGrants(),
      }),
    );
    expect(decodeConsentRecord(stale)).toBeNull();
  });

  it("returns null when the decision timestamp is missing", () => {
    const noTimestamp = encodeURIComponent(
      JSON.stringify({
        v: CONSENT_RECORD_VERSION,
        policy: CONSENT_POLICY_VERSION,
        grants: allGrants(),
      }),
    );
    expect(decodeConsentRecord(noTimestamp)).toBeNull();
  });

  it("sanitises a tampered record instead of honouring it", () => {
    // A hand-edited cookie claiming every category is on, including one that
    // does not exist, and necessary switched off.
    const tampered = encodeURIComponent(
      JSON.stringify({
        v: CONSENT_RECORD_VERSION,
        policy: CONSENT_POLICY_VERSION,
        decidedAt: NOW.toISOString(),
        grants: { necessary: false, embeds: "yes", marketing: true },
      }),
    );
    const decoded = decodeConsentRecord(tampered)!;
    expect(decoded.grants.necessary).toBe(true);
    expect(decoded.grants.embeds).toBe(false);
    expect("marketing" in decoded.grants).toBe(false);
  });
});

describe("isGranted", () => {
  it("falls back to the deny-by-default floor for a null record", () => {
    expect(isGranted(null, "embeds")).toBe(false);
    expect(isGranted(null, "analytics")).toBe(false);
    expect(isGranted(null, "necessary")).toBe(true);
  });

  it("reads the stored decision when there is one", () => {
    const record = makeConsentRecord({ ...defaultGrants(), embeds: true }, NOW);
    expect(isGranted(record, "embeds")).toBe(true);
    expect(isGranted(record, "functional")).toBe(false);
  });
});
