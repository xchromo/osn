/**
 * Guard the D1 cost of building a database from its migration chain.
 *
 * WHAT THIS IS FOR. The cire dev deploy crossed a hard free-tier ceiling by
 * growing, not by breaking. Every `ALTER TABLE ... DROP COLUMN` added to the
 * chain made each from-zero rebuild a little more expensive, and on 2026-09-09
 * thirteen merges spent 104,091 D1 rows written against a limit of 100,000 a
 * day across the whole account (xchromo/osn#979). No commit was wrong and no
 * test failed. This guard puts a committed number in front of that growth, the
 * way `scripts/guard-bundle-size.sh` puts one in front of a bundle.
 *
 * THE TWO RULES, from wiki/conventions/bundle-size-guards.md, unchanged:
 *
 *   1. A budget is a number somebody chose, re-baselined deliberately, with
 *      the reason in the commit. It lives in one committed file the guard
 *      reads — scripts/d1-migration-cost-budgets.txt — never as an argument at
 *      a call site.
 *   2. A guard that only ever gets raised is not a guard. Raising it is a
 *      decision with a paragraph attached, not a lockfile refresh. This guard
 *      has a second answer the bundle one does not: squashing the chain into a
 *      fresh baseline puts the number back DOWN, which is what
 *      xchromo/osn#984 did. Reach for that first.
 *
 * HOW IT MEASURES. Offline, with no D1 call: it replays every `.sql` file in
 * the chain into an in-memory `bun:sqlite` database and counts SCHEMA WRITES.
 * One per statement that changes the schema; two for a statement that makes
 * SQLite rebuild a whole table (`ALTER TABLE ... DROP COLUMN`). Rows that a
 * data statement in a migration actually writes are counted exactly, from
 * SQLite's own `changes`.
 *
 * WHY THAT CORRELATES WITH D1's BILL. A from-zero rebuild runs against empty
 * tables, so the bill is almost all schema churn — of the 200 heaviest queries
 * on `cire-db-dev` in the week to 2026-09-10, schema statements were 89% of
 * rows written and the seed's inserts were 11%. SQLite rebuilds the whole
 * table for every dropped column and D1 bills that against no data at all, so
 * each schema statement costs a roughly fixed number of rows whatever the
 * table holds. Two remote measurements fix the constant, and one constant fits
 * both:
 *
 *   - one `ALTER TABLE ... DROP COLUMN` on `wedding_invite_customisations`,
 *     against a table with no rows in it, cost 54 rows written — two schema
 *     writes at 27 apiece, exactly;
 *   - the 57-file chain squashed by xchromo/osn#984 measures 269 schema
 *     writes here, which at 27 apiece predicts 7,265 rows. The rebuild that
 *     replayed it cost 8,007 rows written in total, of which the 89% schema
 *     share is 7,126. The prediction is 2.0% high.
 *
 * High is the safe side, and the two together also reproduce the figure the
 * incident was reported with: 7,265 for the chain plus the seed's share is
 * 8,007, and 100,000 / 8,007 is the 12 full rebuilds a day that chain afforded.
 *
 * HOW TIGHT THAT IS, HONESTLY. Two anchor points, both from one database in
 * one week, fitted with one constant. It is not a regression and it does not
 * model D1's accounting; it asserts that a schema statement has a roughly
 * fixed price, which those two points and the 89/11 split support and nothing
 * here proves. Treat the printed row count as an estimate good to about ±10%
 * and the schema-write count as the exact thing being guarded. The estimate
 * also folds in the per-file `d1_migrations` ledger insert that
 * `wrangler d1 migrations apply` makes, since the calibration chain paid for
 * 57 of those — which over-charges a short chain slightly, again on the safe
 * side.
 *
 * WHAT IS NOT IN THE NUMBER. The seed. This guard prices the chain, because
 * the chain is what a pull request changes; a full dev rebuild drops, replays
 * and then seeds, and the seed is a further tenth or so on top.
 *
 * The read ceiling is not guarded either. It is 5,000,000 a day against
 * 100,000 written, and the same rebuild that spent 8% of the write allowance
 * spent 0.5% of the read one, so writes are the binding constraint and a
 * second threshold would only be a second number to keep true.
 *
 * Usage:
 *   guard-d1-migration-cost.ts --all              every row in the budgets
 *                                                 file. What ci.yml calls.
 *   guard-d1-migration-cost.ts <migrations-dir>   one chain, matched to its
 *                                                 row by repo-relative path.
 *
 * D1_MIGRATION_COST_BUDGETS_FILE overrides the budgets file path, and
 * D1_MIGRATION_COST_BUDGETS_ROOT the root each row's path resolves against
 * (the repo root in real use; a fixture tree in the tests).
 */

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Rows written on D1 per schema write, calibrated against the two remote
 * measurements in this file's header. Changing it changes every printed
 * estimate and every headroom figure, so it is a re-baseline of the same
 * weight as a budget row.
 */
