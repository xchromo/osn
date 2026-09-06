#!/usr/bin/env bash
# Guard the size of the cire/invites SSR Worker bundle.
#
# Tracker #287: this Worker's SSR bundle reached 470 KB gzip unnoticed, from two
# separate mistakes. Three `.motion.ts` modules dragged the whole `motion`
# library into the SSR module graph though nothing there ever ran it (fixed by
# stubbing `motion` out of the SSR build only, see `astro.config.mjs`); and
# three drift-guard tests sat un-prefixed under `src/pages`, so Astro routed
# them, deployed them, and pulled 119 KB gzip of vitest along with them (fixed
# by the `_` prefix Astro's router excludes). This guard measures the same total
# again on every build and fails the moment it grows past a set point, rather
# than the growth being found from a tracker issue months later.
#
# Run from anywhere; it resolves the package directory from its own location.
# Requires an existing `dist/server`, so run it after `astro build`.
set -euo pipefail

pkg_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$pkg_dir"

# `no_bundle: true` (the adapter's generated config) means `wrangler deploy`
# ships every file in `dist/server` as its own module rather than concatenating
# them, so the sum of each file's OWN gzip size is what crosses the wire — not
# the gzip of the directory as a whole. Everything except `wrangler.json` is
# uploaded, so measure exactly that set: matching on `*.mjs` would coincide with
# it today and stop matching the moment the adapter emitted a `.js` chunk, which
# its own generated `rules` already declare as an ES module. `.map` files are
# excluded too: they're uploaded to Cloudflare for symbolication
# (`upload_source_maps` in `wrangler.jsonc`), not part of the script the
# Worker runs, and roughly double the reading if left in.
if [ ! -d dist/server ]; then
  echo "::error::cire/invites dist/server is missing — run \`astro build\` before this guard."
  exit 1
fi

total=0
count=0
while IFS= read -r -d '' f; do
  # `-n` keeps the source filename out of the gzip header. Without it the
  # measured total shifts by tens of bytes whenever a chunk is renamed or its
  # content hash changes, so the same build measures differently for no reason.
  size=$(gzip -nc "$f" | wc -c)
  total=$((total + size))
  count=$((count + 1))
done < <(find dist/server -type f ! -name 'wrangler.json' ! -name '*.map' -print0)

if [ "$count" -eq 0 ]; then
  echo "::error::cire/invites dist/server holds no deployable files — the guard measured nothing, which is a broken build, not a pass."
  exit 1
fi

echo "cire/invites dist/server gzip total: ${total} bytes across ${count} files"

# Threshold = the measured total after #287, #618, #616 and #617, plus room
# for ordinary dependency growth. What it catches is a library-scale mistake:
# motion cost 47657 bytes gzip in the (then-unminified) SSR bundle, so a
# single new library of that class entering the SSR graph still trips this
# with room to spare. 163446 (measured total, this bundle, after sessions off
# + SSR minify + source maps) + 47657 (motion-class headroom) = 211103.
#
# The SSR build is now minified (tracker #616 — an inline `astro:build:setup`
# integration in `astro.config.mjs`, since the plain `vite.build.minify` config
# form is a no-op for the SSR environment), so this no longer needs the old
# "server build isn't minified, client is" caveat: both builds are minified
# now, and a library costs roughly what it costs in `dist/client`, gzip for
# gzip. It does NOT catch a few KB of ordinary bump, and it is nowhere near
# the Workers Free-tier 3 MB cap — this watches the trajectory, it is not a
# check against the cap.
threshold=211103
if [ "$total" -gt "$threshold" ]; then
  echo "::error::cire/invites dist/server gzip total ${total} bytes exceeds the ${threshold} byte guard (tracker #287). Something is likely pulling a new dependency into the SSR module graph that never runs server-side — check what is newly reachable from a server-side import() or import, the way motion was."
  exit 1
fi
