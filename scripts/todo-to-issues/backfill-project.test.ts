import { expect, test } from "bun:test";

import { parseBoard, pending, repoOf, urlsFor } from "./backfill-project";

const PRIVATE = new Set(["wiki/TODO.md:900"]);

test("an epic key names its own repo", () => {
  expect(repoOf("epic:private:Security Backlog / High", PRIVATE)).toBe("xchromo/osn-tracker");
  expect(repoOf("epic:public:Up Next", PRIVATE)).toBe("xchromo/osn");
});

test("an item key takes its repo from the manifest", () => {
  expect(repoOf("wiki/TODO.md:900", PRIVATE)).toBe("xchromo/osn-tracker");
  expect(repoOf("wiki/TODO.md:12", PRIVATE)).toBe("xchromo/osn");
});

test("a sub-issue link owns no issue, so it gets no board item", () => {
  const state = {
    "wiki/TODO.md:12": { number: 466, id: "1" },
    "link:wiki/TODO.md:12": { number: 466, id: "1" },
  };
  expect(urlsFor(state, PRIVATE)).toEqual(["https://github.com/xchromo/osn/issues/466"]);
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
