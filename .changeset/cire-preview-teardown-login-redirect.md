---
"@cire/organiser": patch
"@cire/vendor": patch
"@cire/api": patch
---

Remove the preview tier and turn the login page into a redirect.

Identity moved to `musubi.social` on 2026-07-27, so the cireweddings.com origins
can no longer run a passkey ceremony: sign-in is a top-level redirect to
cire-api's OIDC start leg. That leaves nothing to choose on `/login`, so there is
nothing to click. `SignInPanel` now calls `startSignIn()` on mount and only draws
itself when the issuer sends someone back with `?auth_error=…` — a message and a
"Try again" button. The 401 handler still sends people to `/login`; they now pass
straight through it.

The preview tier goes with it. A preview host could neither run the ceremony nor
replay a session cookie cross-site, and rebuilding it behind OIDC would need a
second client, a second consent record, and a second redirect URI. Deleted:
`[env.preview]` in `cire/api/wrangler.toml` (and the four `preview_bucket_name`
fields, which had no remote bucket left to bind),
`.github/workflows/deploy-cire-preview.yml`,
`.github/workflows/deploy-landing-preview.yml` — which pushed a feature branch
onto the production `cire-landing` project — and the `cire/db/seed/preview-seed`
pair. The Cloudflare resources (two Pages projects, two Workers, one D1, two R2
buckets) are deleted out of band.

Six open security and compliance findings close with the tier; they are archived
in the cire wiki's `security-fixes` changelog.
