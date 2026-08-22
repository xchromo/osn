// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GIFT_REGISTRY_EYEBROW,
  DEFAULT_GIFT_REGISTRY_HEADING,
  type GiftRegistry,
  type GiftRegistryItem,
} from "../../lib/gift-registry";
import { GiftRegistryTeaser } from "./GiftRegistryTeaser";

/**
 * The band the gift list leaves behind on the invite.
 *
 * What is load-bearing here:
 *   - it renders NOTHING for a wedding with no published list, and still ships
 *     an element child so `client:visible` can hydrate it at all;
 *   - it links to the list's own page, at the encoded slug;
 *   - the peek shows real gifts (never empty frames), and the fourth tile is
 *     laid out only where a fourth fits;
 *   - the availability line is quantities, never names.
 */

const API = "https://api.test";
const SLUG = "anita-and-ben";

function item(overrides: Partial<GiftRegistryItem> = {}): GiftRegistryItem {
  return {
    id: "gi-1",
    kind: "product",
    title: "Copper pan",
    description: null,
    imageName: null,
    imageCrop: null,
    externalUrl: null,
    priceMinor: null,
    quantityWanted: 2,
    quantityClaimed: 1,
    category: null,
    sortOrder: 0,
    ...overrides,
  };
}

function registry(overrides: Partial<GiftRegistry> = {}): GiftRegistry {
  return {
    headline: null,
    message: null,
    cashGiftsEnabled: false,
    currency: "AUD",
    items: [item()],
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(response: Response) {
  const mock = vi.fn(async () => response.clone());
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function renderTeaser(props: Partial<Parameters<typeof GiftRegistryTeaser>[0]> = {}) {
  return render(() => <GiftRegistryTeaser apiUrl={API} slug={SLUG} {...props} />);
}

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("what renders at all", () => {
  it("renders nothing for a wedding whose list is unpublished, unentitled or absent", async () => {
    stubFetch(json({ error: "registry_not_found" }, 404));
    const { container } = renderTeaser();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector("[data-gift-teaser]")).toBeNull();
  });

  it("renders nothing when the read fails outright", async () => {
    stubFetch(json({}, 500));
    const { container } = renderTeaser();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector("[data-gift-teaser]")).toBeNull();
  });

  /**
   * HYDRATION GUARD, not a cosmetic one. `client:visible` observes the island's
   * element CHILDREN — astro's `visible.js` ends `for (const child of el.children)
   * io.observe(child)`, because `<astro-island>` is `display: contents` and owns
   * no box. A component whose whole tree hangs off a `<Show>` that is false until
   * a post-hydration fetch SSRs to nothing, hands the observer an empty list, and
   * never hydrates at all — the band simply missing from both design packs in
   * production, with every unit test still green.
   */
  it("always renders an element child, whatever the read says", async () => {
    stubFetch(json({ error: "registry_not_found" }, 404));
    const { container } = renderTeaser();
    // Before the read answers — which is the state the server renders.
    expect(container.firstElementChild).not.toBeNull();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector("[data-gift-teaser]")).toBeNull();
    expect(container.firstElementChild).not.toBeNull();
  });
});

describe("the link to the list", () => {
  it("points at the wedding's own gift page", async () => {
    stubFetch(json(registry()));
    renderTeaser();
    const link = await screen.findByRole("link", { name: "See the gift list" });
    expect(link.getAttribute("href")).toBe(`/${SLUG}/registry`);
  });

  it("encodes a slug that needs it", async () => {
    stubFetch(json(registry()));
    renderTeaser({ slug: "anita & ben" });
    const link = await screen.findByRole("link", { name: "See the gift list" });
    expect(link.getAttribute("href")).toBe("/anita%20%26%20ben/registry");
  });
});

describe("the copy", () => {
  it("falls back to built-in copy, then the module's own, then the invite's", async () => {
    stubFetch(json(registry()));
    const first = renderTeaser();
    await screen.findByText(DEFAULT_GIFT_REGISTRY_HEADING);
    expect(screen.getByText(DEFAULT_GIFT_REGISTRY_EYEBROW)).toBeTruthy();
    first.unmount();
    cleanup();

    stubFetch(json(registry({ headline: "Our List", message: "No obligation." })));
    const second = renderTeaser();
    await screen.findByText("Our List");
    expect(screen.getByText("No obligation.")).toBeTruthy();
    second.unmount();
    cleanup();

    stubFetch(json(registry({ headline: "Our List" })));
    renderTeaser({ heading: "Gifts", eyebrow: "Thank You" });
    // The invite's own section copy wins — it is section furniture, themed with
    // every other section header.
    await screen.findByText("Gifts");
    expect(screen.getByText("Thank You")).toBeTruthy();
  });

  it("summarises the list in quantities and names no one", async () => {
    stubFetch(json(registry({ items: [item({ quantityWanted: 6, quantityClaimed: 2 })] })));
    const { container } = renderTeaser();
    await waitFor(() =>
      expect(container.querySelector("[data-gift-teaser-availability]")?.textContent).toBe(
        "4 of 6 still available",
      ),
    );
    expect(container.textContent).not.toMatch(/reserved by|claimed by/i);
  });
});

describe("the peek", () => {
  it("shows the gifts that have a picture, in the couple's order, four at most", async () => {
    const items = [
      item({ id: "a", imageName: "registry-a", sortOrder: 0 }),
      item({ id: "b", imageName: null, sortOrder: 1 }),
      item({ id: "c", imageName: "registry-c", sortOrder: 2 }),
      item({ id: "d", imageName: "registry-d", sortOrder: 3 }),
      item({ id: "e", imageName: "registry-e", sortOrder: 4 }),
      item({ id: "f", imageName: "registry-f", sortOrder: 5 }),
    ];
    stubFetch(json(registry({ items })));
    const { container } = renderTeaser();

    await waitFor(() => expect(container.querySelector("[data-gift-teaser-preview]")).toBeTruthy());
    const tiles = [...container.querySelectorAll("[data-gift-teaser-preview] img")];
    expect(tiles).toHaveLength(4);
    // The pictureless gift is skipped rather than drawn as an empty frame.
    expect(tiles[1]?.getAttribute("src")).toContain("registry-c");
    // The fourth is laid out only where a fourth fits, rather than wrapping
    // alone onto a second row.
    const fourth = container.querySelectorAll("[data-gift-teaser-preview] li")[3];
    expect(fourth?.getAttribute("class")).toContain("hidden md:block");
  });

  it("skips the row entirely when no gift has a picture", async () => {
    stubFetch(json(registry()));
    const { container } = renderTeaser();
    await screen.findByRole("link", { name: "See the gift list" });
    expect(container.querySelector("[data-gift-teaser-preview]")).toBeNull();
  });
});
