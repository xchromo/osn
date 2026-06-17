---
"@cire/api": minor
"@cire/web": minor
---

Serve responsive, optimised invite images via the Cloudflare Workers Images
binding, transformed on the fly from the R2 originals.

`GET /api/invite/:slug/image/:slot` now resolves a bounded, allowlisted variant
from `?variant=` (`thumb`/`card`/`hero` → 320/800/1600px; missing/unknown
collapses to `card`) and negotiates a modern output format from the request
`Accept` header (AVIF → WebP → JPEG). The original R2 bytes are streamed through
`env.IMAGES.input(...).transform({ width }).output({ format })` and served with
`Vary: Accept` plus the existing immutable long-max-age cache headers.

Worker Cache API short-circuit: because the Images binding bills per call with
no per-unique dedupe, the serve route now checks `caches.default` before
invoking `env.IMAGES`. The cache key is a canonical GET `Request` keyed on
slug + slot + resolved variant + negotiated output format (+ the existing `?v=`
content version) — the format is baked into the key because it is `Accept`-
negotiated and therefore absent from the request URL, so AVIF/WebP/JPEG are
cached as separate entries and a WebP-only client can never be served an AVIF.
A hit serves the transformed bytes without touching the binding (or the DB); a
miss runs the transform and writes the result back to the cache via
`ctx.waitUntil` (bridged into the Elysia handler per-request, since Elysia's
`fetch` does not forward the Workers execution context), falling back to an
inline `await` when no execution context is bound. When `caches` is undefined
(unit tests / non-Workers runtimes) the route still serves correctly, just
without caching. Cache hits are observable on the bounded `cire.image.transform`
counter via the new `result: cache_hit` value.

Graceful fallback is the core behaviour: when the `IMAGES` binding is absent
(local `wrangler dev` / miniflare / unit tests, or an account without the Images
product) **or** a transform fails, the route serves the raw R2 original — the
pre-existing behaviour — and never 500s on a transform miss. The fallback is
logged (`Effect.logWarning`) and recorded on a bounded `cire.image.transform`
counter (`result: cache_hit | transformed | original`, plus the `variant` +
`format` literal unions — no slug or per-wedding value). The transform is traced
with `Effect.withSpan("cire.invite_assets.transform")`.

The guest site (`cire/web`) emits a responsive `srcset`/`sizes` against the
variant widths for the hero + story images (with the hero `<link rel=preload>`
upgraded to `imagesrcset`/`imagesizes`), keeping a plain `src` as a progressive
fallback.

Deploy note: the Cloudflare **Images** product must be enabled on the account
before deploy (transformations are billed per unique transformation). The
`[images]` binding is declared at top-level **and** mirrored under
`[env.production]` (named environments do not inherit top-level bindings).