export const ROWS_WRITTEN_PER_SCHEMA_WRITE = 27;

/**
 * Cloudflare D1 Free, rows written per day, shared across every database on
 * the account. wiki/runbooks/free-tier-limits.md is the source and says to
 * re-verify it against Cloudflare's own pricing page before acting on it.
 */
export const DAILY_ROWS_WRITTEN_CEILING = 100_000;

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export type ChainCost = {
  readonly files: number;
  readonly statements: number;
  /** Schema statements, with a table-rebuilding one counted twice. */
  readonly schemaWrites: number;
  /** Statements that rebuild a table, for the reader — not a separate charge. */
  readonly tableRebuilds: number;
  /** Rows a data statement in a migration really wrote, from SQLite. */
  readonly dataRows: number;
  readonly estimatedRowsWritten: number;
};

export type BudgetRecord = {
  readonly chain: string;
  readonly budget: number;
};

/**
 * Split a Drizzle migration file into single statements.
 *
 * Drizzle writes `--> statement-breakpoint` between statements, but not
 * between every pair of them — the archived cire chain held 283 statements
 * behind 222 breakpoints — so `;` has to be a separator too. Splitting on a
 * bare `;` would cut a statement in half the moment a column default or a
 * `CHECK` held one, so this walks the text: single-quoted strings (with `''`
 * escapes), the three identifier quotings SQLite accepts, line comments,
 * block comments, and a trigger's `BEGIN ... END;` body all swallow their
 * semicolons.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let index = 0;
  let triggerDepth = 0;

  const flush = () => {
    const trimmed = stripComments(current).trim();
    if (trimmed.length > 0) statements.push(trimmed);
    current = "";
  };

  /** Whether what has accumulated so far opens a body ended by `END`. */
  const opensTriggerBody = () =>
    /\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(stripComments(current));

  while (index < sql.length) {
    const char = sql[index]!;
    const rest = sql.slice(index);

    if (char === "'" || char === '"' || char === "`") {
      const end = closingQuote(sql, index, char);
      current += sql.slice(index, end);
      index = end;
      continue;
    }
    if (char === "[") {
      const end = sql.indexOf("]", index + 1);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }
    if (rest.startsWith("--")) {
      const lineEnd = sql.indexOf("\n", index);
      const stop = lineEnd === -1 ? sql.length : lineEnd;
      const comment = sql.slice(index, stop);
      // The breakpoint marker is written as a comment, so it has to be
      // recognised here rather than after comments are stripped.
      if (/^-->\s*statement-breakpoint/.test(comment)) {
        flush();
        triggerDepth = 0;
      } else {
        current += comment;
      }
      index = stop;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }
    if (/^BEGIN\b/i.test(rest) && (triggerDepth > 0 || opensTriggerBody())) {
      triggerDepth += 1;
      current += rest.slice(0, 5);
      index += 5;
      continue;
    }
    if (triggerDepth > 0 && /^END\b/i.test(rest)) {
      triggerDepth -= 1;
      current += rest.slice(0, 3);
      index += 3;
      continue;
    }
    if (char === ";" && triggerDepth === 0) {
      flush();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  flush();
  return statements;
}

/** Index just past the closing quote of the run starting at `open`. */
function closingQuote(sql: string, open: number, quote: string): number {
  let index = open + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      // A doubled quote is an escaped one and the run continues.
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

function stripComments(sql: string): string {
  return sql
    .replaceAll(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const at = indexOfUnquoted(line, "--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** Where `needle` first sits outside any quoted run of `line`. */
function indexOfUnquoted(line: string, needle: string): number {
  let index = 0;
  while (index < line.length) {
    const char = line[index]!;
    if (char === "'" || char === '"' || char === "`") {
      index = closingQuote(line, index, char);
      continue;
    }
    if (line.startsWith(needle, index)) return index;
    index += 1;
  }
  return -1;
}

const SCHEMA_STATEMENT = /^(?:CREATE|DROP|ALTER)\b/i;
/**
 * `ALTER TABLE <name> DROP [COLUMN] <name>`. SQLite implements this by
 * rebuilding the table, which is the statement D1 bills at about twice an
 * ordinary schema write. Anchored on the two names either side of `DROP` so a
 * column default that merely contains the word does not match.
 */
const TABLE_REBUILD = /^ALTER\s+TABLE\s+\S+\s+DROP\s+(?:COLUMN\s+)?\S/i;
/**
 * Drizzle's other table rebuild: copy into `__new_x`, drop `x`, rename. Each
 * of its statements already costs a schema write of its own, so this only
 * counts them for the reader.
 */
const REBUILD_SCRATCH_TABLE = /\b__(?:new|keep)_/i;

/** One statement's contribution, ready to sum. */
type Charge = {
  readonly schemaWrites: number;
  readonly rebuild: boolean;
};

function chargeFor(statement: string): Charge {
  const normalised = statement.replaceAll(/\s+/g, " ").trim();
  if (!SCHEMA_STATEMENT.test(normalised)) return { schemaWrites: 0, rebuild: false };
  if (TABLE_REBUILD.test(normalised)) return { schemaWrites: 2, rebuild: true };
  return { schemaWrites: 1, rebuild: REBUILD_SCRATCH_TABLE.test(normalised) };
}

/**
 * Replay a chain into an in-memory database and total what a from-zero
 * rebuild of it costs. Throws when a statement does not apply: a chain that
 * cannot build is a failure, not a cheap chain.
 */
export function measureChain(dir: string): ChainCost {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`${dir} holds no .sql migrations — nothing was measured, which is not a pass.`);
  }

  const db = new Database(":memory:");
  try {
    // Off for the same reason `wrangler d1 migrations apply` gets away with
    // the rebuild idiom: a chain that drops and recreates a parent table
    // would otherwise fail on its children mid-replay.
    db.run("PRAGMA foreign_keys=OFF");

    let statements = 0;
    let schemaWrites = 0;
    let tableRebuilds = 0;
    let dataRows = 0;

    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      for (const statement of splitSqlStatements(sql)) {
        let changes = 0;
        try {
          changes = Number(db.run(statement).changes ?? 0);
        } catch (cause) {
          throw new Error(
            `${file} failed to apply: ${String(cause)}\n  statement: ${statement.slice(0, 200)}`,
            { cause },
          );
        }
        statements += 1;
        const charge = chargeFor(statement);
        schemaWrites += charge.schemaWrites;
        if (charge.rebuild) tableRebuilds += 1;
        if (charge.schemaWrites === 0) dataRows += changes;
      }
    }

    return {
      files: files.length,
      statements,
      schemaWrites,
      tableRebuilds,
      dataRows,
      estimatedRowsWritten: schemaWrites * ROWS_WRITTEN_PER_SCHEMA_WRITE + dataRows,
    };
  } finally {
    db.close();
  }
}

/** How many from-zero rebuilds of this cost fit in one day's allowance. */
export function rebuildsPerDay(rowsWritten: number): number {
  if (rowsWritten <= 0) return DAILY_ROWS_WRITTEN_CEILING;
  return Math.floor(DAILY_ROWS_WRITTEN_CEILING / rowsWritten);
}

/**
 * Parse the budgets file. Fails closed on any malformed row rather than
 * skipping it — one bad edit should not quietly stop guarding every chain
 * after it.
 */
export function parseBudgets(contents: string, label: string): readonly BudgetRecord[] {
  const records: BudgetRecord[] = [];
  const lines = contents.split("\n");

  for (const [offset, line] of lines.entries()) {
    const stripped = line.split("#")[0]!.trim();
    if (stripped.length === 0) continue;
    const fields = stripped.split(/\s+/);
    const [chain, budget, ...extra] = fields;
    if (chain === undefined || budget === undefined || extra.length > 0) {
      throw new Error(
        `${label}:${offset + 1}: expected '<migrations-dir> <budget-rows-written>', got '${stripped}'`,
      );
    }
    if (!/^\d+$/.test(budget)) {
      throw new Error(`${label}:${offset + 1}: budget must be a positive integer, got '${budget}'`);
    }
    records.push({ chain, budget: Number(budget) });
  }

  if (records.length === 0) {
    throw new Error(`${label} has no records — nothing to guard, which is a broken config.`);
  }
  return records;
}

function percentOfCeiling(rows: number): string {
  return `${((rows / DAILY_ROWS_WRITTEN_CEILING) * 100).toFixed(1)}%`;
}

/** Runs one record. Returns true when the chain is inside its budget. */
export function runGuard(chain: string, dir: string, budget: number, budgetsPath: string): boolean {
  const cost = measureChain(dir);
  const rows = cost.estimatedRowsWritten;
  const affordable = rebuildsPerDay(rows);

  console.log(
    `${chain}: ${cost.files} migration file(s), ${cost.statements} statements, ` +
      `${cost.schemaWrites} schema writes, ${cost.tableRebuilds} table-rebuild statement(s)`,
  );
  console.log(
    `  replaying the chain from zero costs about ${rows} D1 rows written ` +
      `(${percentOfCeiling(rows)} of the ${DAILY_ROWS_WRITTEN_CEILING}/day free-tier ceiling)`,
  );
  console.log(`  that affords ${affordable} replay(s) a day, before the seed a full rebuild adds`);
  console.log(
    `  budget ${budget} rows written (${rebuildsPerDay(budget)} a day), ` +
      `${budget - rows} rows of headroom`,
  );

  if (rows > budget) {
    console.error(
      `::error::${chain} costs about ${rows} D1 rows written to replay from zero, over the ` +
        `${budget} row budget in ${budgetsPath}. That affords ${affordable} replays a day ` +
        `against the ${DAILY_ROWS_WRITTEN_CEILING} rows/day free-tier ceiling, down from ` +
        `${rebuildsPerDay(budget)} at the budget. The chain has grown, which is what this guard ` +
        `watches: squash it into a fresh baseline the way xchromo/osn#984 did, or raise the ` +
        `budget deliberately with the reason in the commit.`,
    );
    return false;
  }
  return true;
}

type LoadedBudgets = {
  readonly path: string;
  readonly records: readonly BudgetRecord[];
};

function resolveBudgetsPath(): string {
  return (
    process.env.D1_MIGRATION_COST_BUDGETS_FILE ?? join(SCRIPT_DIR, "d1-migration-cost-budgets.txt")
  );
}

function budgetsRoot(): string {
  return process.env.D1_MIGRATION_COST_BUDGETS_ROOT ?? REPO_ROOT;
}

function loadBudgets(): LoadedBudgets {
  const path = resolveBudgetsPath();
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`budgets file not found: ${path}`, { cause });
  }
  return { path, records: parseBudgets(contents, path) };
}

