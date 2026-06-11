---
"@cire/api": minor
"@shared/crypto": patch
"@shared/osn-auth-client": patch
---

Wire the cire/api runtime to a real Drizzle D1 client so the Worker can
build and deploy (previously a 503 stub that only ran locally via
`bun run dev:local`).

- `cire/api/src/index.ts` is now a real Workers `fetch` handler that
  constructs a per-request Drizzle D1 client from `env.DB` and serves the
  Hono app. Missing `DB` binding → 503.
- The `Db` type is broadened over both SQLite result kinds
  (`BaseSQLiteDatabase<"sync" | "async", …>`) so the same service code runs
  on `bun:sqlite` (synchronous — local dev + tests, unchanged) and D1
  (asynchronous — production). A small `dbQuery` helper bridges the
  sync/async split inside `Effect.gen`; the import-apply block now awaits
  each statement in FK order.
- `@shared/crypto`: pure ES256 key/JWK helpers (`importKeyFromJwk`,
  `generateArcKeyPair`, `exportKeyToJwk`, `thumbprintKid`, `ArcTokenError`)
  moved into a new DB-free `@shared/crypto/jwk` entry point. `arc.ts` and
  the barrel re-export them, so existing call sites are unchanged.
- `@shared/osn-auth-client` imports `importKeyFromJwk` from
  `@shared/crypto/jwk` instead of the barrel — this severs the
  `arc.ts → @osn/db → bun:sqlite` chain from the JWKS-verification path so
  the cire Worker (which runs `osnAuth`) bundles without `bun:sqlite`.

Local dev and the test suite still use `bun:sqlite` in-memory — no change
to that workflow.
