/**
 * RedisClient interface — the subset of Redis operations used by @shared/redis.
 *
 * Two implementations:
 * - `wrapIoRedis(client)` adapts an ioredis instance for production
 * - `createMemoryClient()` provides an in-memory fallback for dev/test
 */

import type IORedis from "ioredis";

/**
 * Backend-agnostic Redis client contract. Production uses ioredis via
 * `wrapIoRedis()`; dev/test uses `createMemoryClient()`.
 */
export interface RedisClient {
  /** EVAL a Lua script atomically. */
  eval(
    script: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<unknown>;
  /** PING health check — returns "PONG". */
  ping(): Promise<string>;
  /** GET a string value by key. */
  get(key: string): Promise<string | null>;
  /** SET a string value with optional PX millisecond expiry. */
  set(key: string, value: string, pxMs?: number): Promise<void>;
  /** DEL one or more keys. Returns count of keys removed. */
  del(...keys: string[]): Promise<number>;
  /** Gracefully close the connection. */
  quit(): Promise<void>;
}

/** Wrap an ioredis instance as a `RedisClient`. */
export function wrapIoRedis(client: IORedis): RedisClient {
  return {
    async eval(script, keys, args) {
      return client.eval(script, keys.length, ...keys, ...args);
    },
    async ping() {
      return client.ping();
    },
    async get(key) {
      return client.get(key);
    },
    async set(key, value, pxMs) {
      if (pxMs !== undefined) {
        await client.set(key, value, "PX", pxMs);
      } else {
        await client.set(key, value);
      }
    },
    async del(...keys) {
      if (keys.length === 0) return 0;
      return client.del(...keys);
    },
    async quit() {
      await client.quit();
    },
  };
}

/**
 * In-memory RedisClient for dev/test — no external Redis server needed.
 *
 * Uses a single `Map` store to mirror Redis's unified keyspace. The `eval`
 * method implements the fixed-window rate limit Lua script semantics
 * (INCR + PEXPIRE) so `createRedisRateLimiter` works identically against
 * both the real and in-memory backends.
 */
function isExpired(entry: { expiresAt?: number }): boolean {
  return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
}

export function createMemoryClient(): RedisClient {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  return {
    async eval(_script, keys, args) {
      // Fixed-window rate limit: KEYS[1] = key, ARGV[1] = maxRequests, ARGV[2] = windowMs
      const key = keys[0]!;
      const maxRequests = Number(args[0]);
      const windowMs = Number(args[1]);
      const now = Date.now();

      const entry = store.get(key);
      if (!entry || isExpired(entry)) {
        store.set(key, { value: "1", expiresAt: now + windowMs });
        return 1;
      }
      const current = Number(entry.value) + 1;
      entry.value = String(current);
      return current <= maxRequests ? 1 : 0;
    },
    async ping() {
      return "PONG";
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (isExpired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, pxMs) {
      store.set(key, {
        value,
        expiresAt: pxMs !== undefined ? Date.now() + pxMs : undefined,
      });
    },
    async del(...keys) {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    },
    async quit() {
      store.clear();
    },
  };
}
