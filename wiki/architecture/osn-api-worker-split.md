---
title: osn-api Worker Split Plan
tags:
  - architecture
  - infra
  - cloudflare
  - workers
  - planning
related:
  - "[[monorepo-structure]]"
  - "[[backend-patterns]]"
  - "[[arc-tokens]]"
  - "[[identity-model]]"
  - "[[production-deploy]]"
  - "[[free-tier-limits]]"
last-reviewed: 2026-07-03
---

# osn-api Worker Split Plan

> Status: **planned, not started.** Reverses the earlier "osn-api stays a single
> Worker" decision (CLAUDE.md). This page is the design; execution is a separate
> workstream sequenced *after* the [[auth-service-refactor]] (a clean module
> boundary in `auth.ts` is a prerequisite for cleanly extracting the identity
> Worker).

## Why split

Today one Worker (`osn-api`) serves identity/auth, social graph, organisations,
recommendations, and the ARC-gated internal S2S surface. One deploy, one blast
radius: a bug or bad deploy in recommendations can take down the JWT issuer that
every downstream service (`cire`, `pulse`, `zap`) depends on. Splitting isolates
the security-critical identity core from the higher-churn product surfaces and
lets each scale/deploy independently.

## Chosen boundary — three Workers by domain

Matches the route groups already composed in `osn/api/src/app.ts`, so the split
is mechanical at the composition root.

| Worker | Routes (current factories) | Trust surface |
|---|---|---|
| **osn-identity** | `createAuthRoutes`, `createProfileRoutes`, `createAccountErasureRoutes`, `/.well-known/jwks.json`, health | Browser (cookies + access JWT), the JWT **issuer** + JWKS |
| **osn-social** | `createGraphRoutes`, `createOrganisationRoutes`, `createRecommendationRoutes` | Browser (access JWT verify only — no cookie/session state) |
| **osn-internal** | `createInternalGraphRoutes`, `createInternalOrganisationRoutes`, `createInternalAccountRoutes` | S2S only (ARC), never browser-reachable |

Rationale for three (not two): the internal S2S surface has a fundamentally
different auth model (ARC, no cookies, no CORS/Origin guard) and a different
caller set (first-party services), so isolating it removes a whole class of
"could a browser reach this" reasoning and lets it run without the CORS/Origin
middleware entirely.

## The hard parts (and the plan for each)

1. **Shared D1.** All three Workers bind the *same* D1 database (accounts,
   sessions, passkeys, graph, orgs, service-accounts). This is fine — D1 is a
   binding, not a Worker-local resource — but migrations must stay owned by one
   place (`osn/db`), applied once, and all three Workers deploy against the same
   `database_id`. No schema fork.
2. **JWKS ownership.** Only **osn-identity** issues tokens and serves
   `/.well-known/jwks.json`. osn-social verifies access JWTs via
   `@shared/osn-auth-client` pointed at osn-identity's JWKS URL — it already
   works this way for cire/pulse/zap, so osn-social becomes just another
   downstream verifier. No private key leaves osn-identity.
3. **Cross-Worker calls.** Where osn-social/internal need identity operations
   (e.g. step-up verify), use **ARC over HTTP** (the existing pattern) or
   Cloudflare **service bindings** (Worker-to-Worker, no public hop). Prefer
   service bindings for the identity←→internal hop (lower latency, no public
   exposure); keep ARC for anything a non-Cloudflare caller also uses so the
   auth model stays uniform.
4. **Shared Effect runtime.** Each Worker builds its own `ManagedRuntime` at
   boot (the [[backend-patterns]] "build once" rule is per-isolate anyway). The
   `makeAppRunner` plumbing already isolates this — each Worker's entry wires
   its own layer graph. No shared-runtime coupling to unpick.
5. **Config duplication.** The env-var / secret set fragments per Worker
   (identity needs JWT keys + pepper + Upstash + Resend; social needs only JWKS
   URL + Upstash; internal needs ARC + `INTERNAL_SERVICE_SECRET`). Capture each
   Worker's required set in its own boot-gate (mirror the existing fail-closed
   `assertCorsOriginsConfigured` / missing-secret throws) so a misconfigured
   split fails loudly. Expect this to be the fiddliest part — three
   `wrangler.toml`s, three secret sets, three CI deploy jobs.
6. **Rate-limit stores.** The native `RL_AUTH_IP_*` bindings and Upstash
   namespaces move to osn-identity (auth limiters) and osn-social (graph/org/rec
   limiters) respectively. Keep namespace IDs **distinct per Worker** (also
   closes S-L7 / the namespace-reuse finding).
7. **Routing.** Custom domains: `id.cireweddings.com` → osn-identity;
   social/internal either on path prefixes behind the same hostname (via a thin
   router Worker or Cloudflare routes) or their own subdomains. Simplest first
   cut: keep `id.` for identity, add `graph.`/internal-as-service-binding.

## Suggested sequencing

1. Land the [[auth-service-refactor]] first (clean module boundaries).
2. Extract **osn-internal** first — smallest, no browser surface, ARC-only, so
   the lowest-risk extraction and it proves the shared-D1 + service-binding
   pattern.
3. Extract **osn-social** next (stateless verifier, no session/cookie state).
4. **osn-identity** is what remains — the highest-blast-radius Worker changes
   least (it keeps the JWT keys, sessions, JWKS), so leaving it in place as the
   "core" minimizes risk.
5. Add per-Worker CI deploy jobs + boot-gates; wire osn-api's own manual-deploy
   gap (finding S-M/M-E) at the same time.

## Cost / free-tier note

Three Workers vs one multiplies request count against the shared 100k/day free
cap ([[free-tier-limits]]). A split makes the shared-cap blast radius *worse*,
not better, until the Workers Paid ($5) tier is on — pre-commit to that trigger
before splitting, not mid-incident.
