---
"@osn/api": minor
"@osn/client": patch
"@osn/db": patch
"@pulse/api": minor
"@pulse/db": patch
"@shared/crypto": patch
"@shared/db-utils": patch
"@shared/observability": minor
"@shared/redis": minor
"@zap/api": minor
"@zap/db": patch
---

In-range minor bumps:

- `effect` 3.19.19 → 3.21.2 (11 workspaces)
- `elysia` 1.2.0 → 1.4.28 + `@elysiajs/eden` 1.2.0 → 1.4.9
- `@simplewebauthn/server` 13.1.1 → 13.3.0
- `ioredis` 5.6.0 → 5.10.1
- `happy-dom` 20.8.4 → 20.9.0
- `better-sqlite3` 12.5.0 → 12.9.0 (SQLite 3.51.1 → 3.53.0)
- OpenTelemetry stable cluster 2.0.0 → 2.7.0 (`resources`, `sdk-metrics`, `sdk-trace-base`, `sdk-trace-node`) — note: `OTEL_RESOURCE_ATTRIBUTES` parsing tightened in 2.6.0 (the entire env var is dropped on any invalid entry; whitespace must be percent-encoded). Audit deployment configs.
- `@opentelemetry/semantic-conventions` 1.34.0 → 1.40.0
- Root tooling: `turbo` 2.9.6, `oxlint` 1.61.0, `lefthook` 2.1.6, `@changesets/cli` 2.31.0
