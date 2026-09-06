---
title: Effect v4 migration
description: What an Effect 3.22 → 4.0 bump costs in this monorepo — the ecosystem gate, the exact breaking surface measured against 4.0.0-rc.112, and the phase order to land it.
tags: [runbook, effect, tooling, migration, dependencies]
severity: medium
status: blocked
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
`@zap/api`, `@cire/api`, five `@shared/*` packages and three `*/db` packages.
361 files import it; 793 tests run through `it.effect`. A major bump is not a
dependency refresh, it is a cross-cutting rewrite, so this page measures it
before anyone starts.

Every number below was taken from the working tree at `851df71` and checked
against the **actual `4.0.0-rc.112` tarball**, not release notes — the module
lists come from importing each `dist/*.js` and reading its exports.

> [!warning] This is blocked, deliberately
> Effect v4 has not shipped stable. See [[#The gate]]. The plan is written now
> so the work is ready the day it does; nothing here should be executed against
> a release candidate.

## The gate

npm `dist-tags` for `effect`, as of 2026-09-06:

| Tag | Version | Published |
| --- | --- | --- |
| `latest` | `3.22.1` | — |
| `beta` | `4.0.0-beta.107` | — |
| `rc` | `4.0.0-rc.112` | 2026-08-25 |

**`latest` is still 3.x.** v4 is a release candidate, twelve days old at time of
writing, with no GA date announced. The deployed surface is `id.musubi.social`
and the cire stack serving live weddings, and `CLAUDE.md` still files Effect
itself under *trial*. Adopting an RC across ~1300 edit sites on that stack buys
nothing a GA bump would not buy later, more safely.

The soak rule is **not** the blocker, for the record. `bunfig.toml` sets
`minimumReleaseAge = 259200` (3 days) and rc.112 cleared that on 2026-08-28, so
the bump needs no `minimumReleaseAgeExcludes` entry and no
`# DROP AFTER` marker. The blocker is GA, nothing else.

**Trigger to start:** `npm view effect dist-tags` reports `latest` as `4.0.0` or
later. Re-verify the tables below at that point — they were measured against
rc.112 and the RC line is still moving.

## Ecosystem readiness

| Package | Declared here | v4 available | Verdict |
| --- | --- | --- | --- |
| `effect` | `^3.22.1` (13 packages) | `4.0.0-rc.112` | RC only — the gate |
| `@effect/vitest` | `^0.30.0` (10 packages) | `4.0.0-rc.112` | Ready. Peer is `vitest >=4.1.0 <5.0.0`; every workspace is already on `^4.1.11` |
| `@effect/opentelemetry` | `^0.64.0` (`shared/observability`) | `4.0.0-rc.112` | Ready. Still ships `NodeSdk` and `WebSdk`. Its otel peers (`api >=1.9`, `sdk-trace-base >=2.0`, `sdk-logs >=0.203`) are all satisfied by the versions already declared |
| `@effect/platform` | `^0.97.1` (`shared/observability`) | **none** | Dead dependency — nothing in the repo imports it. v4 folded platform into `effect/unstable/*`. Delete the line |

There is **no codemod**. `@effect/codemod` last published `0.0.16` in July 2024
and covers v2 → v3 only. Every edit below is ours to make, by script or by hand.

## What does not break

The overwhelming majority of the call surface survives. Measured counts of the
top APIs, all present in rc.112:

`Effect.gen` (1606) · `Effect.provide` (972) · `Effect.runPromise` (461) ·
`Effect.tryPromise` (451) · `Effect.sync` (373) · `Effect.fail` (346) ·
`Effect.flip` (325) · `Effect.promise` (294) · `Effect.withSpan` (248) ·
`Effect.catchTag` (228) · `Effect.provideService` (182) · `Data.TaggedError`
(165) · `Effect.succeed` (142) · `Effect.logError` (109) · `Effect.tapError`
(100) · `Effect.all` · `Effect.runPromiseExit` · `Effect.annotateLogs` ·
`Effect.tapDefect` · `Effect.void` · `Effect.try` · `Layer.effect` ·
`Layer.succeed` · `Layer.merge` · `Layer.provide` · `Option.*` · `Exit.*` ·
`ManagedRuntime.make` · `it.effect` and `it.layer`.

`Data.TaggedError` surviving matters more than any other single line here: it is
the repo's error vocabulary, 165 sites, and it needs no edit at all.

## What breaks

### Mechanical renames

Every row is a find-and-replace, safe to script, verifiable by type-check.

| v3 | v4 | Sites | Files |
| --- | --- | ---: | ---: |
| `Effect.catchAllDefect` | `Effect.catchDefect` | 94 | 20 |
| `Effect.either` | `Effect.result` | 71 | 13 |
| `Effect.catchAll` | `Effect.catch` | 42 | 24 |
| `Effect.forkDaemon` | `Effect.forkDetach` | 7 | 5 |
| `Effect.catchAllCause` | `Effect.catchCause` | 1 | 1 |
| `Either` module | `Result` module | — | 4 |

`Either` is gone as a module; v4 ships `Result` (`Result.isFailure` in place of
`Either.isLeft`). The affected files are all tests:
`cire/api/tests/services/changes.test.ts`,
`shared/email/tests/cloudflare.test.ts`, `shared/email/tests/resend.test.ts`,
`zap/api/tests/services/messages.test.ts`.

### Removed with no direct replacement

| v3 | Sites | Files | Replacement |
| --- | ---: | ---: | --- |
| `Effect.zipRight` | 7 | 3 | `Effect.andThen`, or a `gen` block |
| `Effect.dieMessage` | 2 | 2 | `Effect.die(new Error(msg))` |
| `Layer.scoped` | 6 | 4 | `Layer.effect` with an explicit `Scope` |
| `Runtime.isFiberFailure` / `Runtime.FiberFailureCauseId` | 4 | 2 | Inspect the `Exit` / `Cause` directly |
| `Cause.failureOption` | 4 | 4 | `Cause` filter combinators |

`Layer.scoped` sites: `shared/redis/src/service.ts`,
`shared/redis/src/ioredis.ts`, `cire/api/tests/services/import.test.ts`,
`cire/api/tests/db/test-layer.ts`.

The `Runtime` / `Cause` sites are the two error-shaping helpers in osn-api —
`osn/api/src/lib/safe-error.ts` and `osn/api/src/lib/grant-failure.ts` — plus
two cire tests. Small, but they sit on the error path every route returns
through, so they get their own careful pass rather than a script.

### `Context.Tag` → `Context.Service`

13 sites, 11 files. `Context.Tag` no longer exists; v4 has `Context.Key` and the
class-style `Context.Service<Self, Shape>()("Key")`. A `Key` still extends
`Effect`, so every `yield* DbService` call site is unaffected — only the 13
declarations change.

This is the highest-leverage edit in the migration: small, central, and it
unblocks type-checking for whole packages at once. The declarations are the
`DbService` / `Db` tags in `osn/db`, `pulse/db`, `zap/db` and `cire/api/src/db`,
`Redis` in `shared/redis`, `EmailService` in `shared/email`, `OsnAuth` and
`Storage` in `osn/client`, the two R2 services in `cire/api`, and the two
generic `Context.Tag<any, …>` parameters in `shared/db-utils/src/index.ts`.

Nothing uses `Effect.Service` today, so there is no second service idiom to
reconcile.

### Logging

`Logger` is rewritten and `LogLevel` is no longer a set of constructors. 28
sites across 12 files.

| v3 | v4 |
| --- | --- |
| `Logger.pretty` (11) | `Logger.consolePretty` |
| `Logger.replace` (7) | `Logger.layer` |
| `Logger.jsonLogger` (4) | `Logger.consoleJson` |
| `Logger.prettyLogger` (2) | `Logger.consolePretty` |
| `Logger.withMinimumLogLevel` (3), `Logger.minimumLogLevel` (1) | `References.MinimumLogLevel` |
| `LogLevel.Debug` / `Info` / `Warning` / `Error` / `Fatal` / `Trace` / `All` (10) | String literals |

Concentrated in the three `src/local.ts` dev entrypoints (`osn/api`,
`pulse/api`, `zap/api`), `zap/api/src/index.ts`,
`shared/observability/src/logger/layer.ts`, and six test files. Because
`shared/observability` owns the logger layer, that one file decides the shape
for every service — do it first and the rest follow.

Check the three observability rules in [[observability/overview]] still hold
after the rewrite: no `console.*`, no raw OTel constructors, no unbounded
metric attributes. `Logger.consolePretty` and friends are Effect-owned, so the
first rule is not violated by using them.

### `Schema` — the real work

**1105 sites across 58 files (49 source, 9 test).** Effect v4 rewrote Schema
end to end. This is not a rename pass; it is the migration.

The concentration is the one piece of good news:

| Package | Schema files |
| --- | ---: |
| `cire/api` | 38 |
| `pulse/api` | 8 |
| `osn/api` | 5 |
| `zap/api` | 3 |
| `cire/theme` | 3 |
| `osn/client` | 1 |

Two thirds of it is cire-api. The mapping:

| v3 | v4 | Sites |
| --- | --- | ---: |
| `Schema.decodeUnknown(S)` | `Schema.decodeUnknownEffect(S)` — or `…Result` / `…Sync` / `…Promise` / `…Option` / `…Exit` by call site | 75 |
| `Schema.maxLength` / `minLength` / `int` / `between` / `pattern` / `maxItems` / `minItems` / `greaterThan` / `greaterThanOrEqualTo` / `lessThanOrEqualTo` | `Schema.check(Schema.isMaxLength(n))` and siblings — filters became `is*` predicates applied through `check` | ~120 |
| `Schema.optionalWith` | `Schema.optional` / `Schema.optionalKey` (+ explicit defaults) | 22 |
| `Schema.transform` | `Schema.decodeTo` / `Schema.encodeTo` with `SchemaTransformation` | 9 |
| `Schema.decodeUnknownEither` | `Schema.decodeUnknownResult` | 1 |
| `Schema.DateFromSelf` | `Schema.Date` | 3 |
| `Schema.parseJson` | `Schema.fromJsonString` / `Schema.UnknownFromJsonString` | 1 |
| `ParseResult` module | `SchemaIssue` / `SchemaParser` / `ErrorReporter` | 1 file |

`Schema.Array`, `Struct`, `Record`, `Union`, `Literal` and `Tuple` all survive
by name. The `ParseResult` site is `cire/api/src/services/changes.ts`, whose
`DecodedChange` return type names `ParseResult.ParseError` in its error channel
— an exported signature, so it ripples to callers.

The `decodeUnknown` split is the one place a script cannot decide for you: v3's
single `decodeUnknown` returned an Effect, and v4 asks which of six result
shapes you want. Every one of the 75 sites needs reading, not replacing.

[[schema-layers]] is the rule this migration must not quietly break: Elysia
TypeBox at the HTTP boundary, Effect Schema in services, never mixed. Nothing
in the v4 rewrite touches TypeBox, so the boundary is unchanged — but a
half-migrated service is exactly where someone reaches across it.

## Phase order

Each phase is a PR, stacked on the one before it per [[stacked-prs]]. The
ordering is bottom-up through the dependency graph, so every phase leaves the
tree type-checking.

| # | Phase | Scope | Gate |
| ---: | --- | --- | --- |
| 0 | Spike | One throwaway branch. Bump `shared/crypto` (3 src files, 2 tests) alone and make it green. Confirms the toolchain — TypeScript ^6.0.3, `moduleResolution: bundler`, workerd bundling — before committing to the rest | Not merged. Findings amend this page |
| 1 | Ecosystem | Bump `effect`, `@effect/vitest`, `@effect/opentelemetry` in all 13 `package.json` files. Delete the dead `@effect/platform` line from `shared/observability` | Install resolves; nothing else expected to pass |
| 2 | Service keys | The 13 `Context.Tag` declarations → `Context.Service` | `bun run check` on `*/db` + `shared/*` |
| 3 | Mechanical renames | The rename table + the removed-API table, across all packages | `bun run check`, `bun run lint` |
| 4 | Logging | `shared/observability/src/logger/layer.ts` first, then the three `local.ts` files, `zap/api/src/index.ts`, and the six test files | `bun run --cwd shared/observability test:run` |
| 5 | Schema — shared and small | `osn/client`, `cire/theme`, `zap/api`, `osn/api`, `pulse/api` (20 files) | Each package's `test:run` |
| 6 | Schema — cire-api | The remaining 38 files. Split further if the diff outgrows review | `bun run --cwd cire/api test:run`, then `test:d1` |
| 7 | Full sweep | Whole-suite run, both test tiers, `bun run build`, deploy to the dev tier and smoke it | Green CI + dev tier healthy |

Phases 5 and 6 are where the estimate lives; 1 through 4 are a day's work
between them.

### Rules for the execution

- **Never `bun run check` alone as the gate.** Effect's types are structural and
  a wrong `Layer` shape can type-check and fail at runtime. Every phase runs the
  affected packages' tests too.
- **`shared/*` changes run the full monorepo suite**, per the Workers-debugging
  rule in `CLAUDE.md` — a shared package's schema change is exactly the case
  that rule exists for.
- **Do not deploy production mid-stack.** The two-tier gate means a merge to
  `main` auto-deploys dev; production waits on a human. Hold that approval until
  phase 7 is green. See [[dev-environment]].
- **One changeset per phase**, naming the workspace packages the phase touches.
  `@cire/*` is version-less and must not share a changeset with versioned
  packages — see the Changesets row in `CLAUDE.md`.

## Open questions

- **Does the Effect trial survive the bump?** `CLAUDE.md` still calls Effect a
  trial and the decision is unmade. A v4 migration of this size is a poor thing
  to spend before deciding to keep the library. The decision should land first.
- **`shared/observability` and workerd.** The v4 `@effect/opentelemetry` ships
  `NodeSdk` and `WebSdk` as before, but `osn/api/src/observability.ts` already
  deliberately avoids the `NodeSdk` import graph on workerd. Phase 4 must not
  regress that; `osn/api/tests/observability.test.ts` asserts it and is the
  guard.
- **`effect/unstable/*`.** v4 moved http, sql, rpc and observability into
  `unstable` subpaths of core. Nothing here imports them today and nothing needs
  to — but they are where `@effect/platform` went, so a future need lands there.
