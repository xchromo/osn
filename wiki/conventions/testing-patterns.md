---
title: Testing Patterns
description: Test conventions, patterns, and examples for the OSN monorepo
tags: [convention, testing]
related:
  - "[[backend-patterns]]"
  - "[[schema-layers]]"
  - "[[commands]]"
last-reviewed: 2026-08-02
---

# Testing Patterns

## Directory Layout

Test files live in `tests/` at the package root and mirror the `src/` structure:

```
pulse/api/
  tests/
    helpers/db.ts                  # createTestLayer() -- shared test utility
    services/events.test.ts        # Effect service tests
    routes/events.test.ts          # HTTP integration tests
osn/api/
  tests/
    helpers/db.ts                  # createTestLayer() for osn/db (accounts, profiles, passkeys, sessions)
    services/auth.test.ts          # Effect service tests
    routes/auth.test.ts            # HTTP integration tests
pulse/db/
  tests/
    schema.test.ts                 # Schema smoke tests
osn/ui/
  tests/
    auth/Register.test.tsx          # Shared Register component (Solid + happy-dom)
    auth/SignIn.test.tsx            # Shared SignIn component (passkey-only)
    auth/RecoveryLoginForm.test.tsx # Lost-passkey recovery flow
    auth/StepUpDialog.test.tsx      # Sudo-token ceremony for sensitive actions
    auth/SessionsView.test.tsx      # Session list / revoke
    auth/PasskeysView.test.tsx      # Passkey management
```

## Service Test Pattern

Service tests use `it.effect` from `@effect/vitest` with an isolated DB per test via `Effect.provide(createTestLayer())`.

```typescript
// Service tests: it.effect from @effect/vitest, isolated DB per test
import { it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { createTestLayer } from "../helpers/db";

it.effect("creates event with evt_ prefix", () =>
  Effect.gen(function* () {
    const event = yield* createEvent({ title: "Test", startTime: "2030-06-01T10:00:00.000Z" });
    expect(event.id).toMatch(/^evt_/);
  }).pipe(Effect.provide(createTestLayer()))
);
```

### Error Assertion Pattern

Use `Effect.flip` to promote errors to the success channel for assertion:

```typescript
// Error assertions: use Effect.flip to promote errors to success channel
it.effect("fails with EventNotFound", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(getEvent("nonexistent"));
    expect(error._tag).toBe("EventNotFound");
  }).pipe(Effect.provide(createTestLayer()))
);
```

## Route Test Pattern

Route tests use plain vitest with a fresh app per test via `beforeEach`:

```typescript
// Route tests: plain vitest, fresh app per test via beforeEach
import { describe, it, expect, beforeEach } from "vitest";
import { createEventsRoutes } from "../../src/routes/events";

describe("events routes", () => {
  let app: ReturnType<typeof createEventsRoutes>;
  beforeEach(() => { app = createEventsRoutes(createTestLayer()); });

  it("GET /events -> 200", async () => {
    const res = await app.handle(new Request("http://localhost/events"));
    expect(res.status).toBe(200);
  });
});
```

## Rules

- **All tests use in-memory SQLite** -- no file DB, no migrations needed. Each test gets a fresh database via `createTestLayer()`.

- **Service tests: `it.effect` + `Effect.provide(createTestLayer())` per test.** Every test gets full isolation. Never share state between tests.

- **Route tests: `createXxxRoutes(createTestLayer())` in `beforeEach`.** Full isolation per test. The route factory accepts an optional `dbLayer` param for injection; the default is `DbLive`.

- **OSN auth routes use `createAuthRoutes(authConfig, dbLayer?)`.** The `authConfig` parameter is required (no global default). `dbLayer` defaults to `DbLive`.

- **Use `bunx --bun vitest`** (not plain `vitest`) -- the flag is required for `bun:sqlite` module access. The `test:run` scripts in `package.json` already set it.

- **Use future dates for test events.** For example, `2030-06-01T10:00:00.000Z`. The default `listEvents` implementation filters out past events, so tests with past dates will produce confusing empty results.

