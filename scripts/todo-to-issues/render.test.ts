import { expect, test } from "bun:test";

import { buildManifest, renderBody, renderTitle } from "./render";
import type { Classified } from "./types";
import { buildWikiIndex } from "./wikilinks";

const INDEX = buildWikiIndex(["wiki/systems/sessions.md"]);

const base: Classified = {
  sourceFile: "wiki/TODO.md",
  sourceLine: 577,
  section: "Security Backlog",
  subsection: "Medium",
  title: "S-M (register-abandon) — **pre-existing**; the cookie ships early. See [[sessions]]",
  body: "  - follow-up: gate `/authorize` too.",
  repo: "private",
  labels: ["product:osn-core", "area:security", "severity:medium"],
  findingId: "S-M",
  severity: "medium",
};

test("strips emphasis and keeps the finding ID leading the title", () => {
  expect(renderTitle(base)).toBe(
    "S-M (register-abandon) — pre-existing; the cookie ships early. See sessions",
  );
});

test("truncates a long title on a word boundary and marks it", () => {
  const long = renderTitle({ ...base, title: "S-M — " + "word ".repeat(60) });
  expect(long.length).toBeLessThanOrEqual(121);
  expect(long).toEndWith("…");
  expect(long).not.toEndWith("wor…");
});

test("body keeps the full original line even when the title was cut", () => {
  const long = { ...base, title: "S-M — " + "word ".repeat(60) };
  expect(renderBody(long, INDEX)).toContain("word word word");
});

test("body carries nested content verbatim", () => {
  expect(renderBody(base, INDEX)).toContain("  - follow-up: gate `/authorize` too.");
});

test("a wikilink in the heading survives neither the footer nor the epic name", () => {
  const linked = { ...base, section: "Platform — see [[database-environments]]", subsection: null };
  expect(renderBody(linked, INDEX)).toContain('section "Platform — see database-environments"');
  expect(buildManifest([linked], INDEX)[0]?.epic).toBe("Platform — see database-environments");
});

test("an empty section leaves no dangling separator", () => {
  const shard = {
    ...base,
    sourceFile: "cire/wiki/todo/perf.md",
    section: "",
    subsection: "RSVP save latency",
  };
  expect(buildManifest([shard], INDEX)[0]?.epic).toBe("RSVP save latency");
  expect(renderBody(shard, INDEX)).toContain('section "RSVP save latency"');
});

test("body rewrites wikilinks and cites the source line", () => {
  const out = renderBody(base, INDEX);
  expect(out).toContain(
    "[sessions](https://github.com/xchromo/osn/blob/main/wiki/systems/sessions.md)",
  );
  expect(out).toContain('Migrated from `wiki/TODO.md:577` — section "Security Backlog / Medium".');
  expect(out).not.toContain("[[");
});
