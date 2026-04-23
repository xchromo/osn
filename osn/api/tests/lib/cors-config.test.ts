import { describe, it, expect } from "vitest";

import { assertCorsOriginsConfigured, resolveCorsOrigins } from "../../src/lib/cors-config";

describe("resolveCorsOrigins", () => {
  it("falls back to monorepo dev ports when OSN_CORS_ORIGIN and OSN_ENV are unset", () => {
    expect(resolveCorsOrigins({})).toEqual(["http://localhost:1420", "http://localhost:1422"]);
  });

  it("falls back to monorepo dev ports when OSN_ENV=local", () => {
    expect(resolveCorsOrigins({ OSN_ENV: "local" })).toEqual([
      "http://localhost:1420",
      "http://localhost:1422",
    ]);
  });

  it("returns an empty list in non-local envs without OSN_CORS_ORIGIN", () => {
    expect(resolveCorsOrigins({ OSN_ENV: "production" })).toEqual([]);
    expect(resolveCorsOrigins({ OSN_ENV: "staging" })).toEqual([]);
  });

  it("splits and trims a comma-separated OSN_CORS_ORIGIN", () => {
    expect(
      resolveCorsOrigins({
        OSN_CORS_ORIGIN: "https://a.example.com, https://b.example.com , https://c.example.com",
        OSN_ENV: "production",
      }),
    ).toEqual(["https://a.example.com", "https://b.example.com", "https://c.example.com"]);
  });

  it("drops empty entries from a malformed OSN_CORS_ORIGIN", () => {
    expect(
      resolveCorsOrigins({ OSN_CORS_ORIGIN: "https://a.example.com,,  ,https://b.example.com" }),
    ).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("prefers an explicit OSN_CORS_ORIGIN over the local-dev fallback", () => {
    expect(
      resolveCorsOrigins({ OSN_CORS_ORIGIN: "http://localhost:9999", OSN_ENV: "local" }),
    ).toEqual(["http://localhost:9999"]);
  });
});

describe("assertCorsOriginsConfigured", () => {
  it("throws in a Secure-cookie (non-local) env with an empty allowlist", () => {
    expect(() => assertCorsOriginsConfigured([], true)).toThrow(/OSN_CORS_ORIGIN must be set/);
  });

  it("does not throw in local dev with an empty allowlist", () => {
    expect(() => assertCorsOriginsConfigured([], false)).not.toThrow();
  });

  it("does not throw when the allowlist is populated", () => {
    expect(() => assertCorsOriginsConfigured(["https://app.example.com"], true)).not.toThrow();
  });
});
