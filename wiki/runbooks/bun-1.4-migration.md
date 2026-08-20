---
title: Bun 1.4 migration
description: Plan for moving the monorepo to Bun 1.4 and adopting the parts that pay for themselves — $ shell, catalogs, Bun.TOML, Bun.Image, supply-chain gates.
tags: [runbook, bun, tooling, migration, ci]
severity: low
status: planned
related:
  - "[[monorepo-structure]]"
  - "[[dev-environment]]"
  - "[[commands]]"
last-reviewed: 2026-08-21
---

# Bun 1.4 migration

Plan for moving the monorepo to Bun 1.4 and picking up the parts of it that pay
for themselves. Release notes: <https://bun.com/blog/bun-v1.4>.

## The constraint that shapes everything

Every deployed package here runs on **workerd**, not Bun:

| Runtime | Packages |
| --- | --- |
| workerd (Workers) | `osn/api`, `pulse/api`, `zap/api`, `cire/api`, `cire/invites` |
| Pages / static build | `*/landing`, `pulse/web`, `cire/host`, `osn/social`, `cire/vendor` |
| Bun | scripts, seeds, `bun test` suites, CI, local dev |

So none of Bun 1.4's headline runtime APIs — `Bun.serve` static routes, HTTP/3,
`Bun.Image` at request time, `Bun.cron` — can ship in app code. Cloudflare
already provides the equivalents (Images binding, Cron Triggers, its own
server). Bun is our package manager, script runtime, test runner for three
packages, and CI driver. **That is the whole adoption surface.** Anything
proposed outside it is wrong by construction.

Two things follow. First, the wins are real but they are tooling wins: faster
installs, fewer bespoke shell scripts, real parsers instead of greps. Second,
nobody has to weigh a runtime risk against a production incident — the blast
radius of every item below stops at the developer's machine or the CI runner.

---

## Phase 0 — get on 1.4 (blocks everything else)

The repo is on two different Bun versions today:

- `.bun-version` → `1.3.10` (what CI installs, via `bun-version-file`)
- `package.json` `packageManager` → `bun@1.3.14`
- `bun-types` → `^1.3.14`

Fix all three to the same `1.4.x` in one commit. The mismatch is its own small
bug: CI has been resolving a different Bun than the one the lockfile records.

**Then run the whole gate**, because 1.4 changed things underneath us:

```bash
bun install
bun run lint && bun run fmt:check && bun run check
bun run test && bun run test:d1 && bun run test:browser
bash scripts/cire-dev-db-guard.test.sh
```

What to watch for, in rough order of likelihood:

- **`node:zlib` now uses zlib-ng.** `cire/db/seed/assets.ts` calls
  `deflateSync(raw, { level: 9 })` and the seed's docstring promises re-running
  "overwrites them byte-for-byte". zlib-ng can emit a different byte stream at
  the same compression level. The images still decode; the promise of
  determinism may not survive. Phase 3 deletes this code anyway.
- **`trustedDependencies` is npm-only now** — no auto-trust for `file:`,
  `git:`, or `github:` sources. Check `bun.lock` for non-npm deps whose
  postinstall we rely on.
- **Sourcemaps off by default in production HTML routes.** We don't use
  `Bun.serve` HTML routes, so this should be inert. Confirm rather than assume.
- Idle CPU, memory and startup all improved; nothing to do but enjoy it.

Ship this alone, green, before touching anything below.

---

## Phase 1 — `Bun.$` for everything that shells out

This is the largest single cleanup and the one with the clearest payoff:
13 shell scripts (1007 lines, of which 393 are bespoke `.test.sh` harnesses)
plus two hand-rolled `Bun.spawn` wrappers.

### 1a. Replace the two `Bun.spawn` sites

`scripts/todo-to-issues/backfill-project.ts:25` hand-rolls exactly what `$`
does — spawn, pipe, drain both streams, check the exit code, throw with stderr:

```ts
// today: 8 lines
export const gh: Run = async (args) => {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([...]);
  if (code !== 0) throw new Error(`gh ${args[0]} failed (${code}): ${err.trim()}`);
  return out;
};

// with $: one line, same throw-on-nonzero semantics
export const gh: Run = (args) => $`gh ${args}`.text();
```

Keep the exported `Run` type — the tests inject a fake `gh`, and that stays
true. `$` throws a `ShellError` carrying `exitCode`, `stdout` and `stderr`, so
the error message is at least as good as the current one.

`cire/db/seed/assets.ts:186` spawns `bunx wrangler r2 object put` with a `cwd`
and inherited stdio. That becomes `$\`bunx wrangler r2 object put ...\`.cwd(dir)`.

### 1b. Convert the scripts that carry logic

Convert, worth it:

| Script | Lines (+test) | Why |
| --- | --- | --- |
| `validate-changesets.sh` | 122 + 102 | Real parsing; its test harness becomes `bun test` |
| `changeset-required.sh` | 68 + 88 | Same |
| `cire-dev-db-guard.sh` | 120 + 203 | The guard that stands between an unattended reset and the live-wedding D1. Its failure mode is *passing*. Deserves the strongest test tier we have |
| `check-d1-database-id.sh` | 60 | Three greps that approximate a TOML parse. See Phase 3 |
| `cire-db-reset.sh`, `cire-db-seed.sh`, `db-reset.sh`, `ensure-pages-project.sh` | 34–75 | Straight command sequences; `$` is shorter and the errors are typed |

Leave as bash:

- `scripts/setup.sh` — bootstrap. It runs on a machine that may have nothing.
- `scripts/pre-push-typecheck.sh` — it exists *because* a fresh `git worktree
  add` has no `node_modules`. A `$` script would in fact still run (Bun needs no
  `node_modules` to execute one), so this is a judgement call, not a hard
  blocker. Convert it last, or not at all.

Three of those scripts have `.test.sh` twins totalling 393 lines of hand-written
bash assertion. Converting the scripts folds those into `bun test`, which
deletes the `shell-tests` CI job entirely once `cire-dev-db-guard` moves.

### 1c. House rules for `$`

Write them into `wiki/conventions/commands.md` at the same time:

- Interpolate **values**, never command fragments: `` $`gh issue list --repo ${repo}` ``.
  `$` escapes interpolated values; a spliced-in string of flags defeats that.
- `.text()`, `.json()`, `.lines()`, `.blob()` for output; `.quiet()` to stop
  the echo; `.cwd()` / `.env()` for context.
- Non-zero exit is a **throw** by default. Use `.nothrow()` then read
  `.exitCode` when a failure is an expected branch (the guard scripts need
  this — `grep` returning 1 means "no match", not "broken").
- Keep `set -euo pipefail` semantics in mind: `$` is throw-by-default, which
  matches, but a pipeline's middle command is not checked. Split pipes.

---

## Phase 2 — supply-chain and lockfile gates

The repo already has a considered posture here: `minimumReleaseAge = 259200` in
`bunfig.toml`, plus `bun audit --audit-level=high` on pre-push. 1.4 adds three
gates that fit the same shape.

**`bun dedupe --check` as a CI job.** The root `package.json` carries 18
`overrides`, several of them ("clear the advisory") pins that upstream has since
absorbed. `bun dedupe` collapses duplicate versions; `--check` fails when
duplicates reappear. Run `bun dedupe` once by hand first — the diff tells you
which of the 18 overrides are now redundant, which is a separate small PR.

**`bun pm licenses --prod --json` as a compliance gate.** We have
`wiki/compliance/` and no automated check that a dependency's licence is one we
accept. A short allowlist script over that JSON closes it.

**`bun audit fix --dry-run` in the advisory loop.** Today an advisory means
hand-writing an entry in `overrides` and a comment explaining the drop-trigger.
`audit fix` proposes the upgrade set; `--dry-run` shows it without applying.
Use it to *generate* the override, keep writing the comment by hand.

**Catalogs — the structural one.** Thirty-three packages repeat versions of
`typescript`, `vitest`, `effect`, `hono`, `drizzle-orm` and friends, and drift
between them is a recurring source of confusing failures. 1.4's
`bun add <pkg> --catalog` plus `"catalog:"` in each workspace makes the root the
single place a shared version is written. Do this as its own PR after Phase 0;
it touches every `package.json` and wants a clean diff.

**`linker = "isolated"` (global virtual store).** Claimed 7x faster warm CI
installs by symlinking instead of copying. Genuinely attractive given five CI
jobs each run `bun install`. But isolated linking breaks packages that quietly
rely on hoisting, and we have three that are fussy about resolution: vitest's
browser provider, playwright, and astro. **Trial on one CI job behind a branch,
not repo-wide.** If it holds, roll it out; if not, drop it and lose nothing.

---

## Phase 3 — new APIs that delete code we own

**`Bun.Image` replaces the hand-rolled PNG encoder.** `cire/db/seed/assets.ts`
contains a CRC32 table, IHDR/IDAT/IEND chunk framing, and filter-0 scanline
packing — roughly 80 lines of image-format code written because there was no
encoder to hand. `Bun.Image` encodes PNG (and WebP, which would make the seed
assets smaller). The generated-gradient logic stays; the encoder goes. This also
retires the zlib-ng determinism question from Phase 0.

**`Bun.TOML` replaces the wrangler-config greps.** `check-d1-database-id.sh`
runs three regexes against `cire/api/wrangler.toml` to catch a placeholder
`database_id`. Regex two and three exist only because regex one isn't a parser.
`Bun.TOML.parse()` gives the real thing: walk top-level `d1_databases` and every
`[env.*]` block, assert each `database_id` is a UUID. Shorter, and it catches
the case the greps miss — a *missing* binding rather than a placeholder one.
`Bun.JSONC.parse()` does the same for `cire/invites/wrangler.jsonc`.

