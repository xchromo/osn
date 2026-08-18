import { expect, test } from "bun:test";

import { parseBoard, parseIssues, pending } from "./backfill-project";

test("reads the issue URLs in a repo listing", () => {
  const json = JSON.stringify([
    { url: "https://github.com/xchromo/osn/issues/466" },
    { url: "https://github.com/xchromo/osn/issues/467" },
  ]);
  expect(parseIssues(json)).toEqual([
    "https://github.com/xchromo/osn/issues/466",
    "https://github.com/xchromo/osn/issues/467",
  ]);
});

test("reads the URLs already on the board", () => {
  const json = JSON.stringify({
    items: [{ content: { url: "https://github.com/xchromo/osn/issues/466" } }, { content: {} }],
  });
  expect(parseBoard(json)).toEqual(new Set(["https://github.com/xchromo/osn/issues/466"]));
});

test("adds only what is missing, so a re-run is free", () => {
  const all = ["a", "b", "c"];
  expect(pending(all, new Set(["b"]))).toEqual(["a", "c"]);
  expect(pending(all, new Set(all))).toEqual([]);
});
