/**
 * In-process JWKS public key cache for verifying OSN-issued user access tokens.
 *
 * Fetches the OSN API's JWKS endpoint on cache miss and caches resolved
 * CryptoKeys by `kid` for JWKS_CACHE_TTL_MS. On verification failure, the
 * cache is bypassed once (refresh path) to handle key rotation.
 */

import { importKeyFromJwk } from "@shared/crypto";
import { instrumentedFetch } from "@shared/observability/fetch";

import { metricJwksCacheLookup } from "../metrics";

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedKey {
  key: CryptoKey;
  fetchedAt: number;
}

const cache = new Map<string, CachedKey>();

async function fetchPublicKey(kid: string, jwksUrl: string): Promise<CryptoKey | null> {
  let res: Response;
  try {
    res = await instrumentedFetch(jwksUrl);
  } catch (err) {
    // Log without console.* — structured log is emitted by the OTel layer
    // but we're outside an Effect context here, so we record the metric and
    // return null to treat it as an auth miss (soft fail).
    metricJwksCacheLookup("miss");
    // Re-throw so callers know the fetch itself failed (distinct from key-not-found).
    throw err;
  }

  if (!res.ok) {
    metricJwksCacheLookup("miss");
    return null;
  }

  let body: { keys?: unknown[] };
  try {
    body = (await res.json()) as { keys?: unknown[] };
  } catch {
    metricJwksCacheLookup("miss");
    return null;
  }

  const keys = Array.isArray(body.keys) ? body.keys : [];
  const jwk = keys.find(
    (k): k is Record<string, unknown> =>
      typeof k === "object" && k !== null && (k as Record<string, unknown>)["kid"] === kid,
  );

  if (!jwk) {
    metricJwksCacheLookup("miss");
    return null;
  }

  try {
    return await importKeyFromJwk(jwk);
  } catch {
    metricJwksCacheLookup("miss");
    return null;
  }
}

/**
 * Returns the CryptoKey for `kid` from the cache or the JWKS endpoint.
 * Returns `null` if the key cannot be resolved (network error, unknown kid, malformed JWK).
 */
export async function resolvePublicKeyForKid(
  kid: string,
  jwksUrl: string,
): Promise<CryptoKey | null> {
  const now = Date.now();
  const cached = cache.get(kid);
  if (cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    metricJwksCacheLookup("hit");
    return cached.key;
  }

  const key = await fetchPublicKey(kid, jwksUrl);
  if (key) {
    cache.set(kid, { key, fetchedAt: now });
    metricJwksCacheLookup("miss");
  }
  return key;
}

/**
 * Bypasses the cache and re-fetches the JWKS endpoint for `kid`.
 * Call this when token verification fails against a cached key — it may have
 * been rotated. Updates the cache on success.
 */
export async function refreshPublicKeyForKid(
  kid: string,
  jwksUrl: string,
): Promise<CryptoKey | null> {
  const key = await fetchPublicKey(kid, jwksUrl);
  if (key) {
    cache.set(kid, { key, fetchedAt: Date.now() });
    metricJwksCacheLookup("refresh");
  }
  return key;
}

/** Clears the key cache. Tests only. */
export function clearJwksCache(): void {
  cache.clear();
}
