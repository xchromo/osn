---
title: Database Environments (local / dev / staging / prod)
aliases:
  - D1 local D1
  - four environments
  - bun:sqlite to D1
tags:
  - systems
  - infrastructure
  - database
status: current
related:
  - "[[testing-patterns]]"
  - "[[backend-patterns]]"
  - "[[schema-layers]]"
  - "[[monorepo-structure]]"
last-reviewed: 2026-06-16
---

# Database Environments

OSN runs each service's database across **four environments**, with **two
drivers** behind a single driver-agnostic Drizzle type:

| Environment | Driver | Where it runs | How |
|---|---|---|---|
| `local` | **bun:sqlite** | Dev machine | `bun run dev` (Bun.serve) + in-memory unit tests |
| `dev` | **Cloudflare D1** | Locally *or* deployed | `wrangler dev --env dev` (miniflare local D1) or `wrangler deploy --env dev` |
| `staging` | **Cloudflare D1** | Deployed | `wrangler deploy --env staging` |
| `production` | **Cloudflare D1** | Deployed | `wrangler deploy --env production` |

`local` stays on bun:sqlite because it is the cheapest, fastest way to spin up a
fresh database per test (`new Database(":memory:")` resolves in microseconds and
needs no network or daemon). D1 cannot match that for unit tests — a D1 binding
only exists inside workerd/miniflare. So unit tests keep bun:sqlite; the D1 path
is exercised by a single Miniflare integration test per service.

This mirrors how [[cire-auth|Cire]] already works (D1 at runtime, bun:sqlite for
dev + tests) and generalises it to the rest of the monorepo.

## The driver-agnostic seam (`@shared/db-utils`)

A single broadened Drizzle type lets the *same* query code run on both drivers:

```ts
// drizzle handle broadened over bun:sqlite (sync) AND D1 (async) result kinds
export type Db<S> = BaseSQLiteDatabase<"sync" | "async", unknown, S>;
```

Because the result kind is `"sync" | "async"`, every `.all()` / `.get()` /
`.run()` resolves to `T | Promise<T>` — so service code **must `await`** (in
practice via `Effect.tryPromise` or the `dbQuery` bridge). Awaiting a synchronous
bun:sqlite result is a harmless no-op; D1 returns a real Promise.

`@shared/db-utils` exports:

- `makeDbLive(tag, path, schema)` — bun:sqlite layer (the `local` env).
- `createD1Db(binding, schema)` / `makeD1DbLive(tag, binding, schema)` — D1
  layer, built per-isolate from `env.DB` inside the Workers entry.
- `dbQuery(() => …)` — normalises a sync-or-Promise Drizzle result into an
  `Effect` (use `Effect.tryPromise` instead when you need a typed error).

## Per-service wiring

Each migrated API is factored into a `createApp({ dbLayer })` factory
(`new Elysia({ aot: false })` — Workers forbid Elysia's `new Function` AOT
codegen) plus two entry points:

- `src/local.ts` — long-lived `Bun.serve` over the bun:sqlite `DbLive` layer.
- `src/index.ts` — Workers `fetch` handler that builds the app once per isolate
  over `makeDbD1Live(env.DB)`, failing closed with a 503 when `DB` is missing.

`wrangler.toml` declares one `[[env.<name>.d1_databases]]` binding per D1
environment. The db package's `db:migrate:*` scripts apply Drizzle-generated
migrations to each:

```bash
bun run --cwd zap/db db:migrate:local     # miniflare local D1 (for `wrangler dev`)
bun run --cwd zap/db db:migrate:dev       # remote dev D1
bun run --cwd zap/db db:migrate:staging
bun run --cwd zap/db db:migrate:prod
```

## ⚠️ D1 has no interactive transactions

The one true incompatibility: **D1 does not support `db.transaction(async tx =>
…)`** (interactive read-then-conditional-write). It offers only `db.batch([…])`
— an atomic list of pre-built statements with no intermediate reads. Any service
relying on `db.transaction` for atomicity (e.g. atomic handle-uniqueness checks,
account erasure) must be redesigned before it can run on D1:

- **Zap** — 0 transactions → fully D1-ready (migrated, Miniflare-tested).
- **Pulse** — 5 transactions, all in `accountErasure.ts`.
- **OSN core** — 17 transactions across `auth`, `profile`, `graph`,
  `organisation`, `account-erasure` (auth/compliance-critical; several cite
  security findings S-H1/S-M2 for their atomicity guarantee).

These rewrites are tracked in `wiki/TODO.md`. Until a service's transactions are
converted, it stays `local`-only (bun:sqlite) and is not wired for D1.

## Migration status

| Service | bun:sqlite (`local`) | D1 (`dev`/`staging`/`prod`) | Transactions to convert |
|---|---|---|---|
| `@zap/api` | ✅ | ✅ (Miniflare-tested) | 0 — done |
| `@pulse/api` | ✅ | ⛔ pending | 5 (`accountErasure.ts`) |
| `@osn/api` | ✅ | ⛔ pending | 17 (5 services) |
| `@cire/api` | ✅ (dev/tests) | ✅ (always was) | n/a |

## Testing

Unit tests use `createTestLayer()` / bun:sqlite `:memory:` exactly as before —
see [[testing-patterns]]. The async D1 driver path gets one Miniflare-backed
integration test per service, co-located in `src/` so the vitest unit run
(globbing `tests/**`) skips it; run it explicitly:

```bash
bun run --cwd zap/api test:d1     # bun test src/d1-integration.test.ts
```
