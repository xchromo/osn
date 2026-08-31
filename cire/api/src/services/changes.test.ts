import { describe, it, expect } from "bun:test";

import { BOOTSTRAP_WEDDING_ID } from "@cire/db";
import { Effect } from "effect";

import { TestDbLayer } from "../db/test-layer";
import { effWith } from "../test-helpers";
import { decodeChangeBody } from "./changes";

const withDb = effWith(TestDbLayer);

describe("decodeChangeBody: editor scope", () => {
  it(
    "a desiredState body carrying scope: 'events' decodes to scope: 'events'",
    withDb(
      Effect.gen(function* () {
        const decoded = yield* decodeChangeBody(
          { desiredState: { events: [], families: [] }, scope: "events" },
          BOOTSTRAP_WEDDING_ID,
        );
        expect(decoded.scope).toBe("events");
        expect(decoded.kind).toBe("editor");
      }),
    ),
  );

  it(
    "a desiredState body omitting scope still decodes to scope: 'both'",
    withDb(
      Effect.gen(function* () {
        const decoded = yield* decodeChangeBody(
          { desiredState: { events: [], families: [] } },
          BOOTSTRAP_WEDDING_ID,
        );
        expect(decoded.scope).toBe("both");
        expect(decoded.kind).toBe("editor");
      }),
    ),
  );
});
