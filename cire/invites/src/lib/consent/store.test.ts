import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_COOKIE_NAME } from "./cookie";
import { allGrants, defaultGrants } from "./record";
import {
  acceptAllConsent,
  hydrateConsent,
  rejectAllConsent,
  saveConsent,
  setReloadPageForTest,
} from "./store";
import { resetConsentForTest, seedConsentForTest } from "./testing";

/**
 * CON-S-M1 (osn-tracker#162): `saveConsent` reloads the page on a
 * granted → revoked transition for a category that governs at least one
 * `"gated"` vendor — the only way to tear down a third party's already-run
 * side effects, not just stop it loading further. These tests pin the two
 * conditions that gate the reload (see `saveConsent`'s doc in `store.ts`):
 * the transition direction, and a successful cookie write.
 *
 * `location.reload()` itself is not callable in jsdom, so `reloadPage` is
 * substituted with a spy via `setReloadPageForTest` rather than stubbing
 * `window.location` — the module-level indirection `store.ts` defines for
 * exactly this.
 */
describe("saveConsent — reload on granted → revoked (osn-tracker#162)", () => {
  const reload = vi.fn();

  beforeEach(() => {
    resetConsentForTest();
    reload.mockClear();
  });

  afterEach(() => {
    resetConsentForTest();
  });

  it("reloads when a gated category (embeds) goes from granted to revoked", () => {
    seedConsentForTest({ embeds: true });
    hydrateConsent();
    setReloadPageForTest(reload);

    saveConsent({ ...defaultGrants(), embeds: false });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on the FIRST-EVER decision, when 'Reject all' revokes the opt-out default", () => {
    // The common path per the module doc: the banner appears after the
    // opt-out-granted embeds have already loaded, so a guest's very first
    // decision is very often exactly this transition.
    resetConsentForTest();
    hydrateConsent();
    setReloadPageForTest(reload);

    rejectAllConsent();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does NOT reload on revoked → granted", () => {
    seedConsentForTest({ embeds: false });
    hydrateConsent();
    setReloadPageForTest(reload);

    saveConsent({ ...defaultGrants(), embeds: true });

    expect(reload).not.toHaveBeenCalled();
  });

  it("does NOT reload on a no-op save", () => {
    seedConsentForTest({ embeds: true });
    hydrateConsent();
    setReloadPageForTest(reload);

    saveConsent({ ...defaultGrants(), embeds: true });

    expect(reload).not.toHaveBeenCalled();
  });

  it("does NOT reload on a first-time grant (off → on, nothing was ever running)", () => {
    resetConsentForTest();
    hydrateConsent();
    setReloadPageForTest(reload);

    // Accept-all only turns `analytics` on for real (the other opt-out
    // categories are already granted pre-decision) — an off → on move, not a
    // revoke.
    acceptAllConsent();

    expect(reload).not.toHaveBeenCalled();
  });

  it("does NOT reload for a revoked category with no gated vendors (functional)", () => {
    seedConsentForTest({ functional: true });
    hydrateConsent();
    setReloadPageForTest(reload);

    saveConsent({ ...defaultGrants(), functional: false });

    expect(reload).not.toHaveBeenCalled();
  });

  it("does NOT reload when the cookie write's read-back fails, even on a real revoke", () => {
    seedConsentForTest({ embeds: true });
    hydrateConsent();
    setReloadPageForTest(reload);

    // Simulate a blocked write: `document.cookie` accepts nothing, so the
    // read-back inside `writeConsentToDocumentAndVerify` can never show the
    // new value.
    const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => `${CONSENT_COOKIE_NAME}=stale`,
      set: () => {
        // Nothing lands.
      },
    });

    try {
      saveConsent({ ...defaultGrants(), embeds: false });
    } finally {
      if (originalCookieDescriptor) {
        Object.defineProperty(document, "cookie", originalCookieDescriptor);
      }
    }

    // The reload — which would have discarded the very refusal it was meant
    // to enforce, landing the guest back on the opt-out defaults with no
    // record of having tried — must not fire.
    expect(reload).not.toHaveBeenCalled();
  });

  it("round-trips through allGrants() without reloading (accept-all is never a revoke)", () => {
    seedConsentForTest({ embeds: false });
    hydrateConsent();
    setReloadPageForTest(reload);

    saveConsent(allGrants());

    expect(reload).not.toHaveBeenCalled();
  });
});
