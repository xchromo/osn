import type { RedisClient } from "@shared/redis";
import { createMemoryClient } from "@shared/redis";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInMemoryRotatedSessionStore,
  createRedisRotatedSessionStore,
  ROTATED_SESSIONS_MAX,
} from "../../src/lib/rotated-session-store";

describe("createInMemoryRotatedSessionStore", () => {
  it("reports its backend", () => {
    const store = createInMemoryRotatedSessionStore();
    expect(store.backend).toBe("memory");
  });

  it("track → check returns the familyId", async () => {
    const store = createInMemoryRotatedSessionStore();
    await store.track("hash1", "fam1", 60_000);
    expect(await store.check("hash1")).toBe("fam1");
  });

  it("check returns null for unknown hashes", async () => {
    const store = createInMemoryRotatedSessionStore();
    expect(await store.check("unknown")).toBe(null);
  });

  it("sweeps entries older than ttlMs on track", async () => {
    const store = createInMemoryRotatedSessionStore();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      await store.track("hash_old", "fam_old", 60_000);
      expect(await store.check("hash_old")).toBe("fam_old");

      // Advance well past the TTL then insert a new entry — the sweep runs
      // at track-time and should evict the stale record.
      vi.setSystemTime(new Date(1_000_000 + 120_000));
      await store.track("hash_new", "fam_new", 60_000);

      expect(await store.check("hash_old")).toBe(null);
      expect(await store.check("hash_new")).toBe("fam_new");
    } finally {
      vi.useRealTimers();
    }
  });

  it("revokeFamily clears every hash in the family", async () => {
    const store = createInMemoryRotatedSessionStore();
    await store.track("h1", "famA", 60_000);
    await store.track("h2", "famA", 60_000);
    await store.track("h3", "famB", 60_000);

    await store.revokeFamily("famA");

    expect(await store.check("h1")).toBe(null);
    expect(await store.check("h2")).toBe(null);
    expect(await store.check("h3")).toBe("famB");
  });

  it("bounds the map to ROTATED_SESSIONS_MAX entries", async () => {
    const store = createInMemoryRotatedSessionStore();
    // Use a TTL well longer than the test takes so sweeps are bound-driven,
    // not time-driven. Insert MAX+10 entries and confirm the oldest are gone.
    for (let i = 0; i < ROTATED_SESSIONS_MAX + 10; i++) {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential tracking
      await store.track(`h${i}`, "fam", 60_000);
    }
    // The first 10 should have been evicted; the newest must still be present.
    expect(await store.check("h0")).toBe(null);
    expect(await store.check(`h${ROTATED_SESSIONS_MAX + 9}`)).toBe("fam");
  });
});

describe("createRedisRotatedSessionStore (memory-backed RedisClient)", () => {
  let client: RedisClient;
  beforeEach(() => {
    // The shared memory client supports get/set/del which is all this store
    // uses — no Lua scripts. That lets us exercise the real Redis impl here.
    client = createMemoryClient();
  });

  it("reports its backend", () => {
    const store = createRedisRotatedSessionStore(client);
    expect(store.backend).toBe("redis");
  });

  it("track → check returns the familyId", async () => {
    const store = createRedisRotatedSessionStore(client);
    await store.track("hashR", "famR", 60_000);
    expect(await store.check("hashR")).toBe("famR");
  });

  it("check returns null for unknown hashes", async () => {
    const store = createRedisRotatedSessionStore(client);
    expect(await store.check("ghost")).toBe(null);
  });

  it("revokeFamily deletes every tracked hash plus the family set", async () => {
    const store = createRedisRotatedSessionStore(client);
    await store.track("h1", "famA", 60_000);
    await store.track("h2", "famA", 60_000);
    await store.track("h3", "famB", 60_000);

    await store.revokeFamily("famA");

    expect(await store.check("h1")).toBe(null);
    expect(await store.check("h2")).toBe(null);
    // Unrelated family must survive.
    expect(await store.check("h3")).toBe("famB");
  });

  it("revokeFamily is a no-op for unknown families", async () => {
    const store = createRedisRotatedSessionStore(client);
    await expect(store.revokeFamily("ghost-family")).resolves.toBeUndefined();
  });

  it("isolates namespaces between stores", async () => {
    const a = createRedisRotatedSessionStore(client, { namespace: "ns-a" });
    const b = createRedisRotatedSessionStore(client, { namespace: "ns-b" });

    await a.track("hash", "famA", 60_000);
    expect(await a.check("hash")).toBe("famA");
    // Same hash key, different namespace → miss.
    expect(await b.check("hash")).toBe(null);
  });

  it("does not clobber an unrelated family when tracking a duplicate hash", async () => {
    const store = createRedisRotatedSessionStore(client);
    // Duplicate tracks of the same hash under the same family must be
    // deduplicated inside the family set (otherwise revokeFamily would
    // try to DEL the same key twice — harmless but wasteful).
    await store.track("h", "famA", 60_000);
    await store.track("h", "famA", 60_000);

    await store.revokeFamily("famA");
    expect(await store.check("h")).toBe(null);
  });
});

