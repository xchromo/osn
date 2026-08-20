---
"@shared/dev-urls": minor
"@osn/api": patch
"@osn/social": patch
"@osn/landing": patch
"@pulse/api": patch
"@pulse/web": patch
"@pulse/landing": patch
"@zap/api": patch
---

Run the devloop behind portless: named HTTPS hosts instead of ports, and one stack per worktree.

Every app's `dev` script is now `portless`, which reads the new root `portless.json` and runs the package's real command (`dev:app`) behind the proxy. `@osn/api` answers on `https://id.musubi.localhost`, `@pulse/web` on `https://pulse.localhost`, and so on — twelve port numbers nobody has to remember, and no clash when two things want 4321. The names mirror production hostnames.

The nesting under a shared parent is load-bearing rather than cosmetic. A WebAuthn RP ID has to be the origin's host or a registrable suffix of it, so passkeys created on `@osn/social` are only verifiable by `@osn/api` if both sit under one parent: `musubi.localhost` and `id.musubi.localhost`, RP ID `musubi.localhost`. Flat names would have put every local passkey out of reach of the API that checks it.

In a linked worktree portless prepends the branch, so `bun run dev` in two worktrees gives two complete, independent stacks. That is also why no app can be told where its siblings live from a committed `.env` — the answer differs per worktree. The new `@shared/dev-urls` package derives it instead: its `dev-env` launcher fronts each `dev:app`, reads the app's own `PORTLESS_URL`, splits off the shared worktree prefix and TLD, and rebuilds every sibling's origin from them. It exports the same env vars the deployed tiers set (`OSN_ISSUER_URL`, `OSN_RP_ID`, `OSN_ORIGIN`, `PULSE_CORS_ORIGIN`, `PUBLIC_API_URL`, …), so no app source knows portless exists.

`PORTLESS=0 bun run dev` still gives the old fixed-port devloop. The ports the Astro apps lost from their `dev` scripts moved into their configs, where portless's assigned `--port` overrides them, so the bypass keeps working and the four Astro apps do not all land on 4321.
