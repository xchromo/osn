---
"@cire/db": patch
"@cire/api": patch
---

DRY the cire dev/test seed onto a single source of truth.

The seed data was previously hand-mirrored in two places that could silently
drift: `cire/api/src/data/{events,guests}.json` (seeded into the in-process
bun:sqlite DB for local dev + the `@cire/api` test suite) and
`cire/db/seed/dev-seed.sql` (the local-D1 seed). The JSON fixtures are now gone;
the canonical data lives as TS in `cire/db/seed/data/` (`events.ts`, `guests.ts`,
`wedding.ts`), barrelled and exported as `@cire/db/seed`.

`setup.ts#seedDb` and the route/service tests import `@cire/db/seed`, and
`dev-seed.sql` is now a generated artifact emitted from the same modules via
`cire/db/seed/generate.ts` (`bun run --cwd cire/db seed:generate`). A drift guard
(`seed/seed.test.ts`, wired as `seed:check`) fails CI if the committed SQL ever
diverges from the canonical data, so the two consumers can no longer drift.

Dev-only / test-only — no production behaviour changes. The seeded bun:sqlite
state is byte-identical to before (family/guest ids are still minted via
`crypto.randomUUID()` in `seedDb`).
