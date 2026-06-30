import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";

import { PulseHero } from "./PulseHero";

const baseProps = {
  appUrl: "https://app.example.com",
  howHref: "#how-it-works",
};

describe("PulseHero", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the editorial headline with its italic accent word", () => {
    const { getByRole, getByText } = render(() => <PulseHero {...baseProps} />);
    const heading = getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/Find what/i);
    expect(getByText("happening")).toBeTruthy();
  });

  it("falls back to the generic CTA when geo is unavailable", async () => {
    // No /api/geo in the test env, so the location-aware enhancement never
    // resolves and the hero keeps its generic copy + app-root CTA.
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
