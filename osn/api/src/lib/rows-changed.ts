/**
 * Rows changed by a Drizzle write, normalised across the drivers this API
 * runs on.
 *
 * The shape differs per driver and none of them agree:
 *
 * - bun:sqlite / better-sqlite3 → `{ changes }`
 * - libsql                      → `{ rowsAffected }`
 * - Cloudflare D1               → `{ success, meta: { changes, ... } }`
 *
 * Tests run on bun:sqlite, production runs on D1. Reading only the top-level
 * fields therefore passes every test and returns 0 for every write in
 * production — which silently inverted two compare-and-swap gates (refresh
 * rotation, passkey rename) into always-fail. Every rows-affected check must
 * go through here.
 */
export function rowsChanged(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const r = result as {
    changes?: number;
    rowsAffected?: number;
    meta?: { changes?: number } | null;
  };
  return r.meta?.changes ?? r.changes ?? r.rowsAffected ?? 0;
}
