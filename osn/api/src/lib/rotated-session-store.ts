/**
 * Cluster-safe record of rotated-out session hashes for reuse detection
 * (Copenhagen Book C2).
 *
 * When a refresh-token rotation swaps the session row, the old hash is
 * tracked here so that a later replay of the rotated-out token can be
 * recognised and trigger full family revocation. The in-memory default is
 * correct for single-process dev/test but breaks in multi-pod deployments:
 * a rotation recorded on pod A is invisible to pod B, so replays hitting
 * B pass silently and reuse detection degrades to "only the pod that
 * rotated the token can catch its reuse".
 *
 * The Redis-backed implementation closes that gap (S-H1). Failure modes
 * are intentionally asymmetric:
 *
 *   - `track` fail-open: we log a warning and continue. Rotation itself
 *     already succeeded at the DB layer; losing the tracking record only
 *     weakens *future* reuse detection, and aborting rotation on Redis
 *     unavailability would be a worse UX than a temporary gap.
 *   - `check` fail-open (returns `null`): a Redis outage must not
 *     manufacture false-positive family revocations that log legitimate
 *     users out. Detection is weakened; active sessions are preserved.
 *   - `revokeFamily` fail-open: the primary DB-level family delete has
 *     already run by the time we get here. Leaving stale hash keys in
 *     Redis is harmless — they expire with the refresh-token TTL anyway.
 */

import type { RedisClient } from "@shared/redis";

/**
 * Public handle on whichever backend the store is running against. Included
 * in the interface so call sites can dimension metrics by backend without
 * re-reading config.
 */
export type RotatedSessionStoreBackend = "memory" | "redis";

export interface RotatedSessionStore {
  readonly backend: RotatedSessionStoreBackend;
  /** Record that `sessionHash` was rotated out of `familyId`. */
  track(sessionHash: string, familyId: string, ttlMs: number): Promise<void>;
  /** Look up the family a rotated-out hash belonged to, or `null` if unknown. */
  check(sessionHash: string): Promise<string | null>;
  /** Drop every tracking record for `familyId` (belt-and-braces cleanup). */
  revokeFamily(familyId: string): Promise<void>;
}

/**
 * Hard cap on in-memory entries. Belt-and-braces defence against pathological
 * rotation workloads — the primary eviction path is still the per-track FIFO
 * sweep keyed off `ttlMs`.
 */
export const ROTATED_SESSIONS_MAX = 100_000;

interface MemoryEntry {
  familyId: string;
  rotatedAt: number;
}

/**
 * In-memory store — correct for single-process dev/test. Port of the FIFO
 * sweep that previously lived inline in `auth.ts`.
 */
export function createInMemoryRotatedSessionStore(): RotatedSessionStore {
  const entries = new Map<string, MemoryEntry>();
  const order: string[] = [];

  function sweep(ttlMs: number): void {
    const cutoff = Date.now() - ttlMs;
    while (order.length > 0) {
      const oldest = order[0]!;
      const entry = entries.get(oldest);
      if (!entry || entry.rotatedAt < cutoff) {
        order.shift();
        if (entry) entries.delete(oldest);
        continue;
      }
      break;
    }
    while (order.length >= ROTATED_SESSIONS_MAX) {
      const oldest = order.shift()!;
      entries.delete(oldest);
    }
  }

  return {
    backend: "memory",
    async track(sessionHash, familyId, ttlMs) {
      sweep(ttlMs);
      entries.set(sessionHash, { familyId, rotatedAt: Date.now() });
      order.push(sessionHash);
    },
    async check(sessionHash) {
      const entry = entries.get(sessionHash);
      return entry ? entry.familyId : null;
    },
    async revokeFamily(familyId) {
      for (const [k, v] of entries) {
        if (v.familyId === familyId) entries.delete(k);
      }
    },
  };
}

export interface RedisRotatedSessionStoreConfig {
  /** Redis key namespace. Default: "osn:rot-session". */
  namespace?: string;
  /**
   * Optional hook invoked on any caught Redis error. Routed to the logger
   * at the call site so this library stays decoupled from the observability
   * layer. The store itself returns fail-open results on error.
   */
  onError?: (action: "track" | "check" | "revoke_family", cause: unknown) => void;
}

function hashKey(namespace: string, sessionHash: string): string {
  return `${namespace}:hash:${sessionHash}`;
}

function familyKey(namespace: string, familyId: string): string {
  return `${namespace}:fam:${familyId}`;
}

/**
 * Redis-backed store. Uses two key families:
 *
 *   - `{ns}:hash:{sessionHash}` → familyId, PX = ttlMs (the authoritative
 *     lookup used by `check`).
 *   - `{ns}:fam:{familyId}` → JSON array of tracked hashes, PX = ttlMs
 *     (used only by `revokeFamily` to clean up hash keys proactively; TTL
 *     is a safety net in case revocation is never called).
 *
 * `track` performs two writes (hash + family set) without a Lua atomic.
 * In practice a given family only rotates one token at a time (the
 * refresh chain is linear), so the theoretical concurrent-append race
 * cannot occur under legitimate traffic; and even if it did, the hash key
 * — the one `check` actually reads — is written atomically on its own.
 */
export function createRedisRotatedSessionStore(
  client: RedisClient,
  config: RedisRotatedSessionStoreConfig = {},
): RotatedSessionStore {
  const namespace = config.namespace ?? "osn:rot-session";
  const userOnError = config.onError;

  // Shield the store contract from a misbehaving callback: the composition
  // root wires `onError` to `Effect.runPromise(logger)` which could itself
  // throw under logger misconfiguration. A throw there must not cascade
  // into a rejected track/check/revokeFamily — that would silently hard-fail
  // reuse detection on observability outages, which is strictly worse than
  // the documented fail-open contract.
  const onError = userOnError
    ? (action: "track" | "check" | "revoke_family", cause: unknown) => {
        try {
          userOnError(action, cause);
        } catch {
          /* swallowed — contract above */
        }
      }
    : undefined;

  return {
    backend: "redis",
    async track(sessionHash, familyId, ttlMs) {
      try {
        await client.set(hashKey(namespace, sessionHash), familyId, ttlMs);
        const famKey = familyKey(namespace, familyId);
        const existing = await client.get(famKey);
        const arr: string[] = existing ? (JSON.parse(existing) as string[]) : [];
        if (!arr.includes(sessionHash)) arr.push(sessionHash);
        await client.set(famKey, JSON.stringify(arr), ttlMs);
      } catch (cause) {
        onError?.("track", cause);
      }
    },
    async check(sessionHash) {
      try {
        return await client.get(hashKey(namespace, sessionHash));
      } catch (cause) {
        onError?.("check", cause);
        return null;
      }
    },
    async revokeFamily(familyId) {
      try {
        const famKey = familyKey(namespace, familyId);
        const json = await client.get(famKey);
        const members: string[] = json ? (JSON.parse(json) as string[]) : [];
        const keys = members.map((h) => hashKey(namespace, h));
        keys.push(famKey);
        if (keys.length > 0) await client.del(...keys);
      } catch (cause) {
        onError?.("revoke_family", cause);
      }
    },
  };
}
