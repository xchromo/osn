---
"@osn/api": patch
---

Fix two compare-and-swap gates that read the wrong rows-affected field on D1 —
refresh rotation and passkey rename both failed on every production call.

Drizzle reports rows affected differently per driver: bun:sqlite and
better-sqlite3 use `{ changes }`, libsql uses `{ rowsAffected }`, and Cloudflare
D1 uses `{ success, meta: { changes }, results }`. Both call sites read
`changes ?? rowsAffected ?? 0`. Tests run on bun:sqlite and production runs on
D1, so the gates were green in CI and read 0 for every write in production.

- **Refresh rotation** (`services/auth/tokens.ts`). The old-session `DELETE` is
  the CAS; 0 rows means "a concurrent grant won the race". Reading 0 every time
  meant every production refresh deleted the session it was renewing, skipped
  the replacement INSERT, and answered `400 invalid_grant`. Access tokens live
  five minutes, so every session died at the first refresh — the long-standing
  "logged out for no reason" report. Prod backs this up: no session row has ever
  had `last_used_at` move past `created_at`.
- **Passkey rename** (`services/auth/passkey-management.ts`). Same read, so a
  rename that updated the row still answered "Passkey not found".

Both now go through `lib/rows-changed.ts`, which knows all three shapes.
Regression tests drive each gate through a driver proxy that reports counts
D1-style, and unit tests cover every shape plus junk input.
