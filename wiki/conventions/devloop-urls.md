---
title: Devloop URLs
description: Named HTTPS hosts for every local dev server via portless, one stack per worktree, and how sibling origins are derived
tags: [convention, tooling, devloop]
related:
  - "[[commands]]"
  - "[[monorepo-structure]]"
  - "[[contributing]]"
  - "[[passkey-primary]]"
last-reviewed: 2026-08-20
---

# Devloop URLs

Every dev server in this repo runs behind [portless](https://github.com/vercel-labs/portless). Each app answers on a named HTTPS host instead of a port number, and each git worktree gets its own complete stack.

Each package's `dev` script is `portless`. It reads `portless.json` at the repo root and runs that package's real command — `dev:app` — behind the proxy.

## Setup

Once per machine. It binds port 443, adds a local CA to the system trust store and writes an `/etc/hosts` block, so it asks for sudo:

```bash
bunx portless proxy start        # or: bunx portless service install (starts at boot)
bunx portless doctor             # proxy, routes, DNS, CA trust
```

## The names

| Package | URL |
| --- | --- |
| `@osn/social` | `https://musubi.localhost` |
| `@osn/api` | `https://id.musubi.localhost` |
| `@osn/landing` | `https://www.musubi.localhost` |
| `@pulse/web` | `https://pulse.localhost` |
| `@pulse/api` | `https://api.pulse.localhost` |
| `@pulse/landing` | `https://www.pulse.localhost` |
| `@cire/landing` | `https://cire.localhost` |
| `@cire/invites` | `https://invite.cire.localhost` |
| `@cire/host` | `https://host.cire.localhost` |
| `@cire/vendor` | `https://vendor.cire.localhost` |
| `@cire/api` | `https://api.cire.localhost` |
| `@zap/api` | `https://zap.cire.localhost` |

The names mirror production hostnames — `id.musubi` for `id.musubi.social`, `host.cire` for `host.cireweddings.com`.

> [!important] The nesting is load-bearing
> A WebAuthn RP ID must be the origin's host or a registrable suffix of it, and a passkey created under one RP ID is invisible under another. `@osn/social` creates the passkey; `@osn/api` verifies it. Both sit under a shared `musubi` parent so `musubi.localhost` can serve as the RP ID for both. Flat names — `musubi` beside `osn-api` — would put every local passkey out of reach of the API that checks it. See [[passkey-primary]].

## One stack per worktree

In a linked worktree portless prepends the branch name as a subdomain, so the same `bun run dev` in two worktrees gives two complete, independent stacks:

```
main worktree        https://host.cire.localhost
feat/rsvp-sheet      https://rsvp-sheet.host.cire.localhost
```

Nothing collides, and no worktree has to wait for another to give up a port. The `main` worktree keeps the bare names — portless skips the prefix on default branch names.

## Why sibling origins are derived, not configured

Because that branch prefix exists, no app can be told where its siblings live from a committed `.env`: the answer differs per worktree.

`@shared/dev-urls` derives it instead. Its `dev-env` launcher fronts each `dev:app`, reads the app's own `PORTLESS_URL`, splits off the shared prefix and TLD, and rebuilds every sibling's origin from them. It then exports the same environment variables the deployed tiers set — `OSN_ISSUER_URL`, `OSN_RP_ID`, `OSN_ORIGIN`, `OSN_CORS_ORIGIN`, `DEV_LOGIN_RETURN_ORIGINS`, `WEB_ORIGIN`, `CIRE_API_ORIGIN`, `PULSE_CORS_ORIGIN`, `PUBLIC_API_URL`, `VITE_API_URL` and the rest.

```mermaid
flowchart LR
    T["turbo dev"] --> P["portless<br>(package dev script)"]
    P -->|"PORT, PORTLESS_URL"| L["dev-env<br>@shared/dev-urls"]
    L -->|"+ OSN_ORIGIN, PUBLIC_API_URL, …"| A["astro dev / vite / bun local.ts"]
```

No app source knows portless exists; every app keeps reading the variables it already read. Those values win over `.env`, because under portless a `localhost:4321` origin names a host nothing is listening on.

## Adding an app

Three places, all of which must agree:

1. `portless.json` — the name the proxy registers.
2. `DEV_APPS` in `shared/dev-urls/src/index.ts` — the same name, plus the port the app falls back to without portless.
3. `DEV_ENV` in `shared/dev-urls/src/cli.ts` — which sibling URLs that app needs, keyed by the env var it already reads.

## Running without the proxy

```bash
PORTLESS=0 bun run dev                # whole devloop on the old fixed ports
bun run --cwd cire/host dev:app       # one app, no proxy at all
```

The ports the frontends lost from their `dev` scripts moved into `astro.config.mjs` / `vite.config.ts` as `Number(process.env.PORT) || <old port>`. Portless assigns a port and passes it as `PORT`; without portless the literal keeps the four Astro apps from all landing on 4321.

> [!warning] Agents: Astro backgrounds itself
> Astro 7 detects an agent environment and puts `astro dev` in the background. Control returns to portless, portless deregisters the route as soon as its child exits, and the URL 404s while a stray daemon still holds the port. Run `CLAUDECODE= bun run dev` to keep it in the foreground, and clear a stray with `bunx astro dev stop`. A human terminal is unaffected.

Related: [[commands]], [[monorepo-structure]], [[contributing]].
