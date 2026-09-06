#!/usr/bin/env bash
# Guard the size of an Astro app's deployed bundle.
#
# Tracker #287: cire/invites' SSR Worker bundle reached 470 KB gzip unnoticed,
# from two separate mistakes. Three `.motion.ts` modules dragged the whole
# `motion` library into the SSR module graph though nothing there ever ran it
# (fixed by stubbing `motion` out of the SSR build only, see
# cire/invites/astro.config.mjs); and three drift-guard tests sat un-prefixed
# under `src/pages`, so Astro routed them, deployed them, and pulled 119 KB
# gzip of vitest along with them (fixed by the `_` prefix Astro's router
# excludes). This guard measures the same total again on every build and
# fails the moment it grows past a set point, rather than the growth being
# found from a tracker issue months later.
#
# Tracker #619 generalised it: cire/invites is the only `output: "server"`
# Astro app in the repo (it emits `dist/server`, a Worker, plus `dist/client`,
# its Static Assets). `cire/host`, `cire/landing`, `cire/vendor`, `osn/landing`
# and `pulse/landing` are all `output: "static"` — no Worker, no `dist/server`,
# no `dist/client` split; they deploy `dist` wholesale to Cloudflare Pages. The
# two shapes need different measurements, so this script takes a MODE rather
# than trying to force one glob to fit both:
#
#   worker  — cire/invites. Measures `dist/server`, and separately refuses any
#             `*.map` under the sibling `dist/client`.
#   static  — the other five. Measures `dist/_astro/*.js` and
#             `dist/_astro/*.css` only.
#
# Usage: guard-bundle-size.sh <package-dir> <worker|static> <threshold>
#
# <package-dir> is resolved and `cd`'d into, so it can be a relative path from
# wherever the caller runs (a workflow step's `working-directory`, or `.` from
# inside the package's own `build` script) or an absolute one. Messages label
# themselves from the last two path segments of the RESOLVED directory (e.g.
# "cire/host"), not from whatever string the caller happened to pass — so `.`
# and `../../cire/host` both produce the same label.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "::error::usage: guard-bundle-size.sh <package-dir> <worker|static> <threshold>" >&2
  exit 1
fi

pkg_dir="$(cd "$1" && pwd)"
mode="$2"
threshold="$3"
label="$(basename "$(dirname "$pkg_dir")")/$(basename "$pkg_dir")"
cd "$pkg_dir"

case "$mode" in
  worker) measure_dir="dist/server" ;;
  static) measure_dir="dist/_astro" ;;
  *)
    echo "::error::guard-bundle-size.sh: unknown mode '${mode}' — expected 'worker' or 'static'." >&2
    exit 1
    ;;
esac

if [ ! -d "$measure_dir" ]; then
  echo "::error::${label} ${measure_dir} is missing — run \`astro build\` before this guard."
  exit 1
fi

# Source maps belong in `dist/server` and NOWHERE ELSE, and only the worker
# shape has a `dist/client` to check. `dist/client` is that Worker's Static
# Assets directory (the adapter writes `"assets": { "directory": "../client" }`
# into the generated wrangler config) and Cloudflare serves every file there
# verbatim, so a `.map` that lands in it publishes the guest site's unminified
# source at `/_astro/<chunk>.js.map` to anyone who asks. That is exactly what a
# plain `vite: { build: { sourcemap: true } }` does, because the client
# environment reads the top-level value at
# `astro/dist/core/build/vite-build-config.js:135` — which is why
# `cire/invites/astro.config.mjs` sets `sourcemap` inside the `astro:build:setup`
# hook instead. This check is the tripwire for that mistake coming back. The
# static apps have no `dist/client` at all — their whole `dist` IS the public
# asset tree — so the check is scoped to `worker` mode rather than trying to
# run it (harmlessly, but pointlessly) everywhere.
if [ "$mode" = "worker" ] && [ -d dist/client ]; then
  client_maps=$(find dist/client -type f -name '*.map' | wc -l | tr -d ' ')
  if [ "$client_maps" -ne 0 ]; then
    echo "::error::${label} dist/client holds ${client_maps} source map(s). dist/client is served publicly as Static Assets, so these would publish the guest site's unminified source. Scope \`sourcemap\` to the server build (see the minifySsrBuild() comment in cire/invites/astro.config.mjs)."
    exit 1
  fi
