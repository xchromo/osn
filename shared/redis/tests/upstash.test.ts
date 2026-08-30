import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import type { UpstashLike } from "../src/upstash";
import { wrapUpstash } from "../src/upstash";

/**
 * `eval`/`get` are declared generic on `UpstashLike` (mirroring the SDK's own
 * `<TData = unknown>` escape hatch — see `upstash.ts`), and a concrete mock
 * function cannot satisfy a generic call signature: assignability requires
 * validity for an arbitrary `TData`, which a mock resolving to one fixed
 * type is not. The fake's `eval`/`get`/`ping`/`del` are typed as plain `Mock`s
 * instead of through `UpstashLike` for exactly this reason; every other
 * member still comes from the real interface, so a shape drift in `set` (the
 * one member still statically checked here) is still caught.
 */
type FakeUpstash = Omit<UpstashLike, "get" | "ping" | "del" | "eval"> & {
  store: Map<string, string>;
  set: Mock;
  eval: Mock;
  get: Mock;
  ping: Mock;
  del: Mock;
};

/**
 * Fake `@upstash/redis` client. Backed by a real `Map` so the contract tests
 * exercise actual round-trips (string-in / string-out) rather than asserting
 * against canned values — mirroring the spirit of the in-memory client test.
 * Constructed as if `automaticDeserialization: false`, i.e. values are stored
 * and returned verbatim as strings.
 */
function createFakeUpstash(): FakeUpstash {
  const store = new Map<string, string>();
  const set = vi.fn(async (key: string, value: string, _opts?: { px: number }) => {
    store.set(key, value);
    return "OK";
  });
  const evalFn = vi.fn(
    async (_script: string, _keys: readonly string[], _args: readonly (string | number)[]) => 1,
  );
  const get = vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null));
  const ping = vi.fn(async () => "PONG");
  const del = vi.fn(async (...keys: string[]) => {
    let count = 0;
    for (const key of keys) {
      if (store.delete(key)) count++;
    }
    return count;
  });
  return {
    store,
    set,
    eval: evalFn,
    get,
    ping,
    del,
  };
}

describe("wrapUpstash", () => {
  let fake: ReturnType<typeof createFakeUpstash>;
  let client: ReturnType<typeof wrapUpstash>;

  beforeEach(() => {
    fake = createFakeUpstash();
    client = wrapUpstash(fake);
  });

  describe("get/set — raw string round-trips (automaticDeserialization: false)", () => {
    it("returns exactly the string that was set", async () => {
      await client.set("k", "fam_abc123");
      expect(await client.get("k")).toBe("fam_abc123");
    });

    it("preserves numeric-looking strings verbatim (not JSON-parsed to numbers)", async () => {
      // The rotated-session-store stores opaque ids; a JSON-parsing client would
      // turn "42" into the number 42 and break the `=== familyId` string compare.
      await client.set("k", "42");
      const got = await client.get("k");
      expect(got).toBe("42");
      expect(typeof got).toBe("string");
    });

    it("returns null for a missing key", async () => {
      expect(await client.get("absent")).toBeNull();
    });

    it("rejects a non-string GET reply naming the command", async () => {
      fake.get.mockResolvedValueOnce(42);
      await expect(client.get("k")).rejects.toThrow(/GET/);
    });
  });

  describe("set — optional PX expiry mapping", () => {
    it("passes { px } when an expiry is given", async () => {
      await client.set("k", "v", 5000);
      expect(fake.set).toHaveBeenCalledWith("k", "v", { px: 5000 });
    });

    it("passes undefined options when no expiry is given", async () => {
      await client.set("k", "v");
      expect(fake.set).toHaveBeenCalledWith("k", "v", undefined);
    });
  });

  describe("eval — reply validated at the HTTP boundary", () => {
    it("returns the numeric value from the Lua script (rate-limit / counter)", async () => {
      fake.eval.mockResolvedValueOnce(1);
      const result = await client.eval("script", ["k"], [10, 1000]);
      expect(result).toBe(1);
    });

    it("forwards (script, keys, args) unchanged to the Upstash client", async () => {
      await client.eval("the-script", ["k1", "k2"], [10, 1000]);
      expect(fake.eval).toHaveBeenCalledWith("the-script", ["k1", "k2"], [10, 1000]);
    });

    it('passes through a string-typed count (step-up jti `=== "1"` path)', async () => {
      fake.eval.mockResolvedValueOnce("1");
      expect(await client.eval("script", ["k"], [1])).toBe("1");
    });

    it("coerces a bigint reply to number, same as the ioredis path", async () => {
      fake.eval.mockResolvedValueOnce(42n);
      expect(await client.eval("script", ["k"], [1])).toBe(42);
    });

    it("passes a boolean reply through unchanged (RESP3)", async () => {
      fake.eval.mockResolvedValueOnce(true);
      expect(await client.eval("script", ["k"], [1])).toBe(true);
    });

    // The REST body carries no `result` when a script returns nil, so the SDK
    // hands back null or undefined depending on the shape. Both must land on
    // null: recovery-lockout-store does `Number(result)` on this, and
    // `Number(undefined)` is NaN, which compares false against every threshold.
    it("normalises a nil reply to null", async () => {
      fake.eval.mockResolvedValueOnce(null);
      expect(await client.eval("script", ["k"], [1])).toBeNull();
    });

    it("normalises a missing reply to null", async () => {
      fake.eval.mockResolvedValueOnce(undefined);
      expect(await client.eval("script", ["k"], [1])).toBeNull();
    });

    it("walks a nested array reply, coercing as it goes", async () => {
      fake.eval.mockResolvedValueOnce([1, "a", null, [42n, true]]);
      expect(await client.eval("script", ["k"], [1])).toEqual([1, "a", null, [42, true]]);
    });

    it("rejects a non-RESP value nested inside an array reply", async () => {
      fake.eval.mockResolvedValueOnce([1, { not: "a RESP value" }]);
      await expect(client.eval("script", ["k"], [1])).rejects.toThrow(/not a RESP value/);
    });

    it("rejects a reply RESP cannot carry (toRedisReply's contract)", async () => {
      fake.eval.mockResolvedValueOnce({ not: "a RESP value" });
      await expect(client.eval("script", ["k"], [1])).rejects.toThrow(/not a RESP value/);
    });
  });

  describe("del", () => {
    it("short-circuits on empty keys without calling the client", async () => {
      const delSpy = vi.spyOn(fake, "del");
      const result = await client.del();
      expect(result).toBe(0);
      expect(delSpy).not.toHaveBeenCalled();
    });

    it("returns the count of removed keys", async () => {
      await client.set("a", "1");
      await client.set("b", "2");
      expect(await client.del("a", "b", "missing")).toBe(2);
    });

    it("rejects a non-numeric DEL reply naming the command", async () => {
      fake.del.mockResolvedValueOnce("not a count");
      await expect(client.del("a")).rejects.toThrow(/DEL/);
    });
  });

  describe("ping / quit", () => {
    it("delegates ping", async () => {
      expect(await client.ping()).toBe("PONG");
    });

    it("maps a nil ping reply to an empty string rather than null", async () => {
      fake.ping.mockResolvedValueOnce(null);
      expect(await client.ping()).toBe("");
    });

    it("quit is a no-op for the stateless REST transport", async () => {
      await expect(client.quit()).resolves.toBeUndefined();
    });
  });
});
