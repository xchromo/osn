import { describe, expect, it } from "bun:test";

import { renderDevSeedSql } from "./generate";

const DEV_SEED_PATH = new URL("./dev-seed.sql", import.meta.url).pathname;

describe("dev-seed.sql", () => {
  it("is in sync with the canonical seed data (run `bun run seed:generate` if this fails)", async () => {
    const committed = await Bun.file(DEV_SEED_PATH).text();
    expect(committed).toBe(renderDevSeedSql());
  });
});
