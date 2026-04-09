import { describe, it, expect } from "vitest";
import { createRateLimiter, getClientIp } from "../../src/lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows requests up to maxRequests", () => {
    const rl = createRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    expect(rl.check("ip1")).toBe(true);
    expect(rl.check("ip1")).toBe(true);
    expect(rl.check("ip1")).toBe(true);
    expect(rl.check("ip1")).toBe(false);
  });

  it("rejects the request after maxRequests is reached", () => {
    const rl = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    expect(rl.check("ip1")).toBe(true);
    expect(rl.check("ip1")).toBe(false);
    expect(rl.check("ip1")).toBe(false);
  });

  it("tracks keys independently", () => {
    const rl = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    expect(rl.check("ip1")).toBe(true);
    expect(rl.check("ip2")).toBe(true);
    expect(rl.check("ip1")).toBe(false);
    expect(rl.check("ip2")).toBe(false);
  });

  it("resets after window expires", () => {
    const rl = createRateLimiter({ maxRequests: 1, windowMs: 50 });
    expect(rl.check("ip1")).toBe(true);
    expect(rl.check("ip1")).toBe(false);

    // Manually expire the entry by backdating the windowStart
    const entry = rl._store.get("ip1")!;
    entry.windowStart = Date.now() - 100;

    expect(rl.check("ip1")).toBe(true);
  });

  it("sweeps expired entries when maxEntries is exceeded", () => {
    const rl = createRateLimiter({ maxRequests: 10, windowMs: 50, maxEntries: 2 });

    // Fill past capacity (3 entries, maxEntries is 2)
    rl.check("ip1");
    rl.check("ip2");
    rl.check("ip3");
    expect(rl._store.size).toBe(3);

    // Expire ip1 and ip2
    rl._store.get("ip1")!.windowStart = Date.now() - 100;
    rl._store.get("ip2")!.windowStart = Date.now() - 100;

    // Next check triggers sweep (size 3 > maxEntries 2), evicting expired entries
    rl.check("ip4");
    expect(rl._store.has("ip1")).toBe(false);
    expect(rl._store.has("ip2")).toBe(false);
    expect(rl._store.has("ip3")).toBe(true);
    expect(rl._store.has("ip4")).toBe(true);
  });

  it("does not sweep when under maxEntries", () => {
    const rl = createRateLimiter({ maxRequests: 10, windowMs: 50, maxEntries: 100 });
    rl.check("ip1");

    // Expire the entry
    rl._store.get("ip1")!.windowStart = Date.now() - 100;

    // Under maxEntries so no sweep — but the expired entry gets replaced on check
    rl.check("ip1");
    expect(rl._store.get("ip1")!.count).toBe(1); // reset, not incremented
  });

  it("defaults maxEntries to 10_000", () => {
    const rl = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });
    // Just verify it works with more than a few keys
    for (let i = 0; i < 100; i++) rl.check(`ip${i}`);
    expect(rl._store.size).toBe(100);
  });
});

describe("getClientIp", () => {
  it("returns first IP from x-forwarded-for", () => {
    expect(getClientIp({ "x-forwarded-for": "203.0.113.1" })).toBe("203.0.113.1");
  });

  it("returns first IP from comma-separated x-forwarded-for", () => {
    expect(getClientIp({ "x-forwarded-for": "203.0.113.1, 70.41.3.18, 150.172.238.178" })).toBe(
      "203.0.113.1",
    );
  });

  it("trims whitespace from the first IP", () => {
    expect(getClientIp({ "x-forwarded-for": "  203.0.113.1 , 70.41.3.18" })).toBe("203.0.113.1");
  });

  it("returns 'unknown' when no x-forwarded-for header", () => {
    expect(getClientIp({})).toBe("unknown");
  });

  it("returns 'unknown' when x-forwarded-for is undefined", () => {
    expect(getClientIp({ "x-forwarded-for": undefined })).toBe("unknown");
  });
});