- **Never hand-write a DDL mirror.** Test databases are built from the live Drizzle schema via `applySchema()` (`@osn/db/testing`, `@pulse/db/testing`, `@zap/db/testing`) — never a `CREATE TABLE` string in a helper or a test file. A hand-written mirror makes constraint tests tautological: they assert the `UNIQUE` the author typed a few lines above, not the one the schema declares, so dropping `.unique()` from `src/schema` leaves them green. See [[#Schema-derived test databases]].

- **A test must fail for the reason it is named.** Before landing a test that asserts a side effect (a row written, a notice sent), break the code path and confirm the test goes red. `expect(true).toBe(true)` after an action asserts nothing.

## Schema-derived test databases

Every DB package exports an emitter that builds `CREATE TABLE`/`CREATE INDEX` from the live Drizzle schema:

```typescript
import { applySchema } from "@osn/db/testing"; // or @pulse/db, @zap/db

const sqlite = new Database(":memory:");
applySchema(sqlite);
```

Adding a column is then a one-file change in `src/schema/`. The emitter carries column-level `.unique()` (via `col.isUnique`) and partial-index `WHERE` clauses — both were silently dropped before 2026-08, so tests ran on a shape production D1 rejects.

`osn/db/tests/ddl-lockstep.test.ts` diffs a normalised structural snapshot of the emitted schema against the full `osn/db/drizzle/*.sql` migration chain (columns, defaults, indexes, partial predicates). It fails when a migration lands without a schema change, when a schema change lands without a migration, or when the emitter loses a constraint. `cire/api/src/db/ddl-lockstep.test.ts` does the same for cire's three-way mirror.

**If you extend one emitter, extend all three** — they are copies, and only osn's is lockstep-guarded.

## Shared test harnesses

Reach for these before hand-rolling setup:

| Harness | Use for |
|---|---|
| `@shared/crypto/testing` → `makeAccessTokenSigner()` | ES256 OSN access tokens (`aud: "osn-access"`). Returns `{ privateKey, publicKey, sign(profileId, claims?) }`. `claims` covers `email`, `audience`, `expiresIn`, `kid` for negative tests. Used by the pulse, zap and cire route suites. |
| `cire/api/src/test-helpers/osn-token.ts` → `makeOsnTestAuth()` | The cire-shaped `{ key, sign }` adapter over the above. |
| `cire/api/src/test-helpers.ts` → `appRequest()` | Elysia requests with `cf-connecting-ip` + `Origin` pre-injected. |
| `cire/organiser/src/test-support/mocks.ts` | The `@shared/rp-auth/solid` + `solid-toast` + `lib/api` mock trio and their spies. |
| `pulse/app/tests/helpers/toast.ts` → `solidToastMock()` | Same idea for the Pulse app. |

Call `makeAccessTokenSigner()` once per suite in `beforeAll` — there is no reason to re-key per test.

`vi.mock` is hoisted per module, so registration stays in the test file; only the factory body is shared. Use the dynamic-import form so the factory never reads an uninitialised binding:

```typescript
vi.mock("../lib/api", async () => {
  const { organiserApiMock } = await import("../test-support/mocks");
  return organiserApiMock();
});
import { authFetchMock, redirectSpy } from "../test-support/mocks";
```

A suite that genuinely needs a different shape (an extra `useAuth` field, an `importOriginal` spread) keeps its own local mock. These harnesses cover the common case; they are not a mandate.

## Running Tests

```bash
# All tests
bun run test

# Package-specific (run once)
bun run --cwd pulse/api test:run
bun run --cwd osn/api test:run
bun run --cwd osn/client test:run
bun run --cwd osn/ui test:run
bun run --cwd pulse/db test:run
bun run --cwd zap/api test:run
bun run --cwd zap/db test:run

# Watch mode
bun run --cwd pulse/api test
```

## Related

- [[backend-patterns]] -- service and route layer architecture
- [[schema-layers]] -- Elysia TypeBox vs Effect Schema
- [[commands]] -- full CLI reference
