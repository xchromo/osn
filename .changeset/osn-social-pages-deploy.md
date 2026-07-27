---
"@osn/api": minor
"@osn/social": minor
---

Move OSN identity to its own domain: osn-api on `id.musubi.dev`, `@osn/social` on the
`musubi.dev` apex, WebAuthn RP ID `musubi.dev`.

Identity was living on `cireweddings.com`, a domain that belongs to one product. It now
has a registrable domain of its own, which is what lets any later surface — cire, pulse,
zap — sign in through the same issuer without borrowing another product's name.

**`@osn/social` deploys to Cloudflare Pages.** `deploy.yml` gains a `deploy-osn-social`
job publishing the app to the `osn-social` project, served at the apex. The apex is the
right home rather than a subdomain: the RP ID is the registrable domain, so ceremonies
run legally on `musubi.dev` itself *and* on every `*.musubi.dev` surface added later.
`__Host-osn_session` and the per-request `__Host-osn_oar_<12hex>` binding cookie are
host-bound and `SameSite=Lax`, and apex → `id.musubi.dev` is same-site, so they ride
along on the consent screen's credentialed fetches. Feature-branch previews go to a
separate `osn-social-preview` project — the preview workflow deploys to a project's
production branch, so aimed at `osn-social` it would put unreviewed branch code on a
live hostname.

**osn-api production vars.** `OSN_RP_ID = musubi.dev`, `OSN_ISSUER_URL =
https://id.musubi.dev`, `OSN_ORIGIN = https://musubi.dev`, `OSN_AUTHORIZE_UI_URL =
https://musubi.dev/authorize` (unset, the provider falls back to `/authorize` on the
first `OSN_ORIGIN` entry — right today by accident, so it stays explicit), plus a
`custom_domain` route on `id.musubi.dev`. `OSN_CORS_ORIGIN` keeps the three cire
origins: these are two different lists, and CORS governs bearer-token calls, which
still work cross-site. `OSN_ORIGIN` governs WebAuthn ceremonies, which do not.
`OSN_EMAIL_FROM` stays `hello@cireweddings.com` — the only verified Resend sender, and
moving it would fail closed and take OTP step-up with it.

**Consumers repointed** at the new issuer: cire-api (`[env.production]` and
`[env.preview]`, which shares production identity by design), zap-api, the cire
organiser and guest build-time `PUBLIC_OSN_ISSUER_URL`, `@osn/social`'s
`VITE_OSN_ISSUER_URL`, and the guest site's CSP `connect-src`.

**Two costs, both accepted, both breaking.** Changing the RP ID invalidates every
passkey enrolled under `cireweddings.com` — the private half is bound to the RP ID
inside the authenticator, and no server-side change rebinds it. Recovery codes were
minted for both production accounts first, and are the only way back in: recovery-code
login → OTP step-up (`purpose: passkey_register`) → enroll → regenerate codes. And cire
sign-in — organiser, vendor, guest linking — is down until those frontends move to the
OIDC redirect flow, because a `cireweddings.com` origin can neither run a `musubi.dev`
ceremony nor replay a now-cross-site session cookie. Bearer-token verification is
unaffected.

Two dashboard steps remain, neither scriptable: attach the apex to the `osn-social`
Pages project, and add `musubi.dev` + `id.musubi.dev` to the Turnstile widget's domain
list. Reasoning and cutover order in `wiki/runbooks/musubi-identity-migration.md`.
