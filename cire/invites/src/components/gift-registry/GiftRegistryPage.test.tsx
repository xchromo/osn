// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GiftRegistry, GiftRegistryItem } from "../../lib/gift-registry";
import { noteClaimed, signOut } from "../claim-session";
import {
  giftRegistryWriteMessage,
  GiftRegistryPage,
  type GiftRegistryPageProps,
} from "./GiftRegistryPage";

/**
 * The gift list's own page.
 *
 * What is asserted here is what the spec calls load-bearing:
 *   - counts reach the DOM, claimant identities never do;
 *   - the 409 race refetches and TELLS the guest, and is never painted as a
 *     success that did not happen;
 *   - a signed-out visitor sees the list and a way back to the invitation that
 *     holds their code, not a dead button;
 *   - a shipping address renders only when the API actually sent one;
 *   - the page is seeded by the server and a FAILED re-read leaves what is on
 *     screen — on a page of its own, blanking on a blip blanks everything;
 *   - the couple's own shelves survive a refetch with the forms open under them.
 */

const API = "https://api.test";
const SLUG = "anita-and-ben";
const INVITE_HREF = `/${SLUG}`;

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

/**
 * A fetch stub routed by URL, so a test states what each ROUTE answers instead
 * of counting calls in mount order. Queued answers pop in order; the last one
 * repeats, which is what makes the "refetch after a 409" tests readable.
 *
 * The list route defaults to answering with the same list the page was seeded
 * with: the page's on-mount re-read is not the subject of most of these tests,
 * and a default 404 would close the list under every one of them.
 */
function routedFetch(routes: {
  list?: Response[];
  mine?: Response[];
  claim?: Response[];
  release?: Response[];
}) {
  const queues = {
    list: [...(routes.list ?? [json(registry())])],
    mine: [...(routes.mine ?? [json({ error: "unauthorised" }, 401)])],
    claim: [...(routes.claim ?? [json({ ok: true })])],
    release: [...(routes.release ?? [json({ ok: true })])],
  };
  const calls: { url: string; method: string }[] = [];

  const take = (key: keyof typeof queues) => {
    const queue = queues[key];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return (next as Response).clone();
  };

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/claim")) return take(method === "DELETE" ? "release" : "claim");
    if (url.endsWith("/registry/mine")) return take("mine");
    return take("list");
  });

  globalThis.fetch = mock as unknown as typeof fetch;
  return { mock, calls };
}

function renderPage(props: Partial<GiftRegistryPageProps> = {}) {
  return render(() => (
    <GiftRegistryPage
      apiUrl={API}
      slug={SLUG}
      inviteHref={INVITE_HREF}
      initialRegistry={registry()}
      {...props}
    />
  ));
}

/** Pretend this browser has claimed before, which is what gates the /mine read. */
function setClaimedHint() {
  document.cookie = "cire_claimed=1; Path=/";
}

