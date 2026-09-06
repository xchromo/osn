---
title: Astro bundle-size guards
description: scripts/guard-bundle-size.sh — measuring and gating each Astro app's deployed bundle, and the src/pages test-route check beside it
tags: [convention, build, astro, performance]
related:
  - "[[cire-development]]"
  - "[[frontend-patterns]]"
  - "[[testing-patterns]]"
  - "[[review-findings]]"
last-reviewed: 2026-09-06
---

# Astro bundle-size guards

Tracker #287 found cire/invites' SSR Worker bundle at 470 KB gzip, unnoticed,
from two mistakes: a whole animation library reachable from the server module
graph though nothing there ran it, and drift-guard tests routed as live pages
because they sat un-prefixed under `src/pages`. Tracker #619 generalised the
fix cire/invites got: both mistakes can happen in any of the repo's six Astro
apps, and both are now checked on every one of them.

Two separate scripts, because the two mistakes are different shapes.

## `scripts/guard-bundle-size.sh` — the size guard

```
scripts/guard-bundle-size.sh <package-dir> <worker|static> <threshold>
```

`<package-dir>` is `cd`'d into and also supplies the label in its messages (the
last two path segments of the *resolved* directory — `.` and `cire/host` both
label themselves "cire/host"). The full reasoning for the two modes, the
exclusion vs. allowlist logic, and the threshold arithmetic lives in the
script's own comment — read that before touching a threshold. In short:

- **`worker`** — cire/invites, the only `output: "server"` app. Measures
  `dist/server` (every file except the adapter's generated `wrangler.json` and
  `*.map`, since `no_bundle: true` ships each chunk as its own module) and
  separately refuses any `*.map` under the sibling `dist/client`, which is
  served publicly as Static Assets. See [[cire-development]] for why
  cire/invites' bundle is shaped the way it is (sessions off, SSR-only
  minification, server-only source maps, why `zod` stays).
- **`static`** — `cire/host`, `cire/landing`, `cire/vendor`, `osn/landing`,
  `pulse/landing`. All five are `output: "static"`: no Worker, no `dist/server`,
  no `dist/client` split — they deploy `dist` wholesale to Cloudflare Pages.
  Measures `dist/_astro/*.js` and `dist/_astro/*.css` **only** — an allowlist,
  not a directory sum, because `dist/_astro/fonts/` holds Google Fonts binaries
  fetched at build time (hashed names, moves whenever Google's metadata moves,
  not a repo change) and `dist` holds one HTML file per page (grows with
  ordinary content). Neither belongs in a guard whose job is catching a library
  that shouldn't have shipped.

### Where it runs, and why twice

Every app's own `build` script chains the guard on with `&&` (`astro build &&
… guard-bundle-size.sh . <mode> <threshold>`) — that is what runs it on a local
build and the by-hand cire/invites deploy. It ALSO runs as its own step in
`ci.yml`'s `build-test` job and in both `deploy.yml` jobs (dev and production)
that build a guarded app. That is not a redundant belt-and-suspenders: a
Turborepo cache replay of `build` replays its logged output without executing
the script, so the chained invocation never runs on a cache hit — the explicit
workflow step is what still checks the artifact that IS on disk in that case.
Both invocations matter; neither one alone covers both paths.

`osn/landing` and `pulse/landing` also deploy from
`.github/workflows/deploy-osn-pulse-landing.yml` (a feature-branch preview,
`bun run --cwd <dir> build`) — that already runs each app's own chained `build`
script, so the guard applies there too with no separate step needed.

### Per-app thresholds (2026-09-06 baseline)

Built once, from a clean `bun run build` at the worktree root with no
`PUBLIC_*` vars set (CI's own build has none either; the deploy jobs inline
real URLs and sitekeys, and the headroom absorbs the difference). Headroom is
fixed at the same **~11.7 KB** cire/invites' own guard uses, deliberately
smaller than a motion-class dependency (21261 bytes gzip, minified — see the
script comment) so a mistake of that class always trips the guard regardless
of how large or small the app's own baseline is:

| App | Mode | Measured | Threshold |
|---|---|---:|---:|
| cire/invites | worker | 163332 B | 175000 B *(pre-existing, tracker #287/#616)* |
| cire/host | static | 212832 B | 224515 B |
| cire/vendor | static | 69961 B | 81644 B |
| cire/landing | static | 177641 B | 189324 B |
| osn/landing | static | 15182 B | 26865 B |
| pulse/landing | static | 16683 B | 28366 B |

`cire/landing` ships a Three.js scene by design (the wax-seal hero) — its
JS number is dominated by one intentional dependency, which is exactly why
each app gets its own baseline rather than a shared number.

**Re-baselining** after an intentional change: build (clean, alone — two builds
running at once in one checkout interleave their chunks and the guard then
reads a number that is not real), read the printed total, and set `threshold`
to that total plus ~11.7 KB. Update the number in three places: the app's own
`package.json` `build` script, its step in `ci.yml`, and its step(s) in
`deploy.yml`.

## `scripts/check-astro-test-routes.ts` — the `src/pages` check

Astro routes every file under `src/pages` into a live page, except one whose
name — or an ancestor directory's name, anywhere between `src/pages` and the
file — starts with `_`. A `*.test.ts`/`*.spec.ts` left un-prefixed there is
therefore built and deployed as a real route, which is exactly how
cire/invites picked up 119 KB gzip of vitest. This check walks all six apps'
`src/pages` looking for that shape.

It needs no build and no per-app baseline — a plain directory walk — so it runs
in the fast `lint` job in `ci.yml`, not `build-test`.

## Related

- [[cire-development]] — cire/invites' own bundle history (#618 sessions off,
  #616 SSR minification, #617 why `zod` stays)
- [[frontend-patterns]] — general Astro/Solid patterns
- [[review-findings]] — P-I8 (tracker #619) is where this convention traces
  back to
