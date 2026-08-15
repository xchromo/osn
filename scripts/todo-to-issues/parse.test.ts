import { expect, test } from "bun:test";

import { parseTodo } from "./parse";

const SAMPLE = `# OSN Project TODO

## Up Next

Intro paragraph, not an item.

- [ ] **Dev tier** — one-time setup still open. See [[dev-environment]].
- [x] **Already done** — skipped.
- [ ] **Identity move** — multi-line item.
  - **PR C — merged.** cire is registered as \`cid_cire\`.
  - [x] Turnstile client half followed the ceremonies.

  See [[production-deploy]].

---

## Security Backlog

### Medium

- [ ] S-M (cohost-add-ignores-blocks) — nothing consults the block graph.
`;

test("returns only unchecked top-level items", () => {
  const items = parseTodo(SAMPLE, "wiki/TODO.md");
  expect(items.map((i) => i.title)).toEqual([
    "**Dev tier** — one-time setup still open. See [[dev-environment]].",
    "**Identity move** — multi-line item.",
    "S-M (cohost-add-ignores-blocks) — nothing consults the block graph.",
  ]);
});

test("captures nested bullets and continuation paragraphs verbatim", () => {
  const items = parseTodo(SAMPLE, "wiki/TODO.md");
  expect(items[1].body).toBe(
    "  - **PR C — merged.** cire is registered as `cid_cire`.\n" +
      "  - [x] Turnstile client half followed the ceremonies.\n" +
      "\n" +
      "  See [[production-deploy]].",
  );
});

test("records section, subsection, and 1-indexed source line", () => {
  const items = parseTodo(SAMPLE, "wiki/TODO.md");
  expect(items[0].section).toBe("Up Next");
  expect(items[0].subsection).toBeNull();
  expect(items[2].section).toBe("Security Backlog");
  expect(items[2].subsection).toBe("Medium");
  expect(SAMPLE.split("\n")[items[0].sourceLine - 1]).toStartWith("- [ ] **Dev tier**");
});

test("a heading ends the preceding item's body", () => {
  const items = parseTodo(SAMPLE, "wiki/TODO.md");
  expect(items[1].body).not.toContain("Security Backlog");
});
