# `@cire/db`

Drizzle schema, migrations, and dev-seed for the Cire D1 database.

## Layout

```
cire/db/
├── src/schema.ts         # Drizzle schema — single source of truth
├── drizzle.config.ts     # Drizzle Kit pointer to schema + migrations dir
├── migrations/           # Forward-only D1 migrations (committed)
│   ├── 0001_initial.sql
│   ├── 0002_add_rsvp_dietary.sql
│   ├── 0003_events_metadata_and_imports.sql
│   ├── 0004_perf_indices.sql
│   └── meta/_journal.json
└── seed/
    ├── data/             # Canonical seed data (TS) — single source of truth
    │   ├── events.ts     #   sample-wedding events
    │   ├── guests.ts     #   families + guests + invitations
    │   ├── wedding.ts    #   sample-wedding row
    │   └── index.ts      #   barrel, exported as `@cire/db/seed`
    ├── generate.ts       # Emits dev-seed.sql from data/ (`seed:generate` / `seed:check`)
    ├── seed.test.ts      # Fails if dev-seed.sql drifts from data/
    └── dev-seed.sql      # GENERATED Local-D1 dev seed (do not hand-edit)
```

## Scripts

Run from anywhere in the repo via the root aliases (`bun run db:push`, etc.) or
directly inside `packages/db`. Wrangler reads `apps/api/wrangler.toml` via the
`--config` flag baked into each script.

| Script           | What it does                                                                           |
| ---------------- | -------------------------------------------------------------------------------------- |
| `db:generate`    | `drizzle-kit generate` — diff `schema.ts` against the latest migration, emit a new one |
| `db:push`        | Apply all pending migrations to the **local** D1 (Miniflare-backed)                    |
| `db:push:remote` | Apply all pending migrations to the **production** D1. Coordinate with deploys.        |
| `db:seed`        | Apply `seed/dev-seed.sql` to the local D1 (idempotent — uses `INSERT OR IGNORE`)       |
| `db:reset`       | Wipe local D1 state, re-run migrations + seed. Destructive — local only.               |
| `db:studio`      | Launch Drizzle Studio for browsing the schema / writing one-off queries                |
| `seed:generate`  | Regenerate `seed/dev-seed.sql` from the canonical TS data in `seed/data/`              |
| `seed:check`     | Assert `seed/dev-seed.sql` is in sync with `seed/data/` (run in CI via `seed.test.ts`) |

### Typical flows

**First-time setup**

```bash
bun install
bun run db:reset          # creates local D1 from scratch and seeds it
bun --cwd apps/api run dev
```

**After editing `schema.ts`**

```bash
bun run db:generate       # produces packages/db/migrations/000N_<desc>.sql
bun run db:push           # applies it locally
# review + commit the new migration
```

**Refresh local data after pulling**

```bash
bun run db:reset
```

## Seed contents

`seed/data/` is the **single source of truth** for the dev/test seed. Both
consumers derive from it, so they can never drift:

- `cire/api/src/db/setup.ts#seedDb` imports `@cire/db/seed` to seed the
  in-process bun:sqlite DB used by local dev + the `@cire/api` test suite.
- `seed/generate.ts` emits `seed/dev-seed.sql` (the local-D1 seed applied by
  `bun run db:seed`) from the same modules.

`seed/dev-seed.sql` is a **generated artifact** — never hand-edit it. Edit the
TS under `seed/data/` then run `bun run seed:generate`. `seed:check` (wired as
`seed.test.ts`, run by `bun run --cwd cire/db test`) fails if the committed SQL
drifts from the canonical data, so CI catches a stale seed.

Seeded shape:

- **5 events** (Catholic / Kitchen Tea / Mehendi / Hindu / Reception, Oct–Nov 2026, Sydney)
- **4 families** with stable UUIDs:
  - `TESTONE-IVY-AA11` — Testfamily (Ada)
  - `TESTTWO-OAK-BB22` — Sampleton (Bo, Cleo, Dot)
  - `TESTTRE-DEW-CC33` — Exampleton (Nori)
  - `TESTFOR-JOY-DD44` — Placeholder (Eli)
- **6 guests** + **15 invitation links** (per-event-per-guest)

Use `TESTFOR-JOY-DD44` as the dev claim code (Eli is invited to all five events).

## Conventions

- D1 migrations are **forward-only**. No `DOWN` blocks. To retire a column, copy data into a new table and add a `DROP TABLE` / `ALTER` migration that performs the swap.
- After editing `schema.ts` AND any wrangler binding, regenerate types: `bunx wrangler --config apps/api/wrangler.toml types`.
- The dev seed is **not** applied to remote D1. Production data flows in via the organiser spreadsheet import (`/api/organiser/import/{preview,apply}`).
