/**
 * `jsonEachIn` and `insertManyViaJsonEach` exist to keep a variable-length
 * `IN (...)` or a multi-row `INSERT` under D1's 100-bound-parameter cap
 * (developers.cloudflare.com/d1/platform/limits/) by binding the whole
 * array as one JSON parameter instead of one parameter per element.
 * bun:sqlite enforces no such cap, so these tests can't reproduce the
 * failure the helpers fix — they pin the contract that makes the fix work
 * (constant parameter count regardless of input size, correct round-trip
 * data) via `.toSQL()`, which never executes a query. The real-D1 proof —
 * that json_each is accepted and returns the right rows on Miniflare/
 * workerd D1, not just bun:sqlite — lives in `pulse/api`'s
 * `d1-integration.test.ts`.
 */

import { Database } from "bun:sqlite";

import { getTableColumns, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { insertManyViaJsonEach, jsonEachIn } from "../src/jsonEach";

// A throwaway 4-column fixture table — enough columns to prove the
// per-column, per-row math without dragging in a real app schema.
const widgets = sqliteTable("widgets", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  ownerId: text("owner_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(
    "CREATE TABLE widgets (id TEXT PRIMARY KEY, label TEXT NOT NULL, owner_id TEXT, created_at INTEGER NOT NULL)",
  );
  return drizzle(sqlite, { schema: { widgets } });
}

describe("jsonEachIn", () => {
  it("binds exactly one parameter no matter how many ids are in the list", () => {
    const db = makeDb();
    for (const size of [1, 50, 100, 1_000]) {
      const ids = Array.from({ length: size }, (_, i) => `id_${i}`);
      const built = db
        .select()
        .from(widgets)
        .where(inArray(widgets.id, jsonEachIn(ids)))
        .toSQL();
      expect(built.params).toHaveLength(1);
      expect(built.sql).toContain("json_each");
    }
  });

  it("round-trips the id list correctly against a real (bun:sqlite) engine", () => {
    const db = makeDb();
    const now = new Date();
    db.insert(widgets)
      .values([
        { id: "a", label: "A", ownerId: null, createdAt: now },
        { id: "b", label: "B", ownerId: null, createdAt: now },
        { id: "c", label: "C", ownerId: null, createdAt: now },
      ])
      .run();

    const rows = db
      .select({ id: widgets.id })
      .from(widgets)
      .where(inArray(widgets.id, jsonEachIn(["a", "c", "does-not-exist"])))
      .all();
    expect(rows.map((r) => r.id).toSorted()).toEqual(["a", "c"]);
  });

  it("matches nothing for an empty list, same as inArray(col, [])", () => {
    const db = makeDb();
    const built = db
      .select()
      .from(widgets)
      .where(inArray(widgets.id, jsonEachIn([])))
      .toSQL();
    expect(built.params).toHaveLength(1);

    db.insert(widgets).values({ id: "a", label: "A", ownerId: null, createdAt: new Date() }).run();
    const rows = db
      .select({ id: widgets.id })
      .from(widgets)
      .where(inArray(widgets.id, jsonEachIn([])))
      .all();
    expect(rows).toHaveLength(0);
  });

  it("reusing one jsonEachIn(...) call across two predicates binds it twice, not once (osn-tracker#592 shape)", () => {
    // discovery.ts's friends filter splices the same connectionIds set into
    // two branches of one `or(...)` — this is that shape reduced to the
    // fixture table. 2 total params (not 2×N) either way: the fix is
    // binding the array once per *occurrence*, never once per *element*.
    const db = makeDb();
    const idsJson = jsonEachIn(["a", "b"]);
    const built = db
      .select()
      .from(widgets)
      .where(or(inArray(widgets.id, idsJson), inArray(widgets.ownerId, idsJson)))
      .toSQL();
    expect(built.params).toHaveLength(2);
  });
});

describe("insertManyViaJsonEach", () => {
  const now = new Date(1_700_000_000_000);

  it("binds exactly one parameter no matter how many rows or columns", () => {
    const db = makeDb();
    for (const rowCount of [1, 4, 260, 1_000]) {
      const rows = Array.from({ length: rowCount }, (_, i) => ({
        id: `w_${i}`,
        label: `Widget ${i}`,
        ownerId: null,
        createdAt: now,
      }));
      const built = (
        db as unknown as { dialect: { sqlToQuery: (s: unknown) => { params: unknown[] } } }
      ).dialect.sqlToQuery(insertManyViaJsonEach(widgets, rows));
      expect(built.params).toHaveLength(1);
    }
  });

  it("derives the fixed insertManyViaJsonEach param count against the scaling .values(rows) count", () => {
    // The regression this guards: `.values(rows)` binds columns × rows
    // parameters (derived here from the row's own key count, never
    // hard-coded), which is exactly what crosses D1's 100-parameter cap.
    // `insertManyViaJsonEach` stays at 1 regardless.
    const db = makeDb();
    const columnCount = Object.keys(getTableColumns(widgets)).length;
    const rowCount = 30;
    const rows = Array.from({ length: rowCount }, (_, i) => ({
      id: `w_${i}`,
      label: `Widget ${i}`,
      ownerId: null,
      createdAt: now,
    }));

    const oldStyle = db.insert(widgets).values(rows).toSQL();
    expect(oldStyle.params).toHaveLength(columnCount * rowCount);
    expect(oldStyle.params.length).toBeGreaterThan(100); // this is the bug

    const built = (
      db as unknown as { dialect: { sqlToQuery: (s: unknown) => { params: unknown[] } } }
    ).dialect.sqlToQuery(insertManyViaJsonEach(widgets, rows));
    expect(built.params).toHaveLength(1);
  });

  it("round-trips rows correctly, including null and boolean-mapped values", () => {
    const db = makeDb();
    const rows = [
      { id: "a", label: 'Hello "quotes"', ownerId: "owner_1", createdAt: now },
      { id: "b", label: "Row 2", ownerId: null, createdAt: new Date(now.getTime() + 1_000) },
    ];
    db.run(insertManyViaJsonEach(widgets, rows));

    const back = db.select().from(widgets).orderBy(widgets.id).all();
    expect(back).toEqual([
      { id: "a", label: 'Hello "quotes"', ownerId: "owner_1", createdAt: now },
      { id: "b", label: "Row 2", ownerId: null, createdAt: new Date(now.getTime() + 1_000) },
    ]);
  });

  it("throws on an empty row set rather than emitting a no-op insert", () => {
    expect(() => insertManyViaJsonEach(widgets, [])).toThrow(/non-empty/);
  });

  it("throws on a key that isn't one of the table's columns, rather than silently dropping it", () => {
    expect(() =>
      insertManyViaJsonEach(widgets, [
        { id: "a", label: "A", ownerId: null, createdAt: now, bogus: 1 } as never,
      ]),
    ).toThrow(/not a column/);
  });
});
