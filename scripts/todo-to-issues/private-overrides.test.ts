import { expect, test } from "bun:test";

import { classify } from "./classify";
import { PRIVATE_OVERRIDES, overrideFor } from "./private-overrides";
import type { Item } from "./types";

const at = (o: (typeof PRIVATE_OVERRIDES)[number], over: Partial<Item> = {}): Item => ({
  sourceFile: o.file,
  sourceLine: o.line,
  section: "Up Next",
  subsection: null,
  title: `${o.titleIncludes} and the rest of the line`,
  body: "",
  ...over,
});

test("every override carries a reason and a private area", () => {
  expect(PRIVATE_OVERRIDES.length).toBeGreaterThan(0);
  for (const o of PRIVATE_OVERRIDES) {
    expect(["security", "performance", "compliance"]).toContain(o.area);
    expect(o.why.length).toBeGreaterThan(20);
    expect(o.titleIncludes.trim()).toBe(o.titleIncludes);
  }
});

test("no two overrides claim the same line", () => {
  const keys = PRIVATE_OVERRIDES.map((o) => `${o.file}:${o.line}`);
  expect(new Set(keys).size).toBe(keys.length);
});

test("an override routes its item private whatever its section says", () => {
  for (const o of PRIVATE_OVERRIDES) {
    const result = classify(at(o));
    expect(result.repo).toBe("private");
    expect(result.labels).toContain(`area:${o.area}`);
    if (o.product) expect(result.labels).toContain(`product:${o.product}`);
  }
});

test("an override matches on file, line, and title together", () => {
  const o = PRIVATE_OVERRIDES[0]!;
  expect(overrideFor(at(o))).not.toBeNull();
  expect(overrideFor(at(o, { sourceLine: o.line + 1 }))).toBeNull();
  expect(overrideFor(at(o, { sourceFile: "wiki/OTHER.md" }))).toBeNull();
  expect(overrideFor(at(o, { title: "a line that was rewritten" }))).toBeNull();
});

test("a shifted line stops matching rather than matching the wrong item", () => {
  // This is the failure the overrides-matched gate in assert.ts exists to catch: the
  // override finds nothing, the item routes on its section, and a finding goes public.
  const o = PRIVATE_OVERRIDES[0]!;
  const shifted = at(o, { sourceLine: o.line + 4 });
  expect(overrideFor(shifted)).toBeNull();
  expect(classify(shifted).repo).toBe("public");
});
