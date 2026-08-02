import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createSchemaSql } from "../src/testing";

// Mechanical enforcement of the OSN DDL lockstep contract, ported from
// cire/api's ddl-lockstep.test.ts (T-S1).
//
// Two surfaces must describe the same database shape:
//   1. osn/db/drizzle/*.sql — what production D1 actually is,
//   2. `createSchemaSql()` — the schema-derived DDL every OSN test runs on
//      (bun:sqlite for the unit suites, Miniflare D1 for d1-integration).
//
// Surface 2 is emitted from src/schema/index.ts, so this also pins the Drizzle
// schema itself: a column added to schema.ts without a generated migration
// fails here, as does a migration applied without updating schema.ts.
//
// This test exists because the emitter used to drop column-level `.unique()`
// entirely (it read only the table-level `uniqueConstraints`). Seven UNIQUE
// constraints — accounts.email, accounts.passkey_user_id, users.handle,
// passkeys.credential_id, recovery_codes.code_hash, organisations.handle and
// oauth_clients.client_id — were missing from every test database, so the
// suite happily accepted duplicates that production D1 rejects.
//
// Normalisation — differences deliberately treated as equal:
// - Column ORDER is ignored (columns are keyed by name). D1's ALTER TABLE ADD
//   COLUMN can only append, so migrated order diverges cosmetically.
// - Index NAMES are ignored; an index is (unique, columns, partial-WHERE).
//   drizzle-kit spells column-level UNIQUE as a named `*_unique` index while
//   the emitter uses inline UNIQUE (an autoindex) — the same constraint.
// - Text primary keys count as NOT NULL on both surfaces. drizzle-kit emits
//   `PRIMARY KEY NOT NULL`; the emitter relies on `PRIMARY KEY` alone.
// - Boolean defaults: drizzle-kit writes `DEFAULT false`, the emitter writes
//   `DEFAULT 0`. SQLite has treated `false` as an alias for 0 since 3.23, and
//   both surfaces store the identical value — only PRAGMA's echoed literal
//   differs.

// `import.meta.dir` is Bun-only and undefined under vitest, which runs this suite.
const MIGRATIONS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "drizzle");

interface ColumnShape {
  type: string;
  notNull: boolean;
  default: string | null;
  /** 1-based position within the primary key; 0 = not part of it. */
  pk: number;
}
interface IndexShape {
  unique: boolean;
  columns: string[];
  where: string | null;
}
interface TableShape {
  columns: Record<string, ColumnShape>;
  indexes: string[];
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
}

/** Apply the full migration chain to a fresh in-memory database. */
function migratedDb(): Database {
  const db = new Database(":memory:");
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit separates statements with this marker.
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
  return db;
}

/** Apply the schema-derived DDL to a fresh in-memory database. */
function emittedDb(): Database {
  const db = new Database(":memory:");
  for (const stmt of createSchemaSql()) db.run(stmt);
  return db;
}

/** `DEFAULT false`/`DEFAULT true` and `DEFAULT 0`/`DEFAULT 1` are the same value. */
function normaliseDefault(value: string | null): string | null {
  if (value === "false") return "0";
  if (value === "true") return "1";
  return value;
}

function indexKey(idx: IndexShape): string {
  const cols = idx.columns.toSorted().join(",");
  return `${idx.unique ? "UNIQUE" : "INDEX"}(${cols})${idx.where ? ` WHERE ${idx.where}` : ""}`;
}

function snapshot(db: Database): Record<string, TableShape> {
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  const out: Record<string, TableShape> = {};
  for (const { name } of tables) {
    if (name === "__drizzle_migrations") continue;

    const cols = db.query(`PRAGMA table_info("${name}")`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;

    const columns: Record<string, ColumnShape> = {};
    for (const c of cols) {
      columns[c.name] = {
        type: c.type.toUpperCase(),
        // A primary key column is NOT NULL on every surface — see header note.
        notNull: c.notnull === 1 || c.pk > 0,
        default: normaliseDefault(c.dflt_value),
        pk: c.pk,
      };
    }

    const idxList = db.query(`PRAGMA index_list("${name}")`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>;
    const indexes = idxList.map((i) => {
      const info = db.query(`PRAGMA index_info("${i.name}")`).all() as Array<{ name: string }>;
      const where =
        i.partial === 1
          ? ((
              db
                .query("SELECT sql FROM sqlite_master WHERE type='index' AND name = ?")
                .get(i.name) as { sql: string | null } | null
            )?.sql
              ?.replace(/\s+/g, " ")
              .match(/\bWHERE\b\s+(.*)$/i)?.[1]
              ?.trim() ?? null)
          : null;
      return indexKey({
        unique: i.unique === 1,
        columns: info.map((x) => x.name),
        where,
      });
    });

    out[name] = { columns, indexes: [...new Set(indexes)].toSorted() };
  }
  return out;
}

describe("OSN DDL lockstep", () => {
  const migrated = snapshot(migratedDb());
  const emitted = snapshot(emittedDb());

  it("the migration chain applies cleanly and creates tables", () => {
    expect(Object.keys(migrated).length).toBeGreaterThan(0);
  });

  it("covers the same set of tables", () => {
    expect(Object.keys(emitted).toSorted()).toEqual(Object.keys(migrated).toSorted());
  });

  it.each(Object.keys(migrated).toSorted())("table %s has matching columns", (table) => {
    expect(emitted[table]?.columns).toEqual(migrated[table].columns);
  });

  it.each(Object.keys(migrated).toSorted())(
    "table %s has matching indexes and constraints",
    (table) => {
      expect(emitted[table]?.indexes).toEqual(migrated[table].indexes);
    },
  );
});
