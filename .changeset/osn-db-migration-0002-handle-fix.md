---
"@osn/db": patch
---

Fix the `0002_add_user_handle` migration data-copy: the `SELECT` referenced
`handle` from the pre-migration `users` table (which has no such column yet),
failing with `no such column: handle`. Drop the `COALESCE(handle, …)`
self-reference and seed the new column from the literal `'usr_' || substr(id, 5)`
only, so the migration applies cleanly to a fresh D1.
