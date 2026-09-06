---
title: Effect v4 migration
description: How the Effect 3.22 → 4.0 bump gets done here — driven by the official effect-v3-to-v4 skill and upstream's generated rename reference, with the measured local surface and the phase order.
tags: [runbook, effect, tooling, migration, dependencies]
severity: medium
status: in-progress
related:
  - "[[backend-patterns]]"
  - "[[schema-layers]]"
  - "[[testing-patterns]]"
  - "[[observability/overview]]"
  - "[[monorepo-structure]]"
last-reviewed: 2026-09-06
---

# Effect v4 migration

Effect is the functional core of every backend here — `@osn/api`, `@pulse/api`,
`@zap/api`, `@cire/api`, five `@shared/*` packages and four `*/db` packages.
361 files import it; 793 tests run through `it.effect`.

The migration is **driven by the official `effect-v3-to-v4` skill**, not by this
page. The skill and upstream's generated rename reference are the authority on
every API mapping. This page exists for what upstream cannot know: how much of
this repo each change touches, which of our own conventions the bump
invalidates, and the order the phases land in.

> [!important] Read the skill first, not this page's tables
> `.claude/skills/effect-v3-to-v4/SKILL.md` (installed from `Effect-TS/skills`)
> is the procedure. The tables below are a sizing estimate that was checked
> against upstream on 2026-09-06 — useful for planning, **not** a substitute for
> looking each symbol up as you reach it. Where they disagree, upstream wins.

## The official skills

Two skills are installed, from the `Effect-TS/skills` repository:

| Skill | What it is |
| --- | --- |
| `effect-ts` | Points the agent at `node_modules/effect/AGENTS.md` — the guidance the installed Effect version ships with, so it never drifts from the version in the tree |
| `effect-v3-to-v4` | The migration procedure. Not model-invoked; call it explicitly |

Installed with `npx skills add Effect-TS/skills`, which writes
`.agents/skills/<name>/`, symlinks `.claude/skills/<name>` at it, and records
the source and a content hash per skill in `skills-lock.json`. `npx skills
update` moves the pin. Both trees are under a human owner in
`.github/CODEOWNERS`.

### What the skill does

It refuses to guess. Every rename, removal and signature change is resolved
from **upstream's generated reference**, obtained by shallow-cloning the Effect
repo into `.repos/` (gitignored):

```sh
git clone --depth 1 --single-branch https://github.com/Effect-TS/effect .repos/effect
git clone --depth 1 --single-branch --branch v3 https://github.com/Effect-TS/effect .repos/effect-v3
```

- `.repos/effect/MIGRATION.md` — background and the index of topic guides.
- `.repos/effect/migration/v3-to-v4.md` — **the generated reference, ~16,600
  lines.** Never read whole; `rg` it one symbol at a time. Reading it in one
  pass costs ~350k tokens and takes the migration with it.
- `.repos/effect/migration/*.md` — fourteen topic guides for changes that are
  rewrites rather than renames. The ones this repo needs: `services.md`,
  `error-handling.md`, `schema.md`, `runtime.md`, `layer-memoization.md`,
  `scope.md`, `cause.md`, `forking.md`.
- v4 source under `.repos/effect/packages/*/src/`, to confirm a replacement's
  real signature before writing against it.

Lookup recipes, per the skill:

```sh
rg -n 'Effect\.catchAllDefect' .repos/effect/migration/v3-to-v4.md
rg -n -A 40 '^### `effect/Schema`' .repos/effect/migration/v3-to-v4.md
```

Its hard prohibitions, which hold for every phase here:

- **No `v3-compat.ts`.** A shim that re-exports old names makes the type errors
  vanish and freezes the codebase between versions permanently.
- **No `any`, no `as`** to silence a post-migration error. Such an error is
  usually evidence the replacement has a different shape, and a cast deletes
  that information.
- **No invented APIs.** Every replacement traces to the reference, a topic
  guide, or v4 source.

It also delegates per-file work to sub-agents, one file or module each, so the
main session keeps the error inventory rather than the file contents.

### Where we deliberately diverge from the skill

The skill's done condition is **a clean type-check**, and it says explicitly
that running the test suite is recommended but *not* a gate — sensible for a
generic repo mid-migration, where tests often cannot run for unrelated reasons.

**Here, tests and the dev tier are the gate.** That is the decision this
migration rests on: 793 `it.effect` tests plus two D1 tiers plus a full dev-tier
smoke are what stands between a wrong mapping and a live wedding. A type-check
alone does not catch a `Layer` whose finalizer stopped running or a log field
that quietly changed name — both of which are real risks below.

