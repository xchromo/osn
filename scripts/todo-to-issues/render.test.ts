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
  expect(renderTitle(base)).toBe("S-M (register-abandon) — pre-existing; the cookie ships early");
});

test("a bold lead becomes the title and the argument after it does not", () => {
  const item = {
    ...base,
    title:
      "**Invite image upload should return the full customisation** (P-I2) — `POST /invite/image/:slot` " +
      "returns only the slot, so the builder must refetch the whole customisation after every upload.",
  };
  expect(renderTitle(item)).toBe("Invite image upload should return the full customisation");
});

test("a bold subject too short to stand alone takes the clause it opens", () => {
  const item = {
    ...base,
    title:
      "**Directory search** — a lat/lng bounding-box prefilter with a haversine ordering on D1; " +
      "the radius comes from the wedding's canonical point, and it needs its own rate limiter.",
  };
  expect(renderTitle(item)).toBe(
    "Directory search — a lat/lng bounding-box prefilter with a haversine ordering on D1",
  );
});

test("a dotted path is not mistaken for a clause end", () => {
  const item = {
    ...base,
    title: "The deploy job reads wiki/TODO.md and never retries on failure. " + "word ".repeat(30),
  };
  expect(renderTitle(item)).toBe("The deploy job reads wiki/TODO.md and never retries on failure");
});

test("underscore emphasis goes and snake_case identifiers stay", () => {
  const item = {
    ...base,
    title: "Replace `weddings.owner_osn_profile_id` with a join table _before_ the beta.",
  };
  expect(renderTitle(item)).toBe(
    "Replace weddings.owner_osn_profile_id with a join table before the beta",
  );
});

test("a trailing wiki pointer leaves the title but stays in the body", () => {
  expect(renderTitle(base)).not.toContain("sessions");
  expect(renderBody(base, INDEX)).toContain("sessions.md");
});

test("a title that already fits is kept whole", () => {
  const item = {
    ...base,
    title: "**Marketing depth** — pricing, deeper feature pages, real imagery.",
  };
  expect(renderTitle(item)).toBe("Marketing depth — pricing, deeper feature pages, real imagery");
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
