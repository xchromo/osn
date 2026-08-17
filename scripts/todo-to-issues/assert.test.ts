import { expect, test } from "bun:test";

import { checkManifest, EXPECTED } from "./assert";
import { PRIVATE_OVERRIDES } from "./private-overrides";
import type { ManifestEntry } from "./types";

const ok: ManifestEntry = {
  sourceFile: "wiki/TODO.md",
  sourceLine: 12,
  section: "Up Next",
  subsection: null,
  title: "Guest list filtering",
  body: "",
  repo: "public",
  labels: ["product:cire", "area:ops"],
  findingId: null,
  severity: null,
  issueTitle: "Guest list filtering",
  issueBody: "Guest list filtering",
  epic: "Up Next",
};

// Every test builds a one-item manifest, so the two whole-manifest gates -- the count
// and the override coverage -- always fire. Assert on the per-entry rules here; both
// whole-manifest gates get their own tests below.
const WHOLE_MANIFEST = new Set(["expected-counts", "overrides-matched"]);
const rules = (entries: ManifestEntry[]) =>
  checkManifest(entries)
    .filter((v) => !WHOLE_MANIFEST.has(v.rule))
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
  expect(rules([{ ...ok, labels: ["area:ops"] }])).toContain("one-product-label");
  expect(rules([{ ...ok, labels: ["product:cire", "product:pulse", "area:ops"] }])).toContain(
    "one-product-label",
  );
});

test("no area label is fine -- product work carries none", () => {
  expect(rules([{ ...ok, labels: ["product:cire"] }])).toEqual([]);
});

test("two area labels are a violation", () => {
  expect(rules([{ ...ok, labels: ["product:cire", "area:ops", "area:schema"] }])).toContain(
    "at-most-one-area-label",
  );
});

test("a section no phase claims is a violation", () => {
  expect(rules([{ ...ok, section: "Renamed Overnight" }])).toContain("one-phase");
});

test("the count gate fires when the manifest size drifts", () => {
  const violations = checkManifest([ok]).filter((v) => v.rule === "expected-counts");
  expect(violations).toHaveLength(2);
  expect(violations[0]?.detail).toBe(`expected ${EXPECTED.public}, got 1`);
});

const overrides = (entries: ManifestEntry[]) =>
  checkManifest(entries).filter((v) => v.rule === "overrides-matched");

const asOverride = (o: (typeof PRIVATE_OVERRIDES)[number]): ManifestEntry => ({
  ...ok,
  sourceFile: o.file,
  sourceLine: o.line,
  title: `${o.titleIncludes} and the rest of the line`,
  repo: "private",
  labels: [`product:${o.product ?? "osn-core"}`, `area:${o.area}`],
});

test("the override gate stays quiet when every override found its line", () => {
  expect(overrides(PRIVATE_OVERRIDES.map(asOverride))).toEqual([]);
});

test("a shifted line fails the override gate instead of publishing", () => {
  const first = PRIVATE_OVERRIDES[0]!;
  const entries = PRIVATE_OVERRIDES.map(asOverride);
  entries[0] = { ...entries[0]!, sourceLine: first.line + 3 };
  expect(overrides(entries)[0]?.detail).toContain("matched 0 items");
});

test("a rewritten line fails the override gate", () => {
  const entries = PRIVATE_OVERRIDES.map(asOverride);
  entries[0] = { ...entries[0]!, title: "something else entirely", repo: "public" };
  expect(overrides(entries)[0]?.detail).toContain("line now holds");
  // The file is untouched, so the other overrides stay quiet -- only the moved one fails.
  expect(overrides(entries)).toHaveLength(1);
});

test("an override that did not take is a violation", () => {
  const entries = PRIVATE_OVERRIDES.map(asOverride);
  entries[0] = { ...entries[0]!, repo: "public" };
  expect(overrides(entries)[0]?.detail).toContain("routed public");
});

test("the override gate says nothing about a manifest that skipped the file", () => {
  expect(overrides([{ ...ok, sourceFile: "cire/wiki/todo/perf.md" }])).toEqual([]);
});
