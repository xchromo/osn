/**
 * Worker-slim ARC verify.
 *
 * `@shared/crypto` pulls in `@osn/db` transitively (the DB-backed key
 * resolver), which doesn't work in the Workers runtime. This module has
 * the same verification contract but fetches the issuer's public keys
 * from a JWKS URL and caches them in Worker global scope — keeping the
 * Worker cold-start cheap without taking a DB dependency.
 *
 * Scope + audience are enforced here; anything beyond that
 * (template-specific rate-limit caps, recipient validation) lives in
 * the handler.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult } from "jose";

export interface ArcVerifyConfig {
  readonly jwksUrl: string;
  readonly expectedIssuer: string;
  readonly expectedAudience: string;
  readonly requiredScope: string;
}

export type ArcVerifyError =
  | { readonly reason: "missing_header" }
  | { readonly reason: "bad_scheme" }
  | { readonly reason: "verify_failed"; readonly cause?: unknown }
  | { readonly reason: "scope_denied" }
  | { readonly reason: "issuer_mismatch" };

// Workers reuse globalThis across requests within an isolate, so a
// module-level `createRemoteJWKSet` handle is cached + reused for the
// lifetime of the isolate (the underlying `jose` helper already caches
// the JWKS response; we just avoid the factory overhead).
let cachedKeySet: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedKeySetUrl: string | null = null;

const getKeySet = (jwksUrl: string) => {
  if (cachedKeySet && cachedKeySetUrl === jwksUrl) return cachedKeySet;
  cachedKeySet = createRemoteJWKSet(new URL(jwksUrl));
  cachedKeySetUrl = jwksUrl;
  return cachedKeySet;
};

/**
 * Parses the ARC header (`Authorization: ARC <jwt>`), verifies the JWT
 * against the configured JWKS, and enforces audience + issuer + scope.
 * Returns `{ ok: true, payload }` on success; structured error otherwise.
 */
export async function verifyArc(
  authorizationHeader: string | null,
  config: ArcVerifyConfig,
): Promise<
  | { readonly ok: true; readonly payload: JWTVerifyResult["payload"] }
  | { readonly ok: false; readonly error: ArcVerifyError }
> {
  if (!authorizationHeader) {
    return { ok: false, error: { reason: "missing_header" } };
  }
  const [scheme, token] = authorizationHeader.split(" ", 2);
  if (scheme !== "ARC" || !token) {
    return { ok: false, error: { reason: "bad_scheme" } };
  }
  try {
    const { payload } = await jwtVerify(token, getKeySet(config.jwksUrl), {
      algorithms: ["ES256"],
      audience: config.expectedAudience,
      issuer: config.expectedIssuer,
    });
    const scopes = typeof payload.scope === "string" ? payload.scope.split(",") : [];
    if (!scopes.map((s) => s.trim().toLowerCase()).includes(config.requiredScope.toLowerCase())) {
      return { ok: false, error: { reason: "scope_denied" } };
    }
    if (payload.iss !== config.expectedIssuer) {
      // jose already enforces this when `issuer` is passed, but we defensive
      // double-check in case the library ever softens the check.
      return { ok: false, error: { reason: "issuer_mismatch" } };
    }
    return { ok: true, payload };
  } catch (cause) {
    return { ok: false, error: { reason: "verify_failed", cause } };
  }
}
