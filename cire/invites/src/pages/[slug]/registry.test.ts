import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Drift guard for the gift list's route, `/<slug>/registry`.
 *
 * Every decision this route embodies lives in a few lines of Astro frontmatter,
 * and each is one edit away from a real regression nothing else would catch:
 *
 *  - **The two reads run in PARALLEL.** They are independent — the invite for
 *    the couple's copy and colours, the list for whether this page exists — and
 *    a guest opening a gift link on a phone waits for the slower of the two, not
 *    for their sum. Awaited one after the other, that is two round trips to
 *    cire-api on the critical path of the first paint.
 *  - **An unpublished list is a 404, not an empty page.** The public read
 *    answers ONE code for "no registry", "not entitled" and "not published", so
 *    the public surface cannot be used to tell them apart. This route must keep
 *    that: all three land on the same page with the same words.
 *  - **An unreachable API is a 503, not a 404.** The list may be perfectly fine;
 *    saying "no gift list here" to a guest whose couple has one is a lie that a
 *    retry would disprove.
 *  - **A failed INVITE read still renders the page.** The list is what the page
 *    is for; losing the couple's colours is a worse-looking page, not a missing
 *    one.
 *
 * The route renders whole documents, so there is no DOM to assert against and no
 * Astro test harness in this workspace. A source-text guard is the cheapest
 * thing that can actually fail when the contract is reverted — the same approach
 * `pages/index.test.ts` takes over the bare-domain route.
 */
describe("pages/[slug]/registry.astro (the gift list's route)", () => {
  const source = readFileSync(join(import.meta.dirname, "registry.astro"), "utf8");
  // Assertions run against the CODE, not the prose: the comments in this route
  // legitimately explain every status it does NOT return.
  const code = source.replaceAll(/^\s*\/\/.*$/gm, "");

  it("reads the invite and the list in parallel", () => {
    expect(code).toContain("Promise.all([fetchInvite(slug), fetchGiftRegistry(API_URL, slug)])");
  });

  it("404s an unknown wedding and a list that is not published, with the same page", () => {
    expect(code).toContain("inviteResult.kind === 'not-found' || registryResult.kind === 'hidden'");
    expect(code).toContain("Astro.response.status = 404");
  });

  it("answers 503 — never 404 — when the list could not be reached", () => {
    expect(code).toContain("Astro.response.status = 503");
  });

  it("still renders the list when only the invite read failed", () => {
    // `invite` degrades to null (built-in theme and copy); `registry` is what
    // decides whether a page renders at all.
    expect(code).toContain("inviteResult.kind === 'ok' ? inviteResult.invite : null");
  });

  it("never renders the document without a list", () => {
    expect(code).toContain("registry === null");
  });
});
