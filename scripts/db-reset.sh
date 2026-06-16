#!/usr/bin/env bash
# Reset a Drizzle SQLite package's local database: delete the DB file, re-push
# the schema, then seed if the package ships a seed file. Shared by the osn/db,
# pulse/db, and zap/db `db:reset` package scripts — each passes its own DB-url
# env-var name and default path.
#
# Runs in the caller's cwd (the package dir, set by `bun run`) on purpose, so
# the `bun run db:push` / `db:seed` calls resolve that package's own scripts and
# the default path stays relative to it.
#
# Usage: bash ../../scripts/db-reset.sh <DB_URL_ENV_VAR> <default-db-path>
set -euo pipefail

env_var="${1:?db-reset: missing DB url env-var name}"
default_path="${2:?db-reset: missing default db path}"

# Indirect expansion: honour the env override if set, else the default path.
db_path="${!env_var:-$default_path}"

rm -f "$db_path"
bun run db:push
if [ -f src/seed.ts ]; then
  bun run db:seed
else
  echo "db:reset: no seed file, skipping"
fi
