---
"@cire/invites": patch
---

Stop shipping the `motion` animation library in the guest site's server bundle.

Tracker #287: `dist/server` (the SSR Cloudflare Worker) grew from 289 KB to
428 KB gzip because three `.motion.ts` modules — `Modal.motion.ts`, and each
design pack's `UnlockReveal.motion.ts` — only ever call `motion` from a
client-side `onMount` prefetch hint or a DOM event handler, but Vite's SSR
build still walks and bundles every module reachable via `import()`. The
whole library shipped server-side with nothing there ever calling it.

Added a Vite plugin (`astro.config.mjs`) that stubs the `motion` specifier
out of the SSR module graph only — the client build is untouched, so both
design packs still animate exactly as before. `dist/server` is down to
423 KB gzip. Also added a CI step that measures this total on every deploy
and fails the build if it grows past a set threshold, so a regression like
this one gets caught immediately instead of surfacing in a size audit months
later.
