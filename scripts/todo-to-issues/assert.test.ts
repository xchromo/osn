import { expect, test } from "bun:test";

import { checkManifest, EXPECTED } from "./assert";
import type { ManifestEntry } from "./types";

const ok: ManifestEntry = {
  sourceFile: "wiki/TODO.md",
  sourceLine: 12,
  section: "Up Next",
  subsection: null,
  title: "Guest list filtering",
  body: "",
  repo: "public",
  labels: ["product:cire", "area:feature"],
  findingId: null,
  severity: null,
  issueTitle: "Guest list filtering",
  issueBody: "Guest list filtering",
  epic: "Up Next",
};

// Every test builds a one-item manifest, so the count gate always fires. Assert on
// the rules under test instead, and check the count gate on its own below.
const rules = (entries: ManifestEntry[]) =>
  checkManifest(entries)
    .filter((v) => v.rule !== "expected-counts")
    .map((v) => v.rule);

test("a clean public entry trips no content rule", () => {
  expect(rules([ok])).toEqual([]);
});

test("a finding in the public repo is a violation", () => {
  const leaked = { ...ok, labels: ["product:cire", "area:security", "severity:high"] };
  expect(rules([leaked])).toContain("no-findings-in-public");
});

test("business content is a violation wherever it appears", () => {
  const business = { ...ok, issueBody: "Bill through Lemon Squeezy as MoR." };
  expect(rules([business])).toContain("no-business-content");
});

test("an unrewritten wikilink is a violation", () => {
  expect(rules([{ ...ok, issueBody: "See [[sessions]]" }])).toContain("no-raw-wikilinks");
});

test("zero or two product labels are both violations", () => {
  expect(rules([{ ...ok, labels: ["area:feature"] }])).toContain("one-product-label");
  expect(rules([{ ...ok, labels: ["product:cire", "product:pulse", "area:feature"] }])).toContain(
    "one-product-label",
  );
});

test("a missing area label is a violation", () => {
  expect(rules([{ ...ok, labels: ["product:cire"] }])).toContain("one-area-label");
});

test("a section no phase claims is a violation", () => {
  expect(rules([{ ...ok, section: "Renamed Overnight" }])).toContain("one-phase");
});

test("the count gate fires when the manifest size drifts", () => {
  const violations = checkManifest([ok]).filter((v) => v.rule === "expected-counts");
  expect(violations).toHaveLength(2);
  expect(violations[0]?.detail).toBe(`expected ${EXPECTED.public}, got 1`);
});
