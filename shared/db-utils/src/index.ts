import { Database } from "bun:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { Effect, Layer, type Context } from "effect";

/**
 * The Drizzle handle threaded through every service, broadened over both SQLite
 * result kinds so the *same* query code runs against two drivers:
 *  - `bun:sqlite` — synchronous; the `local` environment: dev servers
 *    (`makeDbLive`) and the unit-test suite (`createTestLayer()`).
 *  - Cloudflare D1 — asynchronous; the `dev` / `staging` / `prod` environments,
 *    where each API runs on Workers (`makeD1DbLive` / `createD1Db`).
 *
 * Because the result kind is `"sync" | "async"`, `.all()` / `.get()` / `.run()`
 * resolve to `T | Promise<T>`, so callers MUST `await` every query (in practice
 * via `Effect.tryPromise` / `dbQuery`). Awaiting a synchronous bun:sqlite result
 * is a harmless no-op; D1 returns a real Promise. `unknown` for the run-result
 * type covers bun's `void` and D1's `D1Result`.
 */
export type Db<S extends Record<string, unknown>> = BaseSQLiteDatabase<
  "sync" | "async",
  unknown,
  S
>;

/**
 * Construct a synchronous bun:sqlite-backed Drizzle client. Used by the `local`
 * environment only (dev servers + tests). The concrete {@link BunSQLiteDatabase}
 * is assignable to the broadened {@link Db}, so call sites stay portable to D1.
 */
export function createDrizzleClient<S extends Record<string, unknown>>(
  dbPath: string,
  schema: S,
): BunSQLiteDatabase<S> {
  const sqlite = new Database(dbPath);
  return drizzle(sqlite, { schema });
}

export function makeDbLive<S extends Record<string, unknown>, A extends { readonly db: Db<S> }>(
  tag: Context.Tag<any, A>,
  dbPath: string,
  schema: S,
) {
  return Layer.effect(
    tag,
    Effect.sync(() => ({ db: createDrizzleClient(dbPath, schema) }) as A),
  );
}

/**
 * Construct a Drizzle client over a Cloudflare D1 binding. Called per isolate in
 * a Workers entry point — Workers have no long-lived process, so the binding
 * only exists on `env` inside `fetch`. Drives the `dev` / `staging` / `prod`
 * environments.
 */
export function createD1Db<S extends Record<string, unknown>>(d1: D1Database, schema: S): Db<S> {
  return drizzleD1(d1, { schema });
}

/**
 * Build a `Db` service Layer over a Cloudflare D1 binding, mirroring the shape
 * of {@link makeDbLive} so Workers entry points can swap drivers with a one-line
 * change (`makeDbLive(...)` → `makeD1DbLive(...)`).
 */
export function makeD1DbLive<S extends Record<string, unknown>>(
  tag: Context.Tag<any, { readonly db: Db<S> }>,
  d1: D1Database,
  schema: S,
) {
  return Layer.succeed(tag, { db: createD1Db(d1, schema) });
}

/**
 * Run a Drizzle query as an Effect, bridging the sync/async driver split.
 *
 * `.all()` / `.get()` / `.run()` return a plain value on bun:sqlite and a
 * Promise on D1; `Promise.resolve` normalises both. A throw surfaces as a
 * defect — for writes that need a typed error, use `Effect.tryPromise` instead
 * so the failure lands in the error channel.
 */
export const dbQuery = <A>(run: () => A | Promise<A>): Effect.Effect<A> =>
  Effect.promise(() => Promise.resolve(run()));
