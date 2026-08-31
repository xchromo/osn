import {
  getTableColumns,
  sql,
  type Column,
  type InferInsertModel,
  type SQL,
  type Table,
} from "drizzle-orm";

/**
 * D1 caps a query at 100 bound parameters
 * (developers.cloudflare.com/d1/platform/limits/). bun:sqlite — every test
 * tier except a real-D1 integration suite — enforces no such cap, so a query
 * that binds one parameter per array element (`inArray(col, ids)`) or one
 * parameter per column per row (`.values(rows)`) looks fine locally and
 * throws `D1_ERROR: too many SQL variables` in production once the input
 * grows past a few dozen rows or a few hundred ids.
 *
 * Both helpers below sidestep the cap by binding the whole array as ONE
 * JSON-encoded parameter and unpacking it inside SQLite with `json_each`, a
 * table-valued function from the json1 extension built into both drivers
 * this repo runs on. Verified against real Miniflare-backed D1 — not
 * bun:sqlite, not assumed from a comment — in `pulse/api`'s
 * `d1-integration.test.ts`: a 1,000-element list binds as 1 parameter on
 * both `jsonEachIn` and `insertManyViaJsonEach`, and the planner flattens
 * `col IN (SELECT value FROM json_each(?))` into a `LIST SUBQUERY` rather
 * than a scan.
 */

/**
 * A `col IN (...)` right-hand side whose parameter list is a single bound
 * JSON array instead of one bound parameter per element. Use it as the
 * second argument to drizzle's `inArray`:
 *
 *   inArray(events.id, jsonEachIn(ids))
 *
 * — or splice it directly into a raw `sql` template where the array needs
 * to appear more than once in one statement (two predicates that both want
 * the same set can share one `jsonEachIn(...)` call and its one bound
 * param each time it's spliced in, rather than each re-deriving the list).
 *
 * `values` may be empty — `json_each('[]')` is a legal zero-row source, so
 * this degrades to "matches nothing" the same way `inArray(col, [])` does,
 * without a special case here.
 */
export function jsonEachIn(values: readonly (string | number)[]): SQL {
  return sql`(SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/**
 * A multi-row `INSERT INTO <table> (...) SELECT ... FROM json_each(?)`
 * statement, standing in for drizzle's `db.insert(table).values(rows)` at
 * any site where the row count times the column count can cross D1's
 * 100-parameter cap (a 31-column table breaks past 3 rows; a 6-column one
 * past 16).
 *
 * Every row must carry the same set of keys — the first row's own keys
 * decide the column list, matching `.values(rows)`'s own uniform-shape
 * assumption. A key that isn't one of the table's columns throws rather
 * than silently dropping data; an empty `rows` also throws, since an empty
 * INSERT is a caller bug to fix at the call site (every site here already
 * guards `rows.length === 0` before reaching this point).
 *
 * The result is a plain `SQL` statement, run with `db.run(...)` rather than
 * chained off `db.insert(...)` — so `.returning()` and
 * `.onConflictDoNothing()` aren't available. None of today's call sites
 * need either; a future one that does should chunk under the cap with
 * `.values()` instead of reaching for this.
 */
export function insertManyViaJsonEach<TTable extends Table>(
  table: TTable,
  rows: readonly InferInsertModel<TTable>[],
): SQL {
  if (rows.length === 0) {
    throw new Error("insertManyViaJsonEach: rows must be non-empty — guard at the call site");
  }

  const allColumns = getTableColumns(table);
  // The first row's own keys decide the column list, so they are keys of the
  // insert model rather than arbitrary strings — typing them that way is what
  // lets the value read below index the row directly instead of widening it to
  // a dictionary of `unknown`.
  const keys = Object.keys(rows[0]!) as (keyof InferInsertModel<TTable> & string)[];
  const columns: Column[] = keys.map((key) => {
    const column: Column | undefined = allColumns[key];
    if (!column) {
      throw new Error(`insertManyViaJsonEach: "${key}" is not a column of this table`);
    }
    return column;
  });

  // Mirrors drizzle's own null handling (`sql/sql.ts`: a null value is
  // bound as SQL NULL directly, never run through the column's encoder —
  // several encoders, e.g. the timestamp one, call `.getTime()` on the
  // value and would throw on null).
  const driverRows = rows.map((row) =>
    columns.map((column, i) => {
      const value = row[keys[i]!];
      return value === null || value === undefined ? null : column.mapToDriverValue(value);
    }),
  );

  const columnList = sql.raw(columns.map((c) => `"${c.name}"`).join(", "));
  const selectList = sql.raw(
    columns.map((c, i) => `json_extract(value, '$[${i}]') AS "${c.name}"`).join(", "),
  );

  return sql`INSERT INTO ${table} (${columnList}) SELECT ${selectList} FROM json_each(${JSON.stringify(driverRows)})`;
}
