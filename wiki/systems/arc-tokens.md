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
- **Public key discovery:** first-party services registered in `service_accounts` DB table (`service_id`, `public_key_jwk`, `allowed_scopes`); third-party apps use JWKS URL derived from `iss`

## Location

Lives in `osn/crypto` (`@osn/crypto`). Import from `@osn/crypto/arc`.

## Exports

```typescript
generateArcKeyPair()                                      // → CryptoKeyPair (ES256)
exportKeyToJwk(key)                                       // → JSON string (for DB storage)
importKeyFromJwk(jwk)                                     // → CryptoKey
createArcToken(privateKey, { iss, aud, scope }, ttl?)     // → signed JWT string
verifyArcToken(token, publicKey, expectedAud, scope?)     // → ArcTokenPayload or throws
resolvePublicKey(issuer, tokenScopes?)                    // → Effect<CryptoKey, ArcTokenError, Db>
getOrCreateArcToken(privateKey, { iss, aud, scope }, ttl?) // → cached JWT (re-issues 30s before expiry)
clearTokenCache() / clearPublicKeyCache()                 // → for testing / key rotation
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

## Service Registration

Two strategies for registering a service's public key:

### Option A — Startup self-registration (recommended for dev/staging)

`osn/api` exposes `POST /graph/internal/register-service`, protected by a shared `INTERNAL_SERVICE_SECRET` Bearer token. On startup, a service:

1. Generates an ephemeral P-256 key pair (`generateArcKeyPair()`)
2. Exports the public key (`exportKeyToJwk(pair.publicKey)`)
3. POSTs `{ serviceId, publicKeyJwk, allowedScopes }` to the endpoint

No private key in any file — only `INTERNAL_SERVICE_SECRET` (a simple string) in both services' env. The endpoint upserts the `service_accounts` row, so key rotation is free (just restart).

```bash
# Both env files need:
INTERNAL_SERVICE_SECRET=<shared-random-string>
```

### Option B — Pre-distributed stable key (production)

1. Generate a key pair once: `bunx --bun tsx osn/crypto/scripts/gen-arc-keypair.ts`
2. Set `PULSE_API_ARC_PRIVATE_KEY=<private-key-jwk>` in the service's env (never commit)
3. Insert the public key into `service_accounts` via migration or admin tool

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

- [osn/crypto/src/arc.ts](../osn/crypto/src/arc.ts) -- ARC token implementation
- [osn/crypto/src/arc-metrics.ts](../osn/crypto/src/arc-metrics.ts) -- ARC metrics
- [osn/core/src/lib/arc-middleware.ts](../osn/core/src/lib/arc-middleware.ts) -- `requireArc` Elysia middleware
- [osn/core/src/routes/graph-internal.ts](../osn/core/src/routes/graph-internal.ts) -- Internal graph routes (ARC-protected)
- [osn/db/src/schema.ts](../osn/db/src/schema.ts) -- `service_accounts` table definition
- [CLAUDE.md](../CLAUDE.md) -- "ARC Tokens (S2S Auth)" section
