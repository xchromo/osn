import { Effect, type Layer } from "effect";
import { verifyArcToken, resolvePublicKey, type ArcTokenPayload } from "@osn/crypto";
import type { Db } from "@osn/db/service";

/**
 * Verified ARC caller claims attached to the request context after
 * successful middleware validation.
 */
export interface ArcCaller {
  /** Issuer service ID (e.g. "pulse-api") */
  readonly iss: string;
  /** Audience (this service, e.g. "osn-core") */
  readonly aud: string;
  /** Comma-separated scopes the token was issued with */
  readonly scope: string;
}

/**
 * Extracts the raw token from an `Authorization: ARC <token>` header.
 */
function extractArcToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^ARC\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Decodes the JWT payload without verification to read the `iss` claim.
 * Needed to look up the issuer's public key before we can verify the
 * signature. Returns null if the token is malformed.
 */
function peekIssuer(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as { iss?: string };
    return typeof payload.iss === "string" ? payload.iss : null;
  } catch {
    return null;
  }
}

/**
 * Decodes the JWT payload without verification to read the `scope` claim.
 * Returns the normalised scopes array, or empty array if missing/malformed.
 */
function peekScopes(token: string): string[] {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return [];
    const payload = JSON.parse(atob(parts[1])) as { scope?: string };
    if (typeof payload.scope !== "string") return [];
    return payload.scope
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * ARC token verification guard for Elysia route handlers.
 *
 * Validates the `Authorization: ARC <token>` header against the
 * `service_accounts` table:
 * 1. Extracts the raw token
 * 2. Peeks the `iss` claim to resolve the public key
 * 3. Verifies signature, audience, expiry, and required scope
 *
 * On success, returns the verified {@link ArcCaller} claims.
 * On failure, sets `set.status = 401` and returns `null`.
 *
 * @param authorization - The raw Authorization header value
 * @param set - Elysia's response status setter
 * @param dbLayer - The Effect Layer providing the Db service
 * @param expectedAudience - The service ID this token must be addressed to (e.g. "osn-core")
 * @param requiredScope - The scope the token must include (e.g. "graph:read")
 */
export async function requireArc(
  authorization: string | undefined,
  set: { status?: number | string },
  dbLayer: Layer.Layer<Db>,
  expectedAudience: string,
  requiredScope: string,
): Promise<ArcCaller | null> {
  const raw = extractArcToken(authorization);
  if (!raw) {
    set.status = 401;
    return null;
  }

  const issuer = peekIssuer(raw);
  if (!issuer) {
    set.status = 401;
    return null;
  }

  const scopes = peekScopes(raw);

  try {
    // Resolve the public key from the service_accounts table. Also
    // validates that the issuer exists and is authorised for the
    // claimed scopes.
    const publicKey = await Effect.runPromise(
      resolvePublicKey(issuer, scopes).pipe(Effect.provide(dbLayer)),
    );

    // Verify signature, audience, expiry, and required scope.
    const payload: ArcTokenPayload = await verifyArcToken(
      raw,
      publicKey,
      expectedAudience,
      requiredScope,
    );

    return {
      iss: payload.iss,
      aud: payload.aud,
      scope: payload.scope,
    };
  } catch {
    set.status = 401;
    return null;
  }
}