fi

total=0
count=0
if [ "$mode" = "worker" ]; then
  # `no_bundle: true` (the adapter's generated config) means `wrangler deploy`
  # ships every file in `dist/server` as its own module rather than
  # concatenating them, so the sum of each file's OWN gzip size is what
  # crosses the wire — not the gzip of the directory as a whole. Everything
  # except `wrangler.json` is uploaded, so measure exactly that set: matching
  # on `*.mjs` would coincide with it today and stop matching the moment the
  # adapter emitted a `.js` chunk, which its own generated `rules` already
  # declare as an ES module. `.map` files are excluded too: they're uploaded
  # to Cloudflare for symbolication (`upload_source_maps` in `wrangler.jsonc`),
  # not part of the script the Worker runs, and roughly double the reading if
  # left in.
  while IFS= read -r -d '' f; do
    # `-n` keeps the source filename out of the gzip header. Without it the
    # measured total shifts by tens of bytes whenever a chunk is renamed or
    # its content hash changes, so the same build measures differently for no
    # reason.
    size=$(gzip -nc "$f" | wc -c)
    total=$((total + size))
    count=$((count + 1))
  done < <(find "$measure_dir" -type f ! -name 'wrangler.json' ! -name '*.map' -print0)
else
  # The static apps have no Worker bundle to measure — `astro build` writes
  # font binaries fetched from Google (hashed names, `dist/_astro/fonts/`) and
  # one HTML file per page into `dist`, and neither belongs in this guard:
  # font bytes move whenever Google's metadata moves, with no repo change, and
  # `dist` grows with ordinary page content regardless of what the JS/CSS
  # ships. `dist/_astro/*.js` and `dist/_astro/*.css` are exactly the part
  # that regresses when a library wanders in, which is what this guard is
  # for — so this is an ALLOWLIST, not an exclusion, and deliberately does not
  # recurse into `dist/_astro/fonts/`.
  while IFS= read -r -d '' f; do
    size=$(gzip -nc "$f" | wc -c)
    total=$((total + size))
    count=$((count + 1))
  done < <(find "$measure_dir" -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) -print0)
fi

if [ "$count" -eq 0 ]; then
  echo "::error::${label} ${measure_dir} holds no deployable files — the guard measured nothing, which is a broken build, not a pass."
  exit 1
fi

echo "${label} ${measure_dir} gzip total: ${total} bytes across ${count} files"

# Threshold = the measured total plus headroom for ordinary dependency
# growth, sized per app (see each app's build script / workflow step for the
# actual number and the reading it was set from).
#
# The headroom is deliberately SMALLER than the mistake this guard exists to
# catch. `motion` costs 21261 bytes gzip in cire/invites' MINIFIED SSR build —
# measured, not assumed: that is the size of its own already-minified client
# vendor chunk (`dist/client/_astro/animate.*.js`), and rebuilding with
# `stubMotionForSsr()` removed moves that app's server total by the same
# ~21.4 KB. A threshold of "measured plus one whole library" can never trip on
# one library, which is exactly backwards — cire/invites' own history is the
# cautionary tale: its old threshold budgeted 47657 bytes, motion's cost back
# when that build was UNMINIFIED, so a fresh library of exactly that class
# would have landed under the line and shipped silently.
#
# Re-baselining after an intentional change: take the new reading, add
# headroom well under a library of motion's class, and re-check the gap is
# still comfortably positive. This does NOT catch a few hundred bytes of
# ordinary bump, and for the static apps it is nowhere near Cloudflare Pages'
# limits — it watches the trajectory, it is not a check against a hard cap.
if [ "$total" -gt "$threshold" ]; then
  echo "::error::${label} ${measure_dir} gzip total ${total} bytes exceeds the ${threshold} byte guard (tracker #287, #619). Something is likely pulling a new dependency into the bundle that does not need to ship — check what is newly reachable from an import that runs in this build, the way motion was for cire/invites."
  exit 1
fi
