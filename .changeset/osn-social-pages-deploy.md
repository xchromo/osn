---
"@osn/api": patch
"@osn/social": minor
---

Deploy `@osn/social` to Cloudflare Pages and point the OIDC provider at its consent screen.

`deploy.yml` gains a `deploy-osn-social` job publishing the app to the `osn-social`
Pages project, served at `me.cireweddings.com` — a host under the same registrable
domain as osn-api, because the `__Host-osn_session` cookie and the per-request
`__Host-osn_oar_<12hex>` binding cookie are host-bound to `id.cireweddings.com` and
`SameSite=Lax`. They ride along on the consent screen's credentialed fetches from
`me.`, but would not from a `*.pages.dev` host.

osn-api production vars: `OSN_AUTHORIZE_UI_URL = https://me.cireweddings.com/authorize`
(unset, the provider falls back to `/authorize` on the first `OSN_ORIGIN` — the
organiser portal, which serves no such route), and `me.cireweddings.com` added to both
`OSN_ORIGIN` (it runs passkey ceremonies) and `OSN_CORS_ORIGIN` (its calls are
cross-origin).

Feature-branch previews move to a separate `osn-social-preview` Pages project. The
preview workflow deploys to a project's production branch, so aimed at `osn-social` it
would have put unreviewed branch code on a live hostname.