So: use the skill's procedure and its prohibitions verbatim, and treat its
done condition as the *floor*. Every phase in this page names test gates on
top, and phase 7 adds the dev-tier smoke.

## Versions and the ecosystem

As of 2026-09-06, npm `dist-tags` for `effect`: `latest` is `3.22.1`, `beta` is
`4.0.0-beta.107`, `rc` is `4.0.0-rc.112` (published 2026-08-25). Upstream's own
`MIGRATION.md` still opens with *"Effect v4 is currently in beta. APIs may
change between beta releases."*

That is a fact to plan around, not a blocker: the safety net is the test suite
and the dev tier, and the phase order below keeps every step verifiable. **Pin
an exact version rather than a range** while v4 is pre-GA, so a `bun install`
cannot move the target mid-migration.

The soak rule is satisfied either way — `bunfig.toml` sets `minimumReleaseAge
= 259200` (3 days) and rc.112 cleared that on 2026-08-28. **No
`minimumReleaseAgeExcludes` entry, and no `# DROP AFTER` marker, is needed or
wanted.**

| Package | Declared here | v4 | Note |
| --- | --- | --- | --- |
| `effect` | `^3.22.1` (13 packages) | yes | |
| `@effect/vitest` | `^0.30.0` (10 packages) | yes | Peer is `vitest >=4.1.0 <5.0.0`; every workspace already declares `^4.1.11` |
| `@effect/opentelemetry` | `^0.64.0` (`shared/observability`) | yes | Stays a separate package, but its modules were renamed — see below |
| `@effect/platform` | `^0.97.1` (`shared/observability`) | **merged into core** | Nothing here imports it. Delete the line |

v4 gives the whole ecosystem **one shared version number**, so `effect`,
`@effect/vitest` and `@effect/opentelemetry` must all sit on the same version.
`@effect/platform`, `@effect/rpc` and `@effect/cluster` merged into core; what
stays separate is platform-, provider- and technology-specific
(`@effect/platform-*`, `@effect/sql-*`, `@effect/ai-*`, `@effect/opentelemetry`,
`@effect/vitest`).

Some functionality now lives under `effect/unstable/*` (http, sql, rpc,
observability, …), which may break in minor releases. Nothing here imports any
of it today.

There is **no codemod**. `@effect/codemod` last published in July 2024 and
covers v2 → v3 only.

## What does not change

Most of the call surface. Verified present in v4: `Effect.gen` (1606 sites),
`Effect.provide` (972), `Effect.runPromise` (461), `Effect.tryPromise` (451),
`Effect.sync` (373), `Effect.fail` (346), `Effect.flip` (325), `Effect.promise`
(294), `Effect.withSpan` (248), `Effect.catchTag` (228), `Effect.provideService`
(182), `Effect.succeed` (142), `Effect.logError` (109), `Effect.tapError` (100),
`Effect.all`, `Effect.runPromiseExit`, `Effect.annotateLogs`,
`Effect.tapDefect`, `Effect.void`, `Effect.try`, `Layer.effect`/`succeed`/
`merge`/`provide`, `Option.*`, `Exit.*`, `it.effect`, `it.layer`.

**`Data.TaggedError` has no entry in the migration reference at all** — it is
unchanged. That is 165 sites and the repo's entire error vocabulary, needing
zero edits, and it is the single most load-bearing piece of good news here.

Two notes on style rather than breakage. v4's shipped `AGENTS.md` prefers
`Effect.fn("name")` over functions that return an `Effect.gen`, and uses
`Schema.TaggedError` in its examples where we use `Data.TaggedError`. Neither is
forced. **Do not fold either into this migration** — a style sweep across 165
error classes buried inside a version bump is unreviewable. File it separately
if it is wanted.

## What changes

Sizes are this repo's, measured at `851df71`. Mappings were checked against
`migration/v3-to-v4.md` on 2026-09-06.

### Renames

