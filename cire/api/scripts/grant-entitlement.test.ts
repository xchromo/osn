import { describe, it, expect } from "bun:test";

import { buildGrants } from "./grant-entitlement";

describe("buildGrants", () => {
  it("maps requested keys to comp grants for the wedding", () => {
    const grants = buildGrants("wed_vr", ["vendors", "capacity_1000"], "usr_owner");
    expect(grants).toEqual([
      { key: "vendors", opts: { source: "comp", grantedBy: "usr_owner" } },
      { key: "capacity_1000", opts: { source: "comp", grantedBy: "usr_owner" } },
    ]);
  });
  it("rejects an unknown key", () => {
    expect(() => buildGrants("wed_vr", ["bogus" as never], "x")).toThrow();
  });
});