/** The signed-out prompt, whose copy is split around a link back to the invite. */
function signedOutPrompt(container: HTMLElement) {
  return container.querySelector("[data-gift-signed-out]");
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  document.cookie = "cire_claimed=; Path=/; Max-Age=0";
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("what the page paints", () => {
  /**
   * The route fetched the list to decide the page exists at all, so the guest
   * gets the gifts in the first paint. A page that waited for its own fetch
   * would show an empty frame to someone who opened the link in a shop.
   */
  it("paints the server's list before any fetch has answered", () => {
    routedFetch({});
    const { container } = renderPage({
      initialRegistry: registry({ items: [item({ title: "Copper pan" })] }),
    });
    expect(container.querySelector("[data-gift-item]")).toBeTruthy();
    expect(container.textContent).toContain("Copper pan");
  });

  /**
   * A failed re-read is NOT an answer. As a band at the foot of the invite,
   * dropping to nothing cost a section nobody had scrolled to; here it would
   * blank the page under someone reading it.
   */
  it("keeps the list on screen when the revalidation fails outright", async () => {
    const { calls } = routedFetch({ list: [json({}, 500)] });
    const { container } = renderPage();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/registry"))).toBe(true));
    expect(container.querySelector("[data-gift-item]")).toBeTruthy();
    expect(container.querySelector("[data-gift-closed]")).toBeNull();
  });

  it("says so, with a way back, when the couple close the list while it is open", async () => {
    routedFetch({ list: [json({ error: "registry_not_found" }, 404)] });
    const { container } = renderPage();

    await screen.findByText("The couple have closed their gift list.");
    expect(container.querySelector("[data-gift-item]")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the invitation" }).getAttribute("href")).toBe(
      INVITE_HREF,
    );
  });

  it("has its own note for a PUBLISHED list with nothing on it yet", async () => {
    routedFetch({ list: [json(registry({ items: [] }))] });
    const { container } = renderPage({ initialRegistry: registry({ items: [] }) });
    await screen.findByText("The couple haven’t added any gifts yet.");
    // Not the closed state, and no ledger line summarising nothing as "0 of 0".
    expect(container.querySelector("[data-gift-closed]")).toBeNull();
    expect(container.querySelector("[data-gift-availability]")).toBeNull();
  });
});

describe("the ledger line", () => {
  it("counts what is free out of what the couple asked for, and nothing else", async () => {
    routedFetch({
      list: [json(registry({ items: [item({ quantityWanted: 4, quantityClaimed: 1 })] }))],
    });
    const { container } = renderPage({
      initialRegistry: registry({ items: [item({ quantityWanted: 4, quantityClaimed: 1 })] }),
    });

    expect(container.querySelector("[data-gift-availability]")?.textContent).toBe(
      "3 of 4 still available",
    );
    // Nothing of this household's is claimed, so that half is simply absent.
    expect(container.querySelector("[data-gift-claimed-count]")).toBeNull();
  });

  it("tells a household what it has reserved, in quantities and never in names", async () => {
    setClaimedHint();
    routedFetch({
      list: [json(registry({ items: [item({ quantityWanted: 4, quantityClaimed: 2 })] }))],
      mine: [
        json({
          claims: [
            {
              itemId: "gi-1",
              quantity: 2,
              status: "reserved",
              note: null,
              displayName: "The Ashworths",
            },
          ],
        }),
      ],
    });
    const { container } = renderPage({
      initialRegistry: registry({ items: [item({ quantityWanted: 4, quantityClaimed: 2 })] }),
    });

    await waitFor(() =>
      expect(container.querySelector("[data-gift-claimed-count]")?.textContent).toBe(
        "You reserved 2 gifts",
      ),
    );
    expect(container.querySelector("[data-gift-availability]")?.textContent).toBe(
      "2 of 4 still available",
    );
  });
});

describe("the couple's shelves", () => {
  it("keeps their own categories, in their own order, with the unlabelled tail last", () => {
    const items = [
      item({ id: "a", title: "Copper pan", category: "Kitchen", sortOrder: 0 }),
      item({ id: "b", title: "Picnic rug", category: null, sortOrder: 1 }),
      item({ id: "c", title: "Wine glasses", category: "Kitchen", sortOrder: 2 }),
      item({ id: "d", title: "Linen sheets", category: "Bedroom", sortOrder: 3 }),
    ];
    routedFetch({ list: [json(registry({ items }))] });
    const { container } = renderPage({ initialRegistry: registry({ items }) });

    const shelves = [...container.querySelectorAll("[data-gift-shelf]")];
    expect(shelves.map((shelf) => shelf.getAttribute("data-gift-shelf"))).toEqual([
      "Kitchen",
      "Bedroom",
      "",
    ]);
    expect(shelves[0]?.querySelectorAll("[data-gift-item]")).toHaveLength(2);
    expect(container.textContent).toContain("More gifts");
  });

  it("labels nothing when the couple grouped nothing", () => {
    routedFetch({});
    const { container } = renderPage();
    expect(container.querySelectorAll("[data-gift-shelf]")).toHaveLength(1);
    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).not.toContain("More gifts");
  });
});