| v3 | v4 | Sites | Files |
| --- | --- | ---: | ---: |
| `Effect.catchAll` | `Effect.catch` | 42 | 24 |
| `Effect.catchAllDefect` | `Effect.catchDefect` | 94 | 20 |
| `Effect.catchAllCause` | `Effect.catchCause` | 1 | 1 |
| `Effect.either` | `Effect.result` | 71 | 13 |
| `Effect.forkDaemon` | `Effect.forkDetach` | 7 | 5 |
| `Effect.zipRight` | `Effect.andThen` | 7 | 3 |
| `Effect.dieMessage` | `Effect.die(new Error(…))` | 2 | 2 |
| `Layer.scoped` | `Layer.effect` — scoped acquisition merged in; it supplies and excludes the layer `Scope` | 6 | 4 |
| `Cause.failureOption` | `Cause.findErrorOption` | 4 | 4 |
| `Either` module | `Result` — `isLeft`→`isFailure`, `isRight`→`isSuccess`, `left`→`fail`, `right`→`succeed` | — | 4 |

`Effect.catchAll` → `Effect.catch` needs a word-boundary match, or it also
rewrites `catchAllDefect` and `catchAllCause`. Do those two first.

`Layer.scoped` sites are `shared/redis/src/service.ts`,
`shared/redis/src/ioredis.ts`, `cire/api/tests/services/import.test.ts`,
`cire/api/tests/db/test-layer.ts`. The two `shared/redis` ones manage a real
connection lifecycle, so the finalizer has to survive the rewrite — a
`Layer.effect` that drops the scope leaks Redis connections, and the limiters
fail closed ([[rate-limiting]]), so the symptom is rejected requests rather
than an obvious crash. A type-check will not catch this; the tests must.

### `Context.Tag` → `Context.Service`

13 declarations, 11 files. A structural change, not a symbol swap — read
`migration/services.md`. A v4 service key still extends `Effect`, so **every
`yield* DbService` call site is unaffected**; only the declarations change. That
makes this the highest-leverage phase: small, central, and it unblocks
type-checking for whole packages at once.

| File | Declaration |
| --- | --- |
| `osn/db/src/service.ts:27` | `Db` (`@osn/db/Db`) |
| `pulse/db/src/service.ts:18` | `Db` (`@pulse/db/Db`) |
| `zap/db/src/service.ts:16` | `Db` (`@zap/db/Db`) |
| `cire/api/src/db/index.ts:24` | `DbService` |
| `cire/api/src/services/invite-assets.ts:57` | `AssetsR2Service` |
| `cire/api/src/services/r2-imports.ts:32` | `R2Service` |
| `shared/redis/src/service.ts:21` | `Redis` |
| `shared/email/src/service.ts:45` | `EmailService` |
| `osn/client/src/service.ts:175` | `OsnAuth` |
| `osn/client/src/storage.ts:11` | `Storage` |
| `shared/db-utils/src/index.ts:77,113` | two `Context.Tag<any, …>` **parameter types** |

Do `shared/db-utils` first. Those two are type positions on generic helpers
imported by every service that touches a database, so a wrong signature there
produces errors everywhere and buries the real ones. `Context.Tag.Service<T>`
becomes `Context.Service.Shape<T>`; `Context.TagClass` becomes
`Context.ServiceClass`.

Preserve every identifier string exactly (`"@osn/db/Db"`,
`"@shared/email/EmailService"`, …). They are the runtime lookup keys — a typo is
a service-not-found at request time, not a compile error.

Nothing here uses `Effect.Service`, so `Context.Service` becomes the single
form.

### Runtime and layers — the part CLAUDE.md gets wrong under v4

Two upstream changes land on a documented convention of ours.

**`ManagedRuntime` no longer extends `Effect`.** `runtimeEffect` / `runtime`
became `contextEffect` / `context`, `ManagedRuntime.Context` became
`ManagedRuntime.Services<T>`, and `make` takes `{ memoMap }`. The repo threads
one `ManagedRuntime` through route factories via `makeAppRunner` —
`osn/api/src/lib/route-runtime.ts` (where `AppRuntime` is declared),
`osn/api/src/build-deps.ts:404`, `osn/api/src/app.ts`, plus `safe-error.ts` and
`grant-failure.ts`. Read `migration/runtime.md`; `Runtime<R>` itself is gone
and `Context<R>` replaces it.

**Layer memoization is now global.** In v3 each `Effect.provide` call had its
own memo scope, so two calls with overlapping layers built them twice. In v4 the
`MemoMap` is shared across `Effect.provide` calls unless `{ local: true }`.
Read `migration/layer-memoization.md`.

That second one makes the *stated rationale* in `CLAUDE.md`'s **Effect runtime**
row inaccurate under v4 — it warns that a per-request `Effect.provide` "rebuilds
the layer (restarts the OTel SDK + opens a new DB conn) every call", which
global memoization largely stops. The shared-`ManagedRuntime` pattern is still
right, for boot cost and lifecycle ownership; the reason given for it is not.
**Phase 7 rewrites that row.** Do not quietly start using per-request
`Effect.provide` on the strength of this — the pattern stands, only the
explanation changes.

