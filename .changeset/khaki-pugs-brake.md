---
"@shared/crypto": patch
"@osn/db": patch
"@osn/api": patch
"@pulse/db": patch
"@pulse/api": patch
"@zap/db": patch
"@zap/api": patch
---

Fix two silent DDL-emitter defects and consolidate test harnesses

The schema-reflection emitters in `@osn/db/testing`, `@pulse/db/testing` and
`@zap/db/testing` dropped two kinds of constraint when building test databases:

- **Column-level `UNIQUE`.** `emitColumn()` read only the table config's
  `uniqueConstraints` (table-level `unique()`), never `col.isUnique`, where
  Drizzle records column-level `.unique()`. Seven OSN constraints were missing
  from every test database — `accounts.email`, `accounts.passkey_user_id`,
  `users.handle`, `passkeys.credential_id`, `recovery_codes.code_hash`,
  `organisations.handle`, `oauth_clients.client_id` — including the Miniflare
  D1 that `osn/api/src/d1-integration.test.ts` builds, so the only test proving
  OSN core runs on real D1 ran against a schema accepting duplicates.
- **Partial-index `WHERE` clauses.** Four OSN partial indexes were emitted as
  full indexes, and `deletion_jobs`' pulse/zap pending pair collapsed into a
  single duplicate.

`osn/db/tests/ddl-lockstep.test.ts` (new) diffs a normalised structural
snapshot of the emitted schema against the full `osn/db/drizzle/*.sql`
migration chain and fails on either divergence. Both fixes are applied to all
three emitter copies; pulse and zap were unaffected in practice (neither schema
uses column-level `.unique()` or partial indexes today) but carried the same
latent trap.

Also in this change:

- `osn/db/tests/schema.test.ts` builds its fixture with `applySchema()` instead
  of a hand-written `CREATE TABLE` block. Its three "enforces unique …
  constraint" tests previously asserted against DDL typed in the same file, so
  removing every `.unique()` from `osn/db/src/schema` left all 50 tests green;
  they now fail as intended.
- `osn/api/tests/helpers/db.ts` drops 239 lines of hand-maintained DDL for the
  same `applySchema()` call.
- New `@shared/crypto/testing` export with `makeAccessTokenSigner()`, replacing
  the duplicated ES256 key-pair + `makeToken` block in 12 pulse/zap route
  suites; `@cire/api`'s `makeOsnTestAuth()` becomes a thin adapter over it.
- `pulse/api/tests/services/rsvps.test.ts` — the test named "upsertRsvp ensures
  pulse_users row is created" asserted `expect(true).toBe(true)`; it now queries
  `pulse_users`.
- `zap/api/src/d1-integration.test.ts` — repaired a stale fixture that had been
  failing unnoticed: it created a DM as a bare `{ type: "dm" }`, predating the
  Z3 "a DM is exactly two people" guard and the Z4 consent gate. Nothing caught
  it because the D1 integration lane runs outside the default vitest include and
  no CI workflow invokes `test:d1` — tracked as T-C1 in `wiki/TODO.md`.