describe("the privacy property", () => {
  it("puts counts in the DOM and no claimant identity anywhere", async () => {
    routedFetch({
      list: [json(registry({ items: [item({ quantityWanted: 2, quantityClaimed: 1 })] }))],
      mine: [json({ claims: [] })],
    });
    setClaimedHint();
    const { container } = renderPage();

    await screen.findByText("1 of 2 left");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/reserved by|claimed by|Ashworth/i);
    expect(container.querySelector("[data-gift-mine]")).toBeNull();
  });

  it("never asks for anything but counts on the public read", async () => {
    const { calls } = routedFetch({});
    renderPage();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    // One public read, and no credentialed read for a browser with no hint.
    expect(calls.filter((c) => c.url.endsWith("/registry"))).toHaveLength(1);
    expect(calls.some((c) => c.url.endsWith("/registry/mine"))).toBe(false);
  });
});

describe("the signed-out path", () => {
  it("shows the list and the way to the code, not a dead button", async () => {
    routedFetch({});
    const { container } = renderPage();

    await waitFor(() => expect(signedOutPrompt(container)).toBeTruthy());
    expect(signedOutPrompt(container)?.textContent).toContain("enter your invite code");
    // The code lives on the invitation, which is now a different document — so
    // this has to be a link, never "scroll up".
    expect(signedOutPrompt(container)?.querySelector("a")?.getAttribute("href")).toBe(INVITE_HREF);
    expect(screen.getByText("1 of 2 left")).toBeTruthy();
    // No claim/release controls exist to be pressed.
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("skips the credentialed read entirely without the claim hint", async () => {
    const { calls } = routedFetch({});
    renderPage();
    await screen.findByText("1 of 2 left");
    expect(calls.some((c) => c.url.endsWith("/registry/mine"))).toBe(false);
  });

  /**
   * THE SESSION CASE. The claim itself now happens in another DOCUMENT (the
   * invitation), so this page usually learns about it by being loaded fresh.
   * The event still matters for a session that starts or ends in THIS tab —
   * without it the guest keeps a prompt for a code they have already entered.
   */
  it("notices a session change in this tab, with no reload", async () => {
    const { calls } = routedFetch({ mine: [json({ claims: [] })] });
    const { container } = renderPage();

    await waitFor(() => expect(signedOutPrompt(container)).toBeTruthy());
    expect(calls.some((c) => c.url.endsWith("/registry/mine"))).toBe(false);

    // Exactly what `InvitePage` does the moment a claim lands.
    noteClaimed();

    await screen.findByRole("button", { name: "Reserve" });
    expect(calls.some((c) => c.url.endsWith("/registry/mine"))).toBe(true);
    expect(signedOutPrompt(container)).toBeNull();
  });

  it("drops back to the prompt when the guest signs out", async () => {
    setClaimedHint();
    routedFetch({ mine: [json({ claims: [] })] });
    const { container } = renderPage();

    await screen.findByRole("button", { name: "Reserve" });
    await signOut(API);

    await waitFor(() => expect(container.querySelectorAll("button")).toHaveLength(0));
    expect(signedOutPrompt(container)).toBeTruthy();
  });

  it("reads the household when the browser has claimed before", async () => {
    setClaimedHint();
    const { calls } = routedFetch({ mine: [json({ claims: [] })] });
    renderPage();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/registry/mine"))).toBe(true));
    await screen.findByRole("button", { name: "Reserve" });
  });
});

describe("this household's own claims", () => {
  it("merges its own claim into the list", async () => {
    setClaimedHint();
    routedFetch({
      list: [json(registry({ items: [item({ quantityWanted: 2, quantityClaimed: 1 })] }))],
      mine: [
        json({
          claims: [
            {
              itemId: "gi-1",
              quantity: 1,
              status: "reserved",
              note: null,
              displayName: "The Ashworths",
            },
          ],
        }),
      ],
    });
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector("[data-gift-mine]")).toBeTruthy());
    expect(container.querySelector("[data-gift-mine]")?.textContent).toContain("The Ashworths");
  });

  it("renders the shipping address only when the API actually sent one", async () => {
    setClaimedHint();
    routedFetch({
      mine: [json({ claims: [], shippingAddress: "12 Rose Lane\nSydney" })],
    });
    const first = renderPage();
    await waitFor(() => expect(first.container.querySelector("[data-gift-shipping]")).toBeTruthy());
    expect(first.container.querySelector("[data-gift-shipping]")?.textContent).toContain(
      "12 Rose Lane",
    );
    first.unmount();
    cleanup();

    routedFetch({ mine: [json({ claims: [] })] });
    const second = renderPage();
    await screen.findByRole("button", { name: "Reserve" });
    // Absent means "you may not see it" and "there isn't one" at once, so the
    // page says nothing at all rather than inventing a reason.
    expect(second.container.querySelector("[data-gift-shipping]")).toBeNull();
    expect(second.container.textContent).not.toContain("Send gifts to");
  });
});