**`Bun.WebView` for verification screenshots.** The current habit is headless
Chrome with `--virtual-time-budget` to screenshot a dev server or Pages preview.
`Bun.WebView` does `.navigate()` / `.screenshot()` / `.evaluate()` / `.cdp()`
against system WebKit or an installed Chrome, with no Puppeteer dependency. Not
a replacement for the vitest browser tier — that needs a real provider — but it
is a direct replacement for the ad-hoc screenshot command.

**`--no-orphans` for the dev loop.** There are committed `.env` files and
per-worktree dev stacks (see `wiki/runbooks/dev-environment.md` and the portless
devloop work). Dev servers outliving a killed parent is a live annoyance;
`--no-orphans` makes Bun SIGKILL descendants when the parent dies.

**`--no-env-file` / `env = false` for CI.** `osn/api`, `cire/api`, `cire/db` and
`pulse/api` all have committed `.env` files. Bun loads them automatically, which
means a test that reads an env var can pass locally off a `.env` and fail in
CI — or worse, pass in CI off a `.env` that shouldn't be there. Setting
`env = false` for CI runs forces every CI environment variable to be declared in
the workflow. This is a correctness gate, not a convenience.

---

## Phase 4 — test runner (limited, be honest about it)

Only three packages use `bun test`: `cire/theme`, `cire/db`, `cire/api`. The
other thirty run vitest. So 1.4's test features apply to those three, the
two `d1-integration.test.ts` files, and `scripts/todo-to-issues/`.

Worth doing there:

- **`jest.useFakeTimers()` / `setSystemTime()`** — `cire/api` is full of
  time-dependent behaviour (token expiry, the refresh-rotation grace window,
  rate-limit windows, the 04:00 cron sweep). Anywhere a test currently injects a
  clock or sleeps, fake timers are cleaner and faster. Grep for `Date.now` seams
  first; adopt where a seam already exists rather than inventing new ones.
- **`test({ retry: n })`** — only for tests whose flakiness is understood and
  documented. Retry on an unexplained failure hides the bug. Default: don't.
- **`bun test --changed`** in the lefthook pre-push, beside the existing
  typecheck and audit. Cheap, and it catches the "typechecks but broke a test"
  push.
- **`--isolate`** if `cire/api` ever shows cross-file leakage. Not before.

Explicitly not now:

- `--shard` / `--timings` — these balance CI across machines, and our CI is not
  bun-test-bound. Revisit only if we migrate off vitest.
- `bun run --parallel` — turbo already schedules across the workspace. Adding a
  second scheduler would fight the first.

---

## Phase 5 — profiling, when something is slow

`--cpu-prof-md` and `--heap-prof-md` write a Markdown report rather than a
`.cpuprofile` you have to load into DevTools, which means a profile can go
straight into a PR description. Reach for them the next time a CI step is
slow — the `openapi:generate` step and `bun run build` are the current
candidates — rather than adopting them speculatively.

`BUN_CPU_PROFILE=1` does the same without touching the command line, which is
the easier thing to set on a CI step.

---

## Not adopting, and why

| Feature | Why not |
| --- | --- |
| `Bun.serve` static routes, HTTP/3 | Everything is served by Workers/Pages |
| `Bun.Image` at request time | `cire/api` uses the Cloudflare Images binding against R2; that's the right layer |
| `Bun.cron` | Prod schedules are Workers Cron Triggers (`osn/api` 6-hourly, `cire/api` 04:00) |
| `--react-compiler`, `Bun.markdown.react()` | No React dependency in the repo |
| `--compile`, `--asset`, bytecode | We ship Workers bundles, not binaries |
| `Bun.Archive`, `Bun.Terminal`, ANSI helpers | No use for them |
| `CompressionStream` / `DecompressionStream` | Web standard; workerd already has it |
| `bun prune --production` | Deploy bundling is wrangler's job |

---

## Order and sizing

1. **Phase 0** — version alignment + full gate. Small, blocking, ship alone.
2. **Phase 1a** — the two `Bun.spawn` sites. Tiny.
3. **Phase 3** — `Bun.Image` in the seed, `Bun.TOML` in the D1 guard. Two small
   PRs that each delete more than they add.
4. **Phase 2 catalogs** — one wide, mechanical PR.
5. **Phase 1b** — script conversions, one or two at a time, guard script last
   and most carefully.
6. **Phase 2 gates** — dedupe, licences, `env = false`.
7. **Phase 4** — fake timers where a clock seam already exists.
8. **Phase 5** — only when something is slow.

Phases 1b and 2-catalogs both touch many files; don't run them concurrently.
