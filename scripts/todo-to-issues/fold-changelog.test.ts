import { expect, test } from "bun:test";

import { indentOf, kindOf, parseBlocks, renderAppendix } from "./fold-changelog";

test("a completed item keeps everything indented under it", () => {
  const md = [
    "## Pulse",
    "",
    "- [x] Ship the thing",
    "  - detail one",
    "  - detail two",
    "- [ ] Not done",
  ].join("\n");
  const blocks = parseBlocks(md, "wiki/TODO.md");
  expect(blocks).toHaveLength(1);
  expect(blocks[0].lines).toEqual(["- [x] Ship the thing", "  - detail one", "  - detail two"]);
  expect(blocks[0].section).toBe("Pulse");
});

test("an item stops at the next item of its own depth", () => {
  const md = "- [x] One\n- [x] Two";
  expect(parseBlocks(md, "f.md").map((b) => b.lines)).toEqual([["- [x] One"], ["- [x] Two"]]);
});

test("a checkbox inside a code fence is prose, not an item", () => {
  const md = "## H\n\n```md\n- [x] Example in a doc\n```\n\n- [x] Real";
  const blocks = parseBlocks(md, "f.md");
  expect(blocks).toHaveLength(1);
  expect(blocks[0].lines).toEqual(["- [x] Real"]);
});

test("a blank line inside an item is kept, one that ends it is not", () => {
  const md = "- [x] Item\n\n  continued prose\n\n- [x] Next";
  const [first] = parseBlocks(md, "f.md");
  expect(first.lines).toEqual(["- [x] Item", "", "  continued prose"]);
});

test("a finding ID routes the item, whatever heading it sits under", () => {
  expect(kindOf("**S-H2** — leaky route", "Cire", "wiki/TODO.md")).toBe("security");
  expect(kindOf("**P-W1** — slow query", "Pulse", "wiki/TODO.md")).toBe("performance");
  expect(kindOf("**C-M3** — no DSAR path", "Pulse", "wiki/TODO.md")).toBe("compliance");
  expect(kindOf("**S-H (dev-otp-log-gate)** — no digit", "Pulse", "wiki/TODO.md")).toBe("security");
});

test("with no ID the heading decides, then the file", () => {
  expect(kindOf("plain item", "Security Backlog", "wiki/TODO.md")).toBe("security");
  expect(kindOf("plain item", "Open", "cire/wiki/todo/perf.md")).toBe("performance");
  expect(kindOf("plain item", "Compliance Backlog", "wiki/TODO.md")).toBe("compliance");
  expect(kindOf("plain item", "Up Next", "wiki/TODO.md")).toBe("features");
});

test("indentation counts a tab as two spaces", () => {
  expect(indentOf("\t- x")).toBe(2);
  expect(indentOf("    - x")).toBe(4);
});

test("the appendix groups by source section and keeps the prose verbatim", () => {
  const blocks = parseBlocks("## Pulse\n\n- [x] Ship **bold** it", "wiki/TODO.md");
  const out = renderAppendix(blocks, "2026-08-15");
  expect(out).toContain("## Migrated from TODO.md (2026-08-15)");
  expect(out).toContain("### wiki/TODO.md — Pulse");
  expect(out).toContain("- [x] Ship **bold** it");
});
