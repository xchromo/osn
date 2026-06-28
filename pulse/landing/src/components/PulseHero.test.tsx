import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PulseHero } from "./PulseHero";

const baseProps = {
  appUrl: "https://app.example.com",
  howHref: "#how-it-works",
};

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: reduced,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

describe("PulseHero", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    // The reduced-motion path is the most robust: it snaps the content visible
    // synchronously on mount without waiting on requestAnimationFrame.
    setReducedMotion(true);
  });

  it("renders the editorial headline with its italic accent word", () => {
    const { getByRole, getByText } = render(() => <PulseHero {...baseProps} />);
    const heading = getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/Find what/i);
    expect(getByText("happening")).toBeTruthy();
  });

  it("exposes both CTAs with the correct targets", async () => {
    const { getByRole } = render(() => <PulseHero {...baseProps} />);

    await waitFor(() => {
      const primary = getByRole("link", { name: /find events/i }) as HTMLAnchorElement;
      expect(primary.getAttribute("href")).toBe("https://app.example.com");
      const secondary = getByRole("link", { name: /how it works/i }) as HTMLAnchorElement;
      expect(secondary.getAttribute("href")).toBe("#how-it-works");
    });
  });

  it("labels the hero region for assistive tech", () => {
    const { getByRole } = render(() => <PulseHero {...baseProps} />);
    expect(getByRole("region", { name: /pulse — find your scene/i })).toBeTruthy();
  });
});