function main(argv: readonly string[]): number {
  if (argv.length !== 1) {
    console.error(
      "::error::usage: guard-d1-migration-cost.ts --all | guard-d1-migration-cost.ts <migrations-dir>",
    );
    return 1;
  }

  let path: string;
  let records: readonly BudgetRecord[];
  try {
    ({ path, records } = loadBudgets());
  } catch (cause) {
    console.error(
      `::error::guard-d1-migration-cost.ts: ${String(cause instanceof Error ? cause.message : cause)}`,
    );
    return 1;
  }

  const root = budgetsRoot();
  const target = argv[0]!;
  const selected =
    target === "--all"
      ? records
      : records.filter((record) => resolve(root, record.chain) === resolve(target));

  if (selected.length === 0) {
    console.error(
      `::error::guard-d1-migration-cost.ts: no budget recorded for '${target}' in ${path} — ` +
        `add a row before wiring this chain to the guard.`,
    );
    return 1;
  }

  // Every record runs even after one fails, so a run reports every chain over
  // budget in one pass instead of stopping at the first.
  let failed = false;
  for (const record of selected) {
    const dir = resolve(root, record.chain);
    try {
      if (!statSync(dir).isDirectory()) throw new Error("not a directory");
    } catch {
      console.error(
        `::error::guard-d1-migration-cost.ts: migrations directory '${dir}' does not exist.`,
      );
      failed = true;
      continue;
    }
    try {
      if (!runGuard(record.chain, dir, record.budget, path)) failed = true;
    } catch (cause) {
      console.error(
        `::error::${record.chain}: ${String(cause instanceof Error ? cause.message : cause)}`,
      );
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
