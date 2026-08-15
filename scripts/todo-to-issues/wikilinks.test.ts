import { expect, test } from "bun:test";

import { buildWikiIndex, rewriteWikilinks } from "./wikilinks";

const INDEX = buildWikiIndex([
  "wiki/systems/identity-model.md",
  "wiki/changelog/security-fixes.md",
  "cire/wiki/cire-auth.md",
]);
const URL = "https://github.com/xchromo/osn/blob/main";

test("resolves a bare wikilink to an absolute blob URL", () => {
  expect(rewriteWikilinks("see [[identity-model]] for detail", INDEX, URL)).toBe(
    "see [identity-model](https://github.com/xchromo/osn/blob/main/wiki/systems/identity-model.md) for detail",
  );
});

test("resolves a path-qualified wikilink", () => {
  expect(rewriteWikilinks("[[changelog/security-fixes]]", INDEX, URL)).toBe(
    "[changelog/security-fixes](https://github.com/xchromo/osn/blob/main/wiki/changelog/security-fixes.md)",
  );
});

test("tolerates a trailing slash, as wiki/TODO.md uses", () => {
  expect(rewriteWikilinks("[[changelog/]]", INDEX, URL)).toBe("`changelog/`");
});

test("degrades an unresolved link to a code span, never a dead link", () => {
  const out = rewriteWikilinks("[[does-not-exist]]", INDEX, URL);
  expect(out).toBe("`does-not-exist`");
  expect(out).not.toContain("[[");
});

test("leaves an existing markdown link alone", () => {
  const input = "[The Copenhagen Book](https://thecopenhagenbook.com/)";
  expect(rewriteWikilinks(input, INDEX, URL)).toBe(input);
});

test("rewrites every link on a line, not just the first", () => {
  expect(rewriteWikilinks("[[identity-model]] and [[cire-auth]]", INDEX, URL)).toBe(
    "[identity-model](https://github.com/xchromo/osn/blob/main/wiki/systems/identity-model.md)" +
      " and [cire-auth](https://github.com/xchromo/osn/blob/main/cire/wiki/cire-auth.md)",
  );
});