### Logging

28 sites, 12 files, and the two entries most likely to break something silently.

| v3 | v4 |
| --- | --- |
| `Logger.pretty` | `Logger.layer([Logger.consolePretty(), Logger.tracerLogger])` |
| `Logger.prettyLogger` | `Logger.consolePretty` |
| `Logger.replace` | `Logger.layer([…desiredLoggers])` — v4 replaces the **whole** active set |
| `Logger.jsonLogger` | `Logger.formatJson` |
| `Logger.withMinimumLogLevel` | `Effect.provideService(effect, References.MinimumLogLevel, level)` |
| `Logger.minimumLogLevel` | `Layer.succeed(References.MinimumLogLevel, level)` |
| `LogLevel.Debug` and siblings | The string literals `"Debug"`, `"Info"`, … — v4 levels are literals, not branded objects |

> [!warning] Two silent regressions to watch
> **`Logger.tracerLogger` must be listed explicitly.** `Logger.layer` replaces
> the entire active logger set, so a migration that writes
> `Logger.layer([Logger.consolePretty()])` drops log-to-span correlation with no
> error and no failing type-check. Every log line still appears; it just stops
> being attached to a trace.
>
> **v4's JSON log output uses `level`, not `logLevel`.** Any Grafana query,
> alert or dashboard filtering on `logLevel` silently matches nothing after the
> bump. Inventory those before phase 4 and update them with it.

`shared/observability/src/logger/layer.ts` owns the logger layer for every
service, so its shape decides the rest. The other sites are the three
`src/local.ts` dev entrypoints (`osn/api`, `pulse/api`, `zap/api`),
`zap/api/src/index.ts`, and six test files.

`@effect/opentelemetry` renamed its modules too: `Logger` → `OtelLogger`
(`layerLoggerAdd`/`layerLoggerReplace` collapse into
`OtelLogger.layer({ mergeWithExisting })`), `Metrics` → `OtelMetrics`, `Tracer`
→ `OtelTracer`. `NodeSdk` and `WebSdk` keep their names.

The three rules in [[observability/overview]] still hold — no `console.*`, no
raw OTel constructors, no unbounded metric attributes. `Logger.consolePretty`
is Effect-owned, so it does not violate the first.

**Do not regress the workerd carve-out.** `osn/api/src/observability.ts`
deliberately avoids `@effect/opentelemetry/NodeSdk`'s import graph, which does
not run on workerd. `osn/api/tests/observability.test.ts` asserts this and is
the guard.

### `Schema`

1105 sites, 58 files (49 source, 9 test) — the largest item. Read
`migration/schema.md`. Two thirds is one package:

| Package | Schema files |
| --- | ---: |
| `cire/api` | 38 |
| `pulse/api` | 8 |
| `osn/api` | 5 |
| `zap/api` | 3 |
| `cire/theme` | 3 |
| `osn/client` | 1 |

