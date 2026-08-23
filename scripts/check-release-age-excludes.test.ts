import { expect, test } from "bun:test";

import { checkReleaseAgeExcludes } from "./check-release-age-excludes";

const NOW = new Date("2026-08-24T00:00:00Z");

function bunfig(excludesLine: string, markerComment: string): string {
  return `
[install]
minimumReleaseAge = 259200
${markerComment}
minimumReleaseAgeExcludes = ${excludesLine}
`;
}

test("an empty excludes list passes with no markers needed", () => {
  expect(checkReleaseAgeExcludes(bunfig("[]", ""), NOW)).toEqual([]);
});

test("a marker whose date is still in the future passes", () => {
  const toml = bunfig(`["left-pad"]`, "# DROP AFTER left-pad 2026-08-25");
  expect(checkReleaseAgeExcludes(toml, NOW)).toEqual([]);
});

test("a marker dated exactly today still passes — valid through the named date", () => {
  const toml = bunfig(`["left-pad"]`, "# DROP AFTER left-pad 2026-08-24");
  expect(checkReleaseAgeExcludes(toml, NOW)).toEqual([]);
});

test("a marker whose date has passed fails", () => {
  const toml = bunfig(`["left-pad"]`, "# DROP AFTER left-pad 2026-08-23");
  expect(checkReleaseAgeExcludes(toml, NOW)).toEqual([
    {
      name: "left-pad",
      problem: 'drop-trigger "DROP AFTER left-pad 2026-08-23" has passed (today is 2026-08-24)',
    },
  ]);
});

test("an excluded entry with no marker at all fails", () => {
  const toml = bunfig(`["left-pad"]`, "# some unrelated comment");
  expect(checkReleaseAgeExcludes(toml, NOW)).toEqual([
    {
      name: "left-pad",
      problem: 'no "# DROP AFTER left-pad <YYYY-MM-DD>" marker comment found',
    },
  ]);
});

test("a marker for a different package name does not satisfy this entry", () => {
  const toml = bunfig(`["left-pad"]`, "# DROP AFTER right-pad 2026-08-25");
  expect(checkReleaseAgeExcludes(toml, NOW)).toEqual([
    {
      name: "left-pad",
      problem: 'no "# DROP AFTER left-pad <YYYY-MM-DD>" marker comment found',
    },
  ]);
});

test("multiple excludes are checked independently", () => {
  const toml = bunfig(
    `["left-pad", "right-pad"]`,
    "# DROP AFTER left-pad 2026-08-23\n# DROP AFTER right-pad 2026-08-25",
  );
  expect(checkReleaseAgeExcludes(toml, NOW)).toEqual([
    {
      name: "left-pad",
      problem: 'drop-trigger "DROP AFTER left-pad 2026-08-23" has passed (today is 2026-08-24)',
    },
  ]);
});