describe("claiming", () => {
  it("re-reads both routes after a successful claim rather than guessing", async () => {
    setClaimedHint();
    const { calls } = routedFetch({
      list: [
        json(registry({ items: [item({ quantityWanted: 2, quantityClaimed: 0 })] })),
        json(registry({ items: [item({ quantityWanted: 2, quantityClaimed: 1 })] })),
      ],
      mine: [
        json({ claims: [] }),
        json({
          claims: [
            { itemId: "gi-1", quantity: 1, status: "reserved", note: null, displayName: null },
          ],
        }),
      ],
      claim: [json({ ok: true })],
    });
    const { container } = renderPage({
      initialRegistry: registry({ items: [item({ quantityWanted: 2, quantityClaimed: 0 })] }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Reserve" }));
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await screen.findByText("Reserved. “Copper pan” is marked as yours.");
    // The counts come from the re-read, which lands after the message.
    await waitFor(() =>
      expect(container.querySelector("[data-gift-remaining]")?.textContent).toBe("1 of 2 left"),
    );
    expect(container.querySelector("[data-gift-mine]")).toBeTruthy();
    // The ledger moves with the list, off the same re-read.
    expect(container.querySelector("[data-gift-availability]")?.textContent).toBe(
      "1 of 2 still available",
    );
    // Two list reads: the one on mount, and the one after the write.
    expect(calls.filter((c) => c.url.endsWith("/registry"))).toHaveLength(2);
    expect(calls.filter((c) => c.url.endsWith("/registry/mine"))).toHaveLength(2);
  });

  it("handles the 409 race honestly: refetched counts, a plain message, no fake success", async () => {
    setClaimedHint();
    const { calls } = routedFetch({
      list: [
        // What this guest was looking at: the last one is free.
        json(registry({ items: [item({ quantityWanted: 2, quantityClaimed: 1 })] })),
        // What is true by the time they press: another household took it.
        json(registry({ items: [item({ quantityWanted: 2, quantityClaimed: 2 })] })),
      ],
      mine: [json({ claims: [] })],
      claim: [json({ error: "item_fully_claimed" }, 409)],
    });
    const { container } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Reserve" }));
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await screen.findByText(
      "Another guest reserved the last “Copper pan” a moment ago. The list below is up to date.",
    );

    // The counts beside the message came from a read that finished AFTER the
    // 409 — never an optimistic decrement, never the stale ones.
    await waitFor(() =>
      expect(container.querySelector("[data-gift-remaining]")?.textContent).toBe("All reserved"),
    );
    expect(calls.filter((c) => c.url.endsWith("/registry"))).toHaveLength(2);
    // Nothing is claimed by us, and nothing pretends otherwise.
    expect(container.querySelector("[data-gift-mine]")).toBeNull();
    // Nothing is left to reserve either, so the form goes with it rather than
    // sitting there holding `min="1"` beside `max="0"` — a Confirm that could
    // only be refused, under a message that already said so.
    await waitFor(() => expect(container.querySelector("form")).toBeNull());
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  /**
   * The same test also guards the SHELVES. The groups are rebuilt on every
   * re-read, so keying the shelf list on the group objects would dispose this
   * shelf and take the open form — and the words typed into it — down with it.
   */
  it("keeps the form open, on its own shelf, after a 409 that still leaves something", async () => {
    setClaimedHint();
    const shelved = (claimed: number) =>
      registry({
        items: [item({ category: "Kitchen", quantityWanted: 3, quantityClaimed: claimed })],
      });
    routedFetch({
      list: [
        json(shelved(0)),
        // The API also answers 409 when OTHER households' live claims exceed
        // what is left for the number asked — here two of three are taken and
        // one is still free, so the form is still worth having. This is why the
        // close must key on the CEILING and never on the 409 itself.
        json(shelved(2)),
      ],
      mine: [json({ claims: [] })],
      claim: [json({ error: "item_fully_claimed" }, 409)],
    });
    const { container } = renderPage({ initialRegistry: shelved(0) });

    fireEvent.click(await screen.findByRole("button", { name: "Reserve" }));
    const name = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.input(name, { target: { value: "The Ashworths" } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await screen.findByText(/Another guest reserved the last/);
    await waitFor(() =>
      expect(container.querySelector("[data-gift-remaining]")?.textContent).toBe("1 of 3 left"),
    );
    expect(container.querySelector("form")).toBeTruthy();
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).value).toBe(
      "The Ashworths",
    );
    expect(container.querySelector('[data-gift-shelf="Kitchen"]')).toBeTruthy();
  });

  it("drops to the signed-out surface when the session lapsed mid-visit", async () => {
    setClaimedHint();
    routedFetch({
      mine: [json({ claims: [] })],
      claim: [json({ error: "unauthorised" }, 401)],
    });
    const { container } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Reserve" }));
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await screen.findByText(
      "Your invite session has ended. Enter your invite code again to reserve a gift.",
    );
    await waitFor(() => expect(container.querySelectorAll("button")).toHaveLength(0));
  });

  it("does not re-read anything when the write never reached the server", async () => {
    setClaimedHint();
    const { calls } = routedFetch({
      mine: [json({ claims: [] })],
      claim: [json({ error: "rate_limited" }, 429)],
    });
    const { container } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Reserve" }));
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await screen.findByText("That was a lot of changes at once. Try again in a moment.");
    expect(calls.filter((c) => c.url.endsWith("/registry"))).toHaveLength(1);
  });

  it("releases a claim and re-reads", async () => {
    setClaimedHint();
    const { calls } = routedFetch({
      mine: [
        json({
          claims: [
            { itemId: "gi-1", quantity: 1, status: "reserved", note: null, displayName: null },
          ],
        }),
        json({ claims: [] }),
      ],
      release: [json({ ok: true })],
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Release" }));

    await screen.findByText("Released. “Copper pan” is free for another guest again.");
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });
});

describe("the status line", () => {
  it("is a polite live region at the page root, not an overlay", async () => {
    routedFetch({});
    const { container } = renderPage();
    await screen.findByText("1 of 2 left");

    const status = container.querySelector("[data-gift-status]") as HTMLElement;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    // A `transform` on any ancestor would trap a fixed overlay; there is none.
    expect(container.querySelector(".fixed")).toBeNull();
  });
});

describe("giftRegistryWriteMessage", () => {
  it("names a duration only when the server named one", () => {
    expect(
      giftRegistryWriteMessage({ kind: "rate-limited", retryAfterSeconds: 60 }, "claim", "Pan"),
    ).toBe("That was a lot of changes at once. Try again in 60 seconds.");
    expect(
      giftRegistryWriteMessage({ kind: "rate-limited", retryAfterSeconds: null }, "claim", "Pan"),
    ).toBe("That was a lot of changes at once. Try again in a moment.");
  });

  it("has distinct copy for every outcome a guest can hit", () => {
    const messages = [
      giftRegistryWriteMessage({ kind: "ok" }, "claim", "Pan"),
      giftRegistryWriteMessage({ kind: "ok" }, "release", "Pan"),
      giftRegistryWriteMessage({ kind: "fully-claimed" }, "claim", "Pan"),
      giftRegistryWriteMessage({ kind: "item-gone" }, "claim", "Pan"),
      giftRegistryWriteMessage({ kind: "hidden" }, "claim", "Pan"),
      giftRegistryWriteMessage({ kind: "signed-out" }, "claim", "Pan"),
      giftRegistryWriteMessage({ kind: "invalid" }, "claim", "Pan"),
      giftRegistryWriteMessage({ kind: "error" }, "claim", "Pan"),
    ];
    expect(new Set(messages).size).toBe(messages.length);
    // None of them names another household.
    for (const message of messages) expect(message).not.toMatch(/by [A-Z]/);
  });
});
