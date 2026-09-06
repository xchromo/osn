---
"@cire/invites": patch
---

Cut the guest site's server bundle further, from 285 KB to 163 KB gzip, and re-baseline the size guard.

Trackers #618, #616, #617: three follow-ups from the original SSR bundle-size
audit (tracker #287).

Astro sessions are unused (`Astro.session` is never read or written), so
`astro.config.mjs` now sets `session: false` instead of pinning an in-memory
driver. Astro's session config accepts `false` as a literal, and the
Cloudflare adapter's KV-binding auto-provisioning is gated on that same
literal, so this drops the session runtime and `unstorage` from `dist/server`
without introducing a `SESSION` KV binding (#618).

The SSR build was unminified — Astro's Vite build config hard-sets
`minify: false` for the server build after spreading the user's own `vite.build`,
so the usual `vite: { build: { minify: true } }` config is a no-op there. A
small inline Astro integration hooks `astro:build:setup`, which runs after that
config is built and whose `updateConfig` wins, to force `minify: true` for the
server and prerender builds only — the client build is unaffected (#616).
Because minified output loses source line numbers on a production exception,
this ships with `build.sourcemap: true` and `upload_source_maps: true` in
`wrangler.jsonc`, so Cloudflare can symbolicate a crash back to a real source
line. `.map` files are excluded from the size guard — they're uploaded for
symbolication, not part of what the Worker runs.

`zod` was traced (#617): it comes from Astro's own actions request handler
(`actions/handler.js` → `actions/runtime/server.js`, which imports
`zod/v4/core`), invoked on every non-prerendered request regardless of whether
the app defines any actions. This app doesn't, but there's no app-level
config to skip that code path, so `zod` stays — it's a real Astro core
dependency, not dead weight, and it is not stubbed the way `motion` was.

`cire/invites/scripts/guard-ssr-size.sh`'s threshold moves from 310000 to
211103 (the new measured total plus the same motion-class headroom used
before), and its `find` now also excludes `*.map` files from the measurement.
