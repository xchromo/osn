---
title: auth.ts Refactor Plan
tags:
  - architecture
  - refactor
  - auth
  - planning
related:
  - "[[backend-patterns]]"
  - "[[identity-model]]"
  - "[[sessions]]"
  - "[[step-up]]"
  - "[[recovery-codes]]"
  - "[[passkey-primary]]"
  - "[[osn-api-worker-split]]"
last-reviewed: 2026-07-03
---

# auth.ts Refactor Plan

> Status: **planned, not started.** `osn/api/src/services/auth.ts` is ~4,480
> lines — the single largest maintainability/reviewability risk in the repo, and
> a prerequisite for a clean [[osn-api-worker-split]] (the identity Worker needs
> a crisp module boundary to extract).

## Goal & non-goal

**Goal:** split the one giant `createAuthService` factory into cohesive
per-concern modules, composed by a thin factory that preserves the *exact*
current public surface. **Non-goal:** any behavior change. This is a pure,
mechanical, behavior-preserving move — it must land as its own PR with **zero**
logic edits, so the diff is reviewable as "code moved, nothing changed", and the
existing 700+ osn-api tests pass untouched. Do NOT combine it with the security
fixes or any feature work.

## Current shape

`createAuthService(config)` closes over `config` + injected stores and returns
one large object of ~40 methods. Everything shares a handful of private helpers
(`signJwt`/`verifyJwt`, `generateSessionToken`/`hashSessionToken`, `genOtpCode`,
`hashIp`, the metric wrappers). The methods cluster cleanly by concern:

| Cluster | Representative methods |
|---|---|
| Token issuance/verify | `issueAccessToken`, `issueTokens`, `verifyAccessToken`, `signJwt`/`verifyJwt` |
| Registration | `beginRegistration`, `completeRegistration`, `checkHandle` |
| Passkey login | `beginPasskeyLogin`, `verifyPasskeyAssertion`, `completePasskeyLoginDirect` |
| Sessions / refresh | `verifyRefreshToken`, `refreshTokens`, rotation + reuse detection, session introspection/revoke |
| Step-up (sudo) | `issueStepUpToken`, `verifyStepUpToken`, `verifyStepUpForExternalPurpose` |
| Recovery codes | `generateRecoveryCodesForAccount`, `consumeRecoveryCode`, lockout |
| Email change | `beginEmailChange`, `completeEmailChange` |
| Cross-device login | begin/poll/approve/reject |
| Passkey management | register begin/complete, rename, delete |
| Profiles | `findDefaultProfile`, `switchProfile`, `listAccountProfiles` |

## Target structure

```
osn/api/src/services/auth/
  index.ts              # createAuthService — composes the sub-factories, returns the same object
  shared.ts             # config type, errors, private helpers (signJwt, token/hash, genOtpCode, hashIp), metric wrappers
  tokens.ts             # issueAccessToken / issueTokens / verifyAccessToken
  registration.ts       # begin/complete registration, checkHandle
  passkey-login.ts      # begin/verify/complete passkey login
  sessions.ts           # verifyRefreshToken, refreshTokens (+ rotation CAS + reuse detect), introspection/revoke
  step-up.ts            # issue/verify step-up, verifyStepUpForExternalPurpose
  recovery.ts           # generate/consume recovery codes + lockout
  email-change.ts       # begin/complete email change
  cross-device.ts       # CDL begin/poll/approve/reject
  passkey-mgmt.ts       # passkey register/rename/delete
  profiles.ts           # findDefaultProfile, switchProfile, listAccountProfiles
```

Each sub-module exports a factory `(ctx) => ({ ...methods })` where `ctx` is a
small shared context object built once in `index.ts`: `{ config, stores,
helpers, metrics }`. `createAuthService` calls each sub-factory and spreads the
results into the single returned object — so **every call site
(`auth.issueTokens`, `auth.refreshTokens`, …) stays identical** and no route,
test, or downstream import changes.

## Method

1. **Mechanical, in slices.** Move one cluster at a time (start with the leaf
   ones — `recovery`, `email-change`, `cross-device` — that few others depend
   on). After each move: `bun run --cwd osn/api test:run` must stay green. Never
   edit a line of logic while moving it; if a move surfaces a real bug, note it
   and fix it in a *separate* follow-up commit, not the refactor.
2. **Extract `shared.ts` first.** The private helpers and the config/error types
   are the shared substrate every module needs — pull them out before any
   cluster so the clusters can import rather than duplicate.
3. **Keep the barrel stable.** `services/auth.ts` becomes a re-export of
   `services/auth/index.ts` (or the import paths update in one sweep) so the
   blast radius on importers is zero or a single mechanical rename.
4. **Watch the closures.** Several methods capture module-level in-memory store
   defaults and the `config`-derived constants (`ACCESS_TOKEN_AUDIENCE`,
   `STEP_UP_AUDIENCE`, TTLs). Thread these through `ctx` explicitly rather than
   relying on closure scope, so each module is self-contained.
5. **Tests move with their subject** where they're already split by concern;
   otherwise leave `auth.test.ts` intact (it exercises the composed service and
   is the best regression guard that the composition is behavior-identical).

## Guardrails

- One PR, one concern: refactor only. A reviewer should be able to diff-check
  "these 4,480 lines became these 11 files" without hunting for behavior
  changes.
- Green at every commit — never a red intermediate state.
- No public-surface change: the returned object's keys and signatures are
  byte-identical.
