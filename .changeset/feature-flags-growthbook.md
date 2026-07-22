---
"@shared/feature-flags": minor
"@cire/api": patch
---

Add GrowthBook feature flags (key-optional, fail-safe) + wire into `@cire/api`.

New `@shared/feature-flags` package: GrowthBook evaluation for the Workers
backends. Flags evaluate offline at the edge (`initSync` on a pre-fetched
payload — no Node APIs, no per-request network). The only network is a cached
fetch of the SDK payload, and it fails safe.

Design mirrors `@shared/turnstile`:

- **Key-optional.** No `GROWTHBOOK_CLIENT_KEY` ⇒ every flag reads its coded
  default from the `FLAGS` registry with zero network, so this ships and deploys
  safely *before* a GrowthBook account exists — behaviour is unchanged until the
  key is set.
- **Fail-safe ladder.** Fresh CDN fetch → last-good cached payload → registry
  default. A flag read never throws and never blocks a request on GrowthBook.
- **Two-layer cache.** Per-isolate memo + optional shared KV namespace
  (`KV_GB_PAYLOAD`); TTL 60s. KV is a pure optimisation — absent ⇒ per-isolate
  in-memory cache.
- **Typed registry.** `FLAGS` is the single source of truth for flag keys +
  fail-safe defaults; callers reference flags by a typed key (typo ⇒ compile
  error).

`@cire/api`: the provider is built once per isolate from
`GROWTHBOOK_CLIENT_KEY` / `GROWTHBOOK_API_HOST` / optional `KV_GB_PAYLOAD`, and
decorated onto the Elysia context as `flags`. Routes read a flag with
`await flags.forRequest({ id }).then(f => f.isOn("cire.some-flag"))`. No route
gates on a flag yet — this is the plumbing; the only registered flag
(`cire.example-banner`) is a placeholder. `wrangler.toml` carries the
`GROWTHBOOK_API_HOST` var and commented `GROWTHBOOK_CLIENT_KEY` + `KV_GB_PAYLOAD`
setup (top-level + `env.production`). Inert until the client key is set — see the
package README for the GrowthBook Cloud setup checklist.
