---
"@osn/social": patch
---

fix(social): send a Turnstile token from the musubi.social ceremonies

Sign-in and registration on `musubi.social` failed with `400 turnstile_failed`.
osn-api has held `TURNSTILE_SECRET_KEY` since #160, so `/register/begin` and the
identifier-bound `/login/passkey/begin` fail closed unless the caller sends a
token — and `@osn/social` was sending none.

Both halves of the gate were individually correct; the pairing was severed when
the form moved. Before the identity migration the only surface running the OSN
ceremonies was cire/organiser, whose Astro build read `PUBLIC_TURNSTILE_SITEKEY`.
The move to `musubi.social` (#321) relocated those ceremonies to `@osn/social`
and the organiser's OIDC swap (#322) removed its ceremony forms entirely, but the
`deploy-osn-social` job passed only `VITE_OSN_ISSUER_URL` and neither `Sidebar`
nor `AuthorizeSignIn` passed a `turnstileSiteKey` — so no widget rendered and no
token was sent.

- `src/lib/auth.ts` exports `TURNSTILE_SITEKEY` from `VITE_TURNSTILE_SITEKEY`,
  normalising blank (an unset Actions variable expands to `""`) to `undefined` so
  `turnstileEnabled()` sees one shape.
- Threaded into all three ceremony call sites: the sidebar's `SignIn` and
  `Register` dialogs, and the `/authorize` consent screen's sign-in island.
- `deploy.yml` and `deploy-osn-social-preview.yml` pass
  `VITE_TURNSTILE_SITEKEY: ${{ vars.PUBLIC_TURNSTILE_SITEKEY }}` — the same
  widget and repo Variable as the cire builds; the prefix differs only because
  Vite exposes `VITE_*` where Astro exposes `PUBLIC_*`.
- `vite-env.d.ts` now types both build vars.

Guarded by `tests/components/turnstile-wiring.test.tsx`, which fails if any
ceremony call site drops the prop.

Note for preview deploys: `osn-social-preview.pages.dev` must be added to the
widget's Domains list in the Cloudflare dashboard, or its widget error-callbacks
(110200) and preview sign-in stays blocked. Production `musubi.social` is already
on that list.
