---
title: ARC Tokens (S2S Auth)
aliases:
  - ARC
  - service-to-service auth
  - S2S tokens
  - machine-to-machine auth
tags:
  - systems
  - auth
  - s2s
  - security
  - crypto
status: current
related:
  - "[[s2s-patterns]]"
  - "[[rate-limiting]]"
  - "[[arc-token-debugging]]"
finding-ids:
  - S-C2
packages:
  - "@osn/crypto"
  - "@osn/core"
  - "@pulse/api"
last-reviewed: 2026-04-17
---

# ARC Tokens (S2S Auth)

ARC is OSN's service-to-service authentication token -- an ASAP-style self-issued JWT for backend-to-backend calls (e.g. Pulse API querying OSN Core's social graph).

## Key Properties

- **ES256 (ECDSA P-256)** -- compact, fast, no shared secret
- **Self-issued:** each service signs its own token with its private key
- **Short-lived (5 min TTL);** cached in-memory, re-issued 30s before expiry
- **Scope-gated:** `scope` claim limits what the token can do (e.g. `graph:read`)
- **Audience-scoped:** `aud` claim names the target service (e.g. `"osn-core"`)
- **`kid`-keyed:** JWT protected header carries `kid` (key ID UUID); receiver looks up the specific key row, not just the issuer
- **Public key discovery:** first-party services have rows in `service_accounts` (allowed scopes) + `service_account_keys` (key material per `kid`); third-party apps use JWKS URL derived from `iss`
- **Automatic rotation:** ephemeral keys are rotated before expiry via `startKeyRotation()` — no manual key management required

## Location

Lives in `osn/crypto` (`@osn/crypto`). Import from `@osn/crypto/arc`.

## Exports

```typescript
generateArcKeyPair()                                           // → CryptoKeyPair (ES256)
exportKeyToJwk(key)                                            // → JSON string (for DB storage)
importKeyFromJwk(jwk)                                          // → CryptoKey
createArcToken(privateKey, { iss, aud, scope, kid }, ttl?)     // → signed JWT string; kid in header
verifyArcToken(token, publicKey, expectedAud, scope?)           // → ArcTokenPayload or throws
resolvePublicKey(kid, issuer, tokenScopes?)                    // → Effect<CryptoKey, ArcTokenError, Db>
getOrCreateArcToken(privateKey, { iss, aud, scope, kid }, ttl?) // → cached JWT (cache key: kid:iss:aud:scope)
clearTokenCache() / clearPublicKeyCache()                      // → for testing / key rotation
```

## When to Use ARC Tokens

| Scenario | Use ARC? | Why |
|----------|----------|-----|
| Pulse API -> OSN Core graph | **Yes** | HTTP call to `/graph/internal/*` must prove caller identity |
| Third-party app -> any OSN endpoint | **Yes** | Caller has no shared secret; presents its public key via JWKS |
| User-facing API call | No | Use user JWT (Bearer token); ARC is machine-to-machine only |
| Background job -> OSN Core | **Yes** | Job acts as a service, not a user |

## Calling Service (Token Issuer) — Typical Pattern

```typescript
import { getOrCreateArcToken, generateArcKeyPair, exportKeyToJwk } from "@osn/crypto";

// Boot-time: either load pre-distributed private key or generate ephemeral pair
// See pulse/api/src/services/graphBridge.ts for the Promise-singleton pattern.
const pair = await generateArcKeyPair();
// Register public key with osn/api using INTERNAL_SERVICE_SECRET...

// Per-request: get a cached or fresh token
const token = await getOrCreateArcToken(pair.privateKey, {
  iss: "pulse-api",      // this service's service_id
  aud: "osn-core",       // target service
  scope: "graph:read",   // minimal required scope
});

// Attach to outgoing HTTP request
fetch("http://localhost:4000/graph/internal/connections", {
  headers: { Authorization: `ARC ${token}` },
});
```

## Receiving Service (Token Verifier) -- Typical Pattern

```typescript
import { verifyArcToken } from "@osn/crypto/arc";
import { resolvePublicKey } from "@osn/crypto/arc";
import { Effect } from "effect";

// In an Elysia route guard or middleware:
const arcMiddleware = (requiredScope: string) => async (ctx) => {
  const auth = ctx.headers.authorization;
  if (!auth?.startsWith("ARC ")) return ctx.set.status = 401;

  const token = auth.slice(4);
  // resolvePublicKey looks up the issuer in service_accounts table + validates allowed_scopes
  const publicKey = await Effect.runPromise(
    resolvePublicKey(/* iss from token */, [requiredScope]).pipe(Effect.provide(DbLive))
  );
  const claims = await verifyArcToken(token, publicKey, "osn-core", requiredScope);
  // claims.iss, claims.aud, claims.scope are now verified
};
```

## Key Storage Schema

Two DB tables cooperate:

| Table | Columns | Purpose |
|-------|---------|---------|
| `service_accounts` | `service_id PK`, `allowed_scopes`, timestamps | Maps issuer ID → allowed scope list |
| `service_account_keys` | `key_id PK`, `service_id FK`, `public_key_jwk`, `registered_at`, `expires_at`, `revoked_at` | Per-key material; multiple rows per service during rotation |

`resolvePublicKey(kid, issuer, scopes?)` joins both tables, rejects expired (`expires_at < now`) and revoked (`revoked_at IS NOT NULL`) keys. Key cache keyed by `kid`.

## Service Registration

Two strategies for registering a service's public key:

### Option A — Startup self-registration with auto-rotation (recommended for dev/staging)

`osn/api` exposes `POST /graph/internal/register-service`, protected by a shared `INTERNAL_SERVICE_SECRET` Bearer token. On startup, `startKeyRotation()` in `pulse/api`:

1. Generates an ephemeral P-256 key pair with a UUID `keyId`
2. Exports the public key (`exportKeyToJwk(pair.publicKey)`)
3. POSTs `{ serviceId, keyId, publicKeyJwk, allowedScopes, expiresAt }` to the endpoint
4. Schedules rotation `KEY_ROTATION_BUFFER_HOURS` (default 2h) before expiry
5. On rotation: registers the new key BEFORE swapping the signing singleton — zero downtime

No private key in any file. Env vars: `INTERNAL_SERVICE_SECRET`, `KEY_TTL_HOURS` (default 24), `KEY_ROTATION_BUFFER_HOURS` (default 2).

```bash
# Both env files need:
INTERNAL_SERVICE_SECRET=<shared-random-string>
```

### Option B — Pre-distributed stable key (production)

1. Generate a key pair once: `bunx --bun tsx osn/crypto/scripts/gen-arc-keypair.ts`
2. Set `PULSE_API_ARC_PRIVATE_KEY=<private-key-jwk>` and `PULSE_API_ARC_KEY_ID=<uuid>` in the service's env (never commit)
3. Insert a row into `service_account_keys` (and `service_accounts`) via migration or admin tool; `expires_at NULL` for no expiry

Rotation is manual per-deployment: deploy new private key + insert new key row, revoke old via `DELETE /graph/internal/service-keys/:oldKeyId`.

### Key revocation

`DELETE /graph/internal/service-keys/:keyId` (also protected by `INTERNAL_SERVICE_SECRET`) sets `revoked_at` immediately. Tokens signed with that key are rejected at the next verification attempt (no wait for expiry).

## Current S2S Strategy

Pulse API calls `osn/api`'s `/graph/internal/*` endpoints over HTTP, authenticated with ARC tokens. ARC token verification middleware (`requireArc` in `osn/core/src/lib/arc-middleware.ts`) protects all inbound calls. The [[s2s-patterns|graphBridge]] in `pulse/api` is the only file that makes these calls.

## Security Notes

- **S-C2 (fixed):** Untrusted ARC `iss` claim was used as a metric label before verification. Fixed with `safeIssuer()` runtime guard in `arc-metrics.ts` -- any `iss`/`aud` not matching `/^[a-z][a-z0-9-]{1,30}$/` collapses to `"unknown"`.
- ARC tokens are machine-to-machine only. Never use them for user-facing authentication (use user JWTs for that).
- The `Authorization: ARC ...` header is the trust boundary for inbound trace context propagation -- only ARC-authenticated callers have their `traceparent` honoured.

## Metrics

ARC token metrics live in `osn/crypto/src/arc-metrics.ts`:
- `arc.token.issued` -- counter by issuer/audience
- `arc.token.verification` -- counter by result (ok, expired, bad_signature, etc.)
- All issuer/audience values pass through `safeIssuer()` to prevent cardinality explosion

## Source Files

- [osn/crypto/src/arc.ts](../osn/crypto/src/arc.ts) -- ARC token implementation (`kid`, `resolvePublicKey`, rotation cache)
- [osn/crypto/src/arc-metrics.ts](../osn/crypto/src/arc-metrics.ts) -- ARC metrics
- [osn/core/src/lib/arc-middleware.ts](../osn/core/src/lib/arc-middleware.ts) -- `requireArc` Elysia middleware (reads `kid` from header)
- [osn/core/src/routes/graph-internal.ts](../osn/core/src/routes/graph-internal.ts) -- Internal graph routes + `/register-service` + `/service-keys/:keyId` (revoke)
- [osn/db/src/schema/index.ts](../osn/db/src/schema/index.ts) -- `service_accounts` + `service_account_keys` table definitions
- [pulse/api/src/services/graphBridge.ts](../pulse/api/src/services/graphBridge.ts) -- `startKeyRotation()`, ephemeral key auto-rotation
- [CLAUDE.md](../CLAUDE.md) -- "ARC Tokens (S2S Auth)" section
