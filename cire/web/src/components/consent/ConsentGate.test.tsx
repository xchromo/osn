import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readConsentFromDocument } from "../../lib/consent/cookie";
import { consentPreferencesOpen, resetConsentStoreForTest } from "../../lib/consent/store";
import { resetConsentForTest, seedConsentForTest } from "../../lib/consent/testing";
import { ConsentGate } from "./ConsentGate";

/**
 * A child that records whether it was ever constructed. This is the assertion
 * that matters for the whole framework: a gate that merely HIDES its children
 * would still have run their side effects — mounted an iframe, injected a
 * tracker — before anything was hidden. Consent has to prevent construction,
 * not appearance.
 */
function makeSpyChild() {
  const mounted = vi.fn();
  const Child = () => {
    mounted();
    return <div data-testid="gated">gated content</div>;
  };
  return { Child, mounted };
}

describe("ConsentGate", () => {
  beforeEach(resetConsentForTest);

  afterEach(() => {
    cleanup();
    resetConsentForTest();
  });

  it("does not construct its children before a decision is made", () => {
    const { Child, mounted } = makeSpyChild();
    const { queryByTestId } = render(() => (
      <ConsentGate category="embeds" vendor="pinterest">
        <Child />
      </ConsentGate>
    ));

    expect(mounted).not.toHaveBeenCalled();
    expect(queryByTestId("gated")).toBeNull();
  });

  it("does not construct its children when the guest refused", () => {
    seedConsentForTest({ embeds: false });
    const { Child, mounted } = makeSpyChild();
    render(() => (
      <ConsentGate category="embeds" vendor="pinterest">
        <Child />
      </ConsentGate>
    ));

    expect(mounted).not.toHaveBeenCalled();
  });

  it("renders its children when the category is granted", () => {
    seedConsentForTest({ embeds: true });
    const { Child, mounted } = makeSpyChild();
    const { getByTestId } = render(() => (
      <ConsentGate category="embeds" vendor="pinterest">
        <Child />
      </ConsentGate>
    ));

    expect(mounted).toHaveBeenCalledTimes(1);
    expect(getByTestId("gated")).toBeTruthy();
  });

  it("checks the category it was given, not just any granted category", () => {
    seedConsentForTest({ embeds: true, analytics: false });
    const { Child, mounted } = makeSpyChild();
    render(() => (
      <ConsentGate category="analytics" vendor="pinterest">
        <Child />
      </ConsentGate>
    ));

    expect(mounted).not.toHaveBeenCalled();
  });

  it("hydrates from the cookie without needing a banner on the page", () => {
    // A gate must work on any page — including one where the guest already
    // decided, so the banner never renders and cannot be the thing that reads
    // the cookie.
    seedConsentForTest({ embeds: true });
    const { getByTestId } = render(() => (
      <ConsentGate category="embeds" vendor="pinterest">
        <div data-testid="gated">content</div>
      </ConsentGate>
    ));
    expect(getByTestId("gated")).toBeTruthy();
  });

  describe("the default placeholder", () => {
    it("names the vendor and what it would do", () => {
      const { container } = render(() => (
        <ConsentGate category="embeds" vendor="pinterest">
          <div>content</div>
        </ConsentGate>
      ));

      const text = container.textContent ?? "";
      expect(text).toContain("Pinterest");
      expect(text).toContain("inspiration moodboard");
      expect(text).toContain("IP address");
    });

    it("grants the category — and persists it — when the allow button is clicked", () => {
      const { container, getByTestId } = render(() => (
        <ConsentGate category="embeds" vendor="pinterest">
          <div data-testid="gated">content</div>
        </ConsentGate>
      ));

      fireEvent.click(container.querySelector("button")!);

      expect(getByTestId("gated")).toBeTruthy();
      expect(readConsentFromDocument()?.grants.embeds).toBe(true);
    });

    it("grants ONLY the category it names", () => {
      const { container } = render(() => (
        <ConsentGate category="embeds" vendor="pinterest">
          <div>content</div>
        </ConsentGate>
      ));
      fireEvent.click(container.querySelector("button")!);

      const grants = readConsentFromDocument()!.grants;
      expect(grants.embeds).toBe(true);
      expect(grants.analytics).toBe(false);
      expect(grants.functional).toBe(false);
    });

    it("offers the preferences dialog as an alternative to one-click accept", () => {
      const { getByText } = render(() => (
        <ConsentGate category="embeds" vendor="pinterest">
          <div>content</div>
        </ConsentGate>
      ));

      expect(consentPreferencesOpen()).toBe(false);
      fireEvent.click(getByText("Privacy choices"));
      expect(consentPreferencesOpen()).toBe(true);
    });

    it("degrades to a neutral notice for an unknown vendor id", () => {
      const { container } = render(() => (
        <ConsentGate category="embeds" vendor="not-in-the-registry">
          <div>content</div>
        </ConsentGate>
      ));
      expect(container.textContent ?? "").toContain("This content");
    });
  });

  describe("a custom fallback", () => {
    it("replaces the placeholder entirely", () => {
      const { getByTestId, container } = render(() => (
        <ConsentGate
          category="embeds"
          vendor="google-maps"
          fallback={<div data-testid="fallback">a perfectly good map card</div>}
        >
          <div data-testid="gated">the real embed</div>
        </ConsentGate>
      ));

      expect(getByTestId("fallback")).toBeTruthy();
      expect(container.textContent ?? "").not.toContain("Allow third-party content");
    });

    it("is dropped once consent is granted", () => {
      seedConsentForTest({ embeds: true });
      const { getByTestId, queryByTestId } = render(() => (
        <ConsentGate
          category="embeds"
          vendor="google-maps"
          fallback={<div data-testid="fallback">card</div>}
        >
          <div data-testid="gated">embed</div>
        </ConsentGate>
      ));

      expect(getByTestId("gated")).toBeTruthy();
      expect(queryByTestId("fallback")).toBeNull();
    });
  });

  it("reveals gated content across independent gates the moment consent lands", () => {
    // Two gates rendered separately (as two embeds in different modal sections
    // are) share the module-level store, so one grant unblocks both.
    const a = render(() => (
      <ConsentGate category="embeds" vendor="pinterest">
        <div data-testid="a">A</div>
      </ConsentGate>
    ));
    const b = render(() => (
      <ConsentGate category="embeds" vendor="google-maps">
        <div data-testid="b">B</div>
      </ConsentGate>
    ));

    expect(a.queryByTestId("a")).toBeNull();
    expect(b.queryByTestId("b")).toBeNull();

    fireEvent.click(a.container.querySelector("button")!);

    expect(a.getByTestId("a")).toBeTruthy();
    expect(b.getByTestId("b")).toBeTruthy();
  });

  it("stays closed if the store is reset without a cookie (the pre-hydration state)", () => {
    // Before hydration completes there is no decision to read, and the gate must
    // deny rather than optimistically allow — otherwise a tracker could slip out
    // in the window between first paint and the cookie read.
    resetConsentStoreForTest();
    const { Child, mounted } = makeSpyChild();
    render(() => (
      <ConsentGate category="embeds" vendor="pinterest">
        <Child />
      </ConsentGate>
    ));
    expect(mounted).not.toHaveBeenCalled();
  });
});
