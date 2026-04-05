import { SignJWT, jwtVerify, importJWK, exportJWK } from "jose";
import { Effect, Data } from "effect";
import { eq } from "drizzle-orm";
import { Db } from "@osn/db/service";
import { serviceAccounts } from "@osn/db";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ArcTokenError extends Data.TaggedError("ArcTokenError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArcTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly scope: string;
}

export interface ArcTokenPayload extends ArcTokenClaims {
  readonly iat: number;
  readonly exp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARC_ALG = "ES256";
const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const CACHE_REISSUE_BUFFER_SECONDS = 30;

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generates an ES256 (ECDSA P-256) key pair for ARC token signing/verification.
 * Returns Web Crypto CryptoKeyPair with extractable keys suitable for JWK export.
 */
export async function generateArcKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable — needed for JWK export
    ["sign", "verify"],
  );
}

/**
 * Exports a CryptoKey to JWK format (JSON string for DB storage).
 */
export async function exportKeyToJwk(key: CryptoKey): Promise<string> {
  const jwk = await exportJWK(key);
  return JSON.stringify(jwk);
}

/**
 * Imports a JWK (JSON string or object) to a CryptoKey for verification.
 */
export async function importKeyFromJwk(
  jwk: string | Record<string, unknown>,
  _usage: "sign" | "verify",
): Promise<CryptoKey> {
  const parsed = typeof jwk === "string" ? JSON.parse(jwk) : jwk;
  return importJWK(parsed, ARC_ALG) as Promise<CryptoKey>;
}

// ---------------------------------------------------------------------------
// Token creation
// ---------------------------------------------------------------------------

/**
 * Creates a signed ARC token (ES256 JWT).
 *
 * @param privateKey - The calling service's private key
 * @param claims - iss (issuer service ID), aud (target service), scope (permissions)
 * @param ttl - Time-to-live in seconds (default: 300 = 5 minutes)
 */
export async function createArcToken(
  privateKey: CryptoKey,
  claims: ArcTokenClaims,
  ttl: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  if (ttl <= 0 || ttl > 600) {
    throw new ArcTokenError({ message: `Invalid TTL: ${ttl}. Must be between 1 and 600 seconds.` });
  }

  return new SignJWT({ scope: claims.scope })
    .setProtectedHeader({ alg: ARC_ALG })
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(privateKey);
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/**
 * Verifies an ARC token's signature, expiry, audience, and scope.
 *
 * @param token - The JWT string
 * @param publicKey - The issuer's public key
 * @param expectedAudience - The service ID that this token should be addressed to
 * @param requiredScope - If provided, the token must include this scope
 */
export async function verifyArcToken(
  token: string,
  publicKey: CryptoKey,
  expectedAudience: string,
  requiredScope?: string,
): Promise<ArcTokenPayload> {
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: [ARC_ALG],
    audience: expectedAudience,
  }).catch((cause) => {
    throw new ArcTokenError({ message: "ARC token verification failed", cause });
  });

  const scope = payload.scope as string | undefined;
  if (!scope) {
    throw new ArcTokenError({ message: "ARC token missing scope claim" });
  }

  if (requiredScope) {
    const scopes = scope.split(",").map((s) => s.trim());
    if (!scopes.includes(requiredScope)) {
      throw new ArcTokenError({
        message: `ARC token missing required scope: ${requiredScope}`,
      });
    }
  }

  return {
    iss: payload.iss!,
    aud: (Array.isArray(payload.aud) ? payload.aud[0] : payload.aud)!,
    scope,
    iat: payload.iat!,
    exp: payload.exp!,
  };
}

// ---------------------------------------------------------------------------
// Public key resolution (Effect-based, requires Db)
// ---------------------------------------------------------------------------

/**
 * Resolves a service's public key from the `service_accounts` table.
 * For first-party services registered in the DB.
 */
export const resolvePublicKey = (issuer: string): Effect.Effect<CryptoKey, ArcTokenError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db;

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ publicKeyJwk: serviceAccounts.publicKeyJwk })
          .from(serviceAccounts)
          .where(eq(serviceAccounts.serviceId, issuer))
          .limit(1),
      catch: (cause) => new ArcTokenError({ message: "Failed to query service_accounts", cause }),
    });

    if (rows.length === 0) {
      return yield* Effect.fail(new ArcTokenError({ message: `Unknown service: ${issuer}` }));
    }

    return yield* Effect.tryPromise({
      try: () => importKeyFromJwk(rows[0].publicKeyJwk, "verify"),
      catch: (cause) => new ArcTokenError({ message: `Invalid public key for ${issuer}`, cause }),
    });
  });

// ---------------------------------------------------------------------------
// In-memory token cache
// ---------------------------------------------------------------------------

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number; // Unix timestamp in seconds
}

const tokenCache = new Map<string, CachedToken>();

function cacheKey(iss: string, aud: string, scope: string): string {
  return `${iss}:${aud}:${scope}`;
}

/**
 * Returns a cached ARC token if it's still valid (with 30s buffer),
 * or creates a new one.
 */
export async function getOrCreateArcToken(
  privateKey: CryptoKey,
  claims: ArcTokenClaims,
  ttl: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const key = cacheKey(claims.iss, claims.aud, claims.scope);
  const cached = tokenCache.get(key);
  const now = Math.floor(Date.now() / 1000);

  if (cached && cached.expiresAt - CACHE_REISSUE_BUFFER_SECONDS > now) {
    return cached.token;
  }

  const token = await createArcToken(privateKey, claims, ttl);
  tokenCache.set(key, { token, expiresAt: now + ttl });
  return token;
}

/**
 * Clears all cached tokens. Useful for testing.
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * Evicts expired entries from the cache. Can be called periodically.
 */
export function evictExpiredTokens(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAt <= now) {
      tokenCache.delete(key);
    }
  }
}