const makeFailingClient = (): RedisClient => ({
  eval: async () => {
    throw new Error("redis down");
  },
  ping: async () => {
    throw new Error("redis down");
  },
  get: async () => {
    throw new Error("redis down");
  },
  set: async () => {
    throw new Error("redis down");
  },
  del: async () => {
    throw new Error("redis down");
  },
  quit: async () => {
    /* noop */
  },
});

describe("createRedisRotatedSessionStore fail-open behaviour", () => {
  it("check returns null on Redis error and reports it via onError", async () => {
    const onError = vi.fn();
    const store = createRedisRotatedSessionStore(makeFailingClient(), { onError });

    expect(await store.check("h")).toBe(null);
    expect(onError).toHaveBeenCalledWith("check", expect.any(Error));
  });

  it("track swallows Redis errors and reports via onError", async () => {
    const onError = vi.fn();
    const store = createRedisRotatedSessionStore(makeFailingClient(), { onError });

    await expect(store.track("h", "f", 60_000)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith("track", expect.any(Error));
  });

  it("revokeFamily swallows Redis errors and reports via onError", async () => {
    const onError = vi.fn();
    const store = createRedisRotatedSessionStore(makeFailingClient(), { onError });

    await expect(store.revokeFamily("f")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith("revoke_family", expect.any(Error));
  });
});

/**
 * Wraps the memory client so specific call sites can be forced to throw.
 * Lets us hit the partial-failure modes inside `track` without
 * reimplementing the store contract in a fake.
 */
const makeGatedClient = (
  base: RedisClient,
  gates: { throwOnSetCall?: number; throwOnGetCall?: number },
): RedisClient => {
  let setCalls = 0;
  let getCalls = 0;
  return {
    ...base,
    async set(key, value, pxMs) {
      setCalls += 1;
      if (gates.throwOnSetCall === setCalls) throw new Error("redis timeout");
      await base.set(key, value, pxMs);
    },
    async get(key) {
      getCalls += 1;
      if (gates.throwOnGetCall === getCalls) throw new Error("redis timeout");
      return base.get(key);
    },
  };
};

const throwingOnError = (): void => {
  throw new Error("logger exploded");
};

describe("createRedisRotatedSessionStore partial-failure behaviour", () => {
  it("track: hash SET succeeds but family-set write fails — check still returns familyId", async () => {
    // Documented invariant (see the track impl comment): the hash key is
    // the one `check` actually reads, and it is written first in isolation.
    // A failure on the subsequent family-set write must not erase that.
    const base = createMemoryClient();
    const onError = vi.fn();
    const store = createRedisRotatedSessionStore(makeGatedClient(base, { throwOnSetCall: 2 }), {
      onError,
    });

    await store.track("h", "famP", 60_000);
    expect(await store.check("h")).toBe("famP");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("track", expect.any(Error));
  });

  it("track: hash SET fails — check misses (the accepted fail-open trade-off)", async () => {
    // The inverse scenario. If the very first write throws, the store has
    // no record of the rotated hash. `check` will miss on replay — this is
    // the documented fail-open posture, accepted because aborting the
    // rotation itself would be worse UX than a momentary reuse-detection gap.
    const base = createMemoryClient();
    const onError = vi.fn();
    const store = createRedisRotatedSessionStore(makeGatedClient(base, { throwOnSetCall: 1 }), {
      onError,
    });

    await store.track("h", "famQ", 60_000);
    expect(await store.check("h")).toBe(null);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("track", expect.any(Error));
  });

  it("track: family-set read throws — hash SET already committed, check still works", async () => {
    // Third mode: the GET used to merge the family set fails. Like the
    // "second SET fails" case, the first SET has already committed, so
    // `check` must still return the familyId.
    const base = createMemoryClient();
    const onError = vi.fn();
    const store = createRedisRotatedSessionStore(makeGatedClient(base, { throwOnGetCall: 1 }), {
      onError,
    });

    await store.track("h", "famR", 60_000);
    expect(await store.check("h")).toBe("famR");
    expect(onError).toHaveBeenCalledWith("track", expect.any(Error));
  });

  it("onError callbacks that throw do not break the store contract", async () => {
    // `index.ts` wires onError to an Effect.runPromise/logger call that
    // could itself throw if the observability layer is misconfigured. The
    // store contract must be robust to that: a crashing callback cannot
    // cascade into a thrown rejection from track/check/revokeFamily, or
    // reuse detection would silently hard-fail on logger misconfiguration.
    const store = createRedisRotatedSessionStore(makeFailingClient(), {
      onError: throwingOnError,
    });

    await expect(store.track("h", "f", 60_000)).resolves.toBeUndefined();
    await expect(store.check("h")).resolves.toBe(null);
    await expect(store.revokeFamily("f")).resolves.toBeUndefined();
  });
});
