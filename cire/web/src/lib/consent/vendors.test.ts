import { describe, expect, it } from "vitest";

import { CSP_DIRECTIVES } from "../security-headers";
import { CONSENT_CATEGORIES, isConsentCategory } from "./categories";
import {
  CONSENT_VENDORS,
  gatedVendorsInCategory,
  thirdPartyVendors,
  ungatedVendorsInCategory,
  vendorById,
  vendorsInCategory,
} from "./vendors";

/** Every origin named anywhere in the CSP, flattened. */
const cspOrigins = new Set(Object.values(CSP_DIRECTIVES).flat());

describe("vendor registry ↔ CSP consistency", () => {
  it.each(CONSENT_VENDORS.filter((vendor) => vendor.origins.length > 0))(
    "declares $name's origins in the CSP",
    (vendor) => {
      // The registry and the CSP are two descriptions of the same fact: which
      // external origins this site talks to. Before the registry existed they
      // were maintained independently and drifted — a vendor added to one and
      // not the other either gets blocked in the browser (loud) or transfers
      // data nobody declared (silent). This test is the join between them.
      for (const origin of vendor.origins) {
        expect(cspOrigins.has(origin), `${vendor.name}: ${origin} missing from CSP`).toBe(true);
      }
    },
  );

  it("keeps the gated vendors' script/frame origins in the CSP too", () => {
    // Specific spot-checks, so a broad CSP rewrite that drops one of these
    // fails here rather than in a guest's browser.
    expect(CSP_DIRECTIVES["script-src"]).toContain("https://assets.pinterest.com");
    expect(CSP_DIRECTIVES["frame-src"]).toContain("https://www.google.com");
  });
});

describe("vendor registry shape", () => {
  it("gives every vendor a known category", () => {
    for (const vendor of CONSENT_VENDORS) {
      expect(isConsentCategory(vendor.category)).toBe(true);
    }
  });

  it("uses unique ids", () => {
    const ids = CONSENT_VENDORS.map((vendor) => vendor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never marks a `necessary` vendor as gated", () => {
    // A strictly-necessary vendor by definition loads without consent; claiming
    // the toggle governs it would be false, and the toggle can't be switched off
    // anyway.
    for (const vendor of vendorsInCategory("necessary")) {
      expect(vendor.enforcement).toBe("always");
    }
  });

  it("gives every third party a privacy policy link and a named transfer destination", () => {
    // The privacy notice is generated from these fields, so a missing one is a
    // gap in the published disclosure rather than a cosmetic omission.
    for (const vendor of thirdPartyVendors()) {
      expect(vendor.privacyUrl, `${vendor.name} has no privacy URL`).toBeTruthy();
      expect(vendor.transfer, `${vendor.name} has no transfer destination`).toBeTruthy();
    }
  });

  it("declares no origins for first-party-only entries", () => {
    expect(vendorById("cire-session")!.origins).toEqual([]);
    expect(vendorById("consent-record")!.origins).toEqual([]);
  });

  it("resolves the ids the gated components reference", () => {
    // `<ConsentGate vendor="...">` takes a string; these two are the live call
    // sites, and a typo there would silently degrade the placeholder to
    // "This content" instead of naming the company.
    expect(vendorById("pinterest")?.name).toBe("Pinterest");
    expect(vendorById("google-maps")?.name).toBe("Google Maps");
    expect(vendorById("nope")).toBeUndefined();
  });
});

describe("category partitioning", () => {
  it("puts both consent-gated embeds under `embeds`", () => {
    const ids = gatedVendorsInCategory("embeds").map((vendor) => vendor.id);
    expect(ids).toContain("pinterest");
    expect(ids).toContain("google-maps");
  });

  it("lists Google Fonts as loading regardless of the toggle", () => {
    // Honesty check. Fonts load from the document <head>, before any consent can
    // be applied, so the dialog must not imply the switch controls them. If this
    // ever flips to `gated` (or the vendor is removed by self-hosting), this
    // test is the prompt to update the privacy-page note that says so.
    const ids = ungatedVendorsInCategory("embeds").map((vendor) => vendor.id);
    expect(ids).toEqual(["google-fonts"]);
  });

  it("splits every category's vendors into exactly gated + ungated", () => {
    for (const category of CONSENT_CATEGORIES) {
      const all = vendorsInCategory(category);
      const partitioned =
        gatedVendorsInCategory(category).length + ungatedVendorsInCategory(category).length;
      // First-party entries (no origins) belong to neither list — they are not
      // third parties and have nothing to disclose beyond the category summary.
      const firstParty = all.filter((vendor) => vendor.origins.length === 0).length;
      expect(partitioned + firstParty).toBe(all.length);
    }
  });

  it("defines no advertising or marketing category", () => {
    // Deliberate: we don't do it, and an unused toggle is a claim we would have
    // to keep true.
    expect(CONSENT_CATEGORIES as readonly string[]).not.toContain("marketing");
    expect(CONSENT_VENDORS.every((vendor) => (vendor.category as string) !== "marketing")).toBe(
      true,
    );
  });
});