| v3 | v4 |
| --- | --- |
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` — a straight rename |
| `Schema.decodeUnknownEither` | `Schema.decodeUnknownExit` |
| `Schema.maxLength` / `minLength` / `int` / `between` / `pattern` / `maxItems` / `minItems` / `greaterThan*` / `lessThan*` | `Schema.isMaxLength` and siblings, applied with `Schema.check(…)` or a schema's `.check` method |
| `Schema.optionalWith` | `Schema.optional` / `Schema.optionalKey` / `Schema.withDecodingDefaultType`, chosen by which v3 options were passed |
| `Schema.transform` | `schema.pipe(Schema.decodeTo(target, SchemaTransformation.transform({ decode, encode })))` |
| `Schema.DateFromSelf` | `Schema.Date` |
| `Schema.parseJson` | `Schema.UnknownFromJsonString`, or `Schema.fromJsonString(schema)` with an inner schema |

`Schema.Array`, `Struct`, `Record`, `Union`, `Literal` and `Tuple` survive by
name.

**The filter rewrite is where validation can silently loosen.** `maxLength(n)`
→ `check(isMaxLength(n))` is a shape change on every constrained field, and
these schemas guard guest-supplied input on a public site. Diff the effective
constraints; do not eyeball the shape.

> [!warning] `ParseResult.ParseError` has no upstream mapping yet
> The generated reference lists it as **"TODO: needs guidance"**. Our one site
> is `cire/api/src/services/changes.ts` — line 3 imports the module, line 253
> names `ParseResult.ParseError` in the error channel of an **exported**
> signature, so it ripples to callers. Resolve it from v4 source
> (`SchemaIssue` / `SchemaParser` / `ErrorReporter`) and, per the skill, report
> the gap rather than bridging it with a cast. Re-check the reference before
> starting — upstream may have filled it in.

[[schema-layers]] is the rule this must not break: Elysia TypeBox at the HTTP
boundary, Effect Schema in services, never mixed. v4 does not touch TypeBox, so
the boundary is unchanged — but a half-migrated service is exactly where someone
reaches across it to make an error go away.

### Tests

`@effect/vitest`'s `assertFailure` **changed meaning**: in v3 it asserted on an
`Exit`, in v4 it asserts a `Result.Failure`, and the v3 behaviour moved to
`assertExitFailure`. This repo uses neither helper (zero occurrences), so
nothing here is exposed — worth knowing before anyone adds one mid-migration.

## What the phase-0 spike found

Run 2026-09-06 on `shared/crypto`, against `effect@4.0.0-rc.112`, using this
skill. It answered the question it existed to ask, and the answer **changes the
phase plan** — see [[#Phase order]] below, which has been rewritten around it.

### Effect cannot be bumped one package at a time

Bun resolves two Effect majors side by side without complaint —
`effect@3.22.1` and `effect@4.0.0-rc.112` both land in the store and each
workspace links the one it declares. **Install-level isolation works. Type-level
isolation does not.**

`shared/crypto` alone on v4 produced **24 type errors**. Only 12 were real v4
migration work. The other 12 were one thing: `YieldWrap<Tag<Db, DbService>>` is
not a v4 `Effect`. `@osn/db` exports `Db` as a v3 `Context.Tag`, `shared/crypto`
yields it inside a v4 `Effect.gen`, and no edit inside `shared/crypto` can fix
that.

The bump had to walk the dependency chain to make it go away:

```
shared/crypto  →  @osn/db  →  @shared/db-utils
```

`@osn/db` passes its `Db` tag to `makeDbLive` / `makeD1DbLive` in
`@shared/db-utils`, whose signatures take `Context.Tag<any, A>`. With all three
on v4 — two `Context.Key` parameter types, one `Context.Service` declaration,
six `Effect.result` call sites — **`shared/crypto` type-checked clean and all 84
tests passed.**

But moving those two shared packages broke every other dependent, with the same
error class and for the same reason:

| Package | Errors |
| --- | ---: |
| `osn/api` | 192 |
| `pulse/api` | 29 |
| `zap/api` | 7 |
| `cire/api` | 7 |
| `pulse/db` | 5 |
| `zap/db` | 3 |
| `cire/host` | 0 — no Effect type surface |
| **Total** | **243** |

Every one is a v3 `Context.Tag` meeting a v4 `Layer` or `Effect`. There is no
subset of this repo that can sit on v4 while the rest sits on v3.

### The type-check passed and the test caught it

The most useful thing the spike produced is a worked example of the gate
argument on this page.

v3's `Effect.either` returns an `Either`, whose variants are tagged `"Right"`
and `"Left"`. v4's `Effect.result` returns a `Result`, tagged `"Success"` and
`"Failure"`. The ARC cache tests assert on the tag as a **string**:

```ts
expect(resA._tag).toBe("Right")   // v3
expect(resA._tag).toBe("Success") // v4
```

`toBe` takes `any`. Rename `Effect.either` → `Effect.result` and stop there, and
**the package type-checks clean while six assertions silently compare a v4 tag
against a v3 string** — every one of them now false. The compiler has nothing to
say. The test run fails immediately.

The skill's done condition would have called that migration finished. Our gate
does not, and this is why.

### Toolchain: no problems found

- **TypeScript 6.0.3**, `moduleResolution: "bundler"`, `strict: true` — v4's
  `.d.ts` resolve and check cleanly. v4 did **not** demand
  `exactOptionalPropertyTypes`.
- **`@effect/vitest@4.0.0-rc.112` on `vitest@4.1.11`** — peer satisfied, `it.effect`
  unchanged, 84/84 pass.
- **workerd bundling** — the Worker-safe `@shared/crypto/jwk` subpath plus
  `effect` v4 bundles under `--conditions=workerd,worker,browser` to 224 KB with
  **zero `node:` builtins**. No deploy-time module-eval hazard surfaced.
- **Soak rule** — rc.112 was 12 days old, well past `minimumReleaseAge`. No
  exclude needed, as predicted.

### Corrections to this page

- `Context.Tag` as a **type position** (a parameter annotation, not a
  declaration) maps to `Context.Key<I, S>`, per the reference's
  `Context.ReadonlyTag` → `Context.Key<Identifier, Shape>` entry. The page
  previously named only the declaration form.
- The class-syntax argument order flips: v3
  `Context.Tag(id)<Self, Shape>()` becomes v4
  `Context.Service<Self, Shape>()(id)`. Getting this backwards is the first
  thing to check when a service declaration will not compile.
- `Result` tag strings are `"Success"` / `"Failure"`. Any `_tag` compared as a
  string literal is invisible to the compiler — grep for them before phase 3.

## Phase order

> [!warning] Rewritten after the spike — there is no green intermediate state
> The original plan had eight phases, each a stacked PR that "leaves the tree
> type-checking". **The spike disproved the premise.** Effect's types cross every
> workspace boundary here, so the tree is red from the first version bump until
> the last call site is migrated. Phases are still the right *review* unit; they
> are not independently mergeable.

Tracked as [#895](https://github.com/xchromo/osn/issues/895).

| # | Phase | Issue | Green on its own? |
| ---: | --- | --- | --- |
| 0 | Spike on `shared/crypto` | #896 | Done — findings above |
| 1 | Every `effect` version bump + all 13 `Context.Tag` → `Context.Service`, in one commit | #897 + #898, merged | No |
| 2 | Renames, removals, `ManagedRuntime`, `Runtime` | #899 | No |
| 3 | Logging + `@effect/opentelemetry` renames | #900 | No |
| 4 | `Schema` — the 20 files outside cire-api | #901 | No |
| 5 | `Schema` — cire-api's 38 files | #902 | **Yes — first green point** |
| 6 | Full sweep, dev-tier smoke, docs | #903 | Yes |

**Phases 1 and 2 of the old plan are now one phase.** They cannot be separated:
a version bump with the tags left on `Context.Tag` does not type-check anywhere,
and converting the tags without the version bump does not either. #897 and #898
stay as separate issues because they are separate bodies of work to review, but
they land together.

The tree is red from the start of phase 1 until phase 5 completes. That is a
property of the migration, not a mistake in the sequencing.

### How to merge a stack that is red in the middle

`main` requires a PR and CI, and phases 1–4 cannot pass CI. Three ways to run
it; the repo owner picks:

| Approach | Trade-off |
| --- | --- |
| **A long-lived integration branch.** Each phase is a PR into `effect-v4`, not `main`; the stack merges to `main` once as a single green PR | Review stays phase-sized. One large merge to `main`; the branch needs rebasing against `main` while it lives |
| **One PR, reviewed commit by commit.** Each phase is a commit; CI runs once, at the end | No branch to maintain. A ~1300-site diff in one PR, and GitHub review-per-commit is weaker than review-per-PR |
| **Relax the CI gate for the stack.** Stacked PRs to `main` per [[stacked-prs]], with the type-check gate waived until the top | Keeps the existing flow. Puts red commits on `main`'s history and makes bisecting the range useless |

**A is the recommendation** — it is the only one that keeps both a reviewable
diff and an always-green `main`. It is also a change to how this repo merges,
which is why it is the owner's call rather than an implementation detail.

### Rules for the execution

- **Run the skill, every phase.** Look each symbol up in the reference as you
  reach it. The tables above are sizing, not authority.
- **A clean `bun run check` is the floor, never the gate.** Effect's types are
  structural: a `Layer` that dropped its finalizer, a logger set that lost
  `tracerLogger`, a filter that lost its bound, a `_tag` compared against a v3
  string — all type-check. The spike hit the last of those for real; see
  [[#The type-check passed and the test caught it]]. The tests are what catch
  them, which is why they gate here even though the skill does not gate on them.
- **Phases 1–4 cannot be verified by CI**, because the tree is red until phase 5.
  Verify each one by the error count falling and by the packages that *are*
  fully migrated passing their own tests — not by a green suite that cannot
  exist yet.
- **`shared/*` changes run the full monorepo suite** once the tree is green
  again, per the Workers-debugging rule in `CLAUDE.md`.
- **Hold the production approval until the final phase.** A merge to `main`
  auto-deploys dev; production waits on a human. See [[dev-environment]].
- **One changeset per phase.** `@cire/*` is version-less and must not share a
  changeset with versioned packages.
- **Pin exact versions while v4 is pre-GA**, so no install moves the target
  mid-stack.
