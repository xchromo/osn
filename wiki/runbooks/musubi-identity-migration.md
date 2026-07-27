---
title: Migrating OSN identity to musubi.dev
description: Cutover plan for moving osn-api from id.cireweddings.com to id.musubi.dev and making musubi.dev the full OSN identity home
tags: [runbook, identity, migration, oidc, webauthn]
status: cutover-done-pr-c-outstanding
related:
  - "[[production-deploy]]"
  - "[[oidc-provider]]"
  - "[[authorize-ui]]"
  - "[[identity-model]]"
  - "[[passkey-primary]]"
  - "[[sessions]]"
  - "[[social]]"
  - "[[recovery-codes]]"
last-reviewed: 2026-07-27
---

# Migrating OSN identity to musubi.dev

Moving osn-api from `id.cireweddings.com` to `id.musubi.dev`, with
`musubi.dev` becoming the full OSN identity home: issuer, sign-in UI, and
consent screen. This is the "dedicated OSN domain" that
`[[production-deploy]]` has carried as deferred since the first prod deploy.

> **The move shipped on 2026-07-27, ahead of PR C, on purpose.** The end state
> is live: `osn-api` on `id.musubi.dev`, `@osn/social` on the **`musubi.dev`
> apex**, `OSN_RP_ID = musubi.dev`. What the plan below calls step 6 / PR C —
> converting cire to the OIDC redirect flow — was **not** done first. The cost
> was accepted knowingly and is stated plainly here so nobody reads a broken
> flow as a bug:
>
> - **Every passkey enrolled under `cireweddings.com` is dead.** Both prod
>   accounts have recovery-code sets (minted 2026-07-26, step 2) and those are
>   the only way back in.
> - **cire sign-in is down** — organiser, vendor, and the guest account-linking
>   island. All three ran their own WebAuthn ceremony from a cireweddings.com
>   origin, which is now a different registrable domain from the RP ID.
> - Bearer-token verification is untouched. cire-api and zap-api verify against
>   the new JWKS URL and nothing about `aud`/signature checking changed.
>
> **PR C is the remaining work, and it is now on the critical path** rather than
> a step ahead of the flip. Until it lands, cire has no sign-in.

**This is not a hostname swap.** The two dependencies below were the reason.
They are kept as written because they explain the shape of what broke.

## Why it cannot be config-only

### Blocker 1 — the authorize UI ✅ cleared 2026-07-26

The consent screen is built and deployed: `/authorize` in `@osn/social`, see
`[[authorize-ui]]`. The paragraphs below stay because they explain why this
ordering is not optional.

This matters because of WebAuthn scoping. A passkey ceremony may only run on
an origin that is same-site with the RP ID. Once `OSN_RP_ID` becomes
`musubi.dev`, the cire origins (`host.`, `vendor.`, `invite.cireweddings.com`)
**can no longer run ceremonies at all** — they are a different registrable
domain. Their replacement is the OIDC redirect flow, which needs the very
page that does not exist.

Flip the RP ID before that page ships and cire has neither mechanism: direct
ceremonies are illegal, and the redirect flow dead-ends.

### Blocker 2 — `@osn/social` is not deployed ✅ cleared 2026-07-26

`deploy.yml` carries a `deploy-osn-social` job publishing the `osn-social`
Pages project. It was written against `me.cireweddings.com` and **never served
that hostname**: the 2026-07-27 decision to go straight to musubi.dev landed
before the Pages custom domain was attached, so the job now targets the
**`musubi.dev` apex** with
`OSN_AUTHORIZE_UI_URL = https://musubi.dev/authorize`. Feature-branch previews
live in a separate `osn-social-preview` project so a push to a branch can never
overwrite what a live hostname serves.

`[[authorize-ui]]` requires it be served under the **same registrable domain
as osn-api**, because the session cookie and the per-request OIDC binding
cookie are host-bound and only flow on same-site fetches with
`credentials: "include"`. The apex `musubi.dev` is same-site with
`id.musubi.dev`, so that holds. It is also why the apex, not `id.musubi.dev`,
is the RP ID: the apex covers itself **and** every future `*.musubi.dev`
surface, whereas an RP ID of `id.musubi.dev` would forbid a ceremony on the
apex — the one place a ceremony now runs.

### Why partial moves do not help

Moving only the issuer hostname while keeping `OSN_RP_ID = cireweddings.com`
does not sidestep either blocker. It makes every cire→OSN call cross-site, so
the `SameSite=Lax` `__Host-osn_session` cookie stops being sent and silent
refresh dies at the first 401 (~5 minutes after sign-in). Relaxing to
`SameSite=None` turns it into a third-party cookie: blocked outright by
Safari's ITP, and on Chrome's deprecation path. There is no config-only
ordering that is safe.

## Credential bridge — do this first

Changing `OSN_RP_ID` invalidates **every existing passkey**. Sessions do not
bridge the move either: `__Host-` is exact-domain by prefix, so
`__Host-osn_session` set on `id.cireweddings.com` is not sent to
`id.musubi.dev`. An account whose only credential is a passkey, with no
recovery codes, is permanently locked out the moment the RP ID flips —
every step-up route requires an existing access token, and the only
unauthenticated door is `POST /login/recovery/complete`.

Recovery-code login is RP-ID-independent (identifier + code, no WebAuthn),
which is exactly why it survives the flip.

**A passkey cannot be migrated to a new RP ID.** The `passkeys` table holds
only the public half; the private key lives in the authenticator and is bound
to the RP ID at creation. Nothing written to D1 re-points an existing
credential — after the flip both rows are dead weight and both users enroll
fresh. Enrolment requires an authenticated session, hence the bridge.

Confirmed prod inventory (2026-07-25) — the whole blast radius was two
credentials on two accounts. Both were dead the moment the RP ID flipped on
2026-07-27:

| Account | Passkey | Last used | Codes at flip |
|---|---|---|---|
| `chavaniket@duck.com` | `pk_f7cbfe55345a` | 2026-07-23 | ✅ minted 2026-07-26 |
| `mdpasupati@gmail.com` | `pk_dd04a0f8beff` | 2026-07-19 | ✅ minted 2026-07-26 |

Small enough that re-enrolment is a chore rather than a migration. The codes
were minted first, which is the only reason the flip was survivable — the
inventory read `0` on both rows two days earlier.

**Before touching the RP ID, for every account that must survive:**

1. Sign in on the current domain while passkeys still work.
2. `POST /recovery/generate` (step-up gated — see `[[recovery-codes]]`).
   Store the 10 codes offline.

**After cutover, to re-establish a credential:**

1. `POST /login/recovery/complete` — identifier + code. Returns a session.
2. `POST /step-up/otp/begin` → `/step-up/otp/complete` with purpose
   `passkey_register`. OTP is email-based, so it does not need a passkey.
3. Enroll a fresh passkey under the new RP ID.
4. `POST /recovery/generate` again — the consumed set is spent.

> `OSN_PAIRWISE_SALT` must be set on `osn-api-production` for **any** of this
> to work. The boot check is fail-closed, so without it every route 503s
> regardless of which domain it answers on. See `[[production-deploy]]`.

## Config inventory

Everything that named the issuer. All of it shipped on 2026-07-27 unless the
row says otherwise. `staging` and `dev` keep their current values — the whole
ladder did not move.

| Where | Key | Before → now |
|---|---|---|
| `osn/api/wrangler.toml` `[env.production.vars]` | `OSN_RP_ID` | `cireweddings.com` → **`musubi.dev`** |
| ″ | `OSN_ISSUER_URL` | `https://id.cireweddings.com` → **`https://id.musubi.dev`** |
| ″ | `OSN_ORIGIN` | four cire origins → **`https://musubi.dev`** alone. The cire entries were removed, not kept: a ceremony from a different registrable domain is illegal whatever the list says, and leaving them would hide that. |
| ″ | `OSN_CORS_ORIGIN` | **kept the cire origins**, added `https://musubi.dev`. Different list, different job — CORS governs bearer-token calls, which still work cross-site. |
| ″ | `OSN_AUTHORIZE_UI_URL` | → **`https://musubi.dev/authorize`**. Stays explicit: unset it resolves against the *first* `OSN_ORIGIN` entry, which is right today by accident and breaks silently if that list is ever reordered. |
| ″ | `OSN_EMAIL_FROM` | **unchanged — `hello@cireweddings.com`.** See the Resend note below; moving it would fail closed and take OTP with it. |
| ″ `[[env.production.routes]]` | `pattern` | `id.cireweddings.com` → **`id.musubi.dev`**, `custom_domain = true` |
| `cire/api/wrangler.toml` | `OSN_JWKS_URL`, `OSN_ISSUER_URL` | both, in `[env.production]` **and** `[env.preview]` — the preview tier shares prod identity by design |
| `zap/api/wrangler.toml` | `OSN_JWKS_URL`, `OSN_API_URL` | both |
| `.github/workflows/deploy.yml` | `PUBLIC_OSN_ISSUER_URL` | three occurrences |
| `.github/workflows/deploy-cire-preview.yml` | `PUBLIC_OSN_ISSUER_URL` | two occurrences |
| `.github/workflows/deploy.yml` | `VITE_OSN_ISSUER_URL` (`deploy-osn-social`) | one occurrence |
| `.github/workflows/deploy-osn-social-preview.yml` | `VITE_OSN_ISSUER_URL` | one occurrence |
| `cire/web/src/lib/security-headers.ts` | `osnIssuer` + CSP `connect-src` | hardcoded — must track the issuer |

Out-of-band, not in the repo:

- **Zone.** ✅ `musubi.dev` is in the same Cloudflare account, so
  `custom_domain = true` auto-provisions DNS + edge cert for `id.musubi.dev`.
  The zone carries a **proxied wildcard record**; that does not interfere,
  because a wildcard only answers names with no record of their own.
- **Pages custom domain — OUTSTANDING.** Attach the **apex `musubi.dev`** to
  the `osn-social` Pages project in the dashboard. A Pages custom domain is a
  dashboard setting, not a wrangler route, so the deploy job cannot create it.
  The apex is also the one name the wildcard does not cover, so watch for a
  collision with any existing apex record. Until this is done the identity app
  sits on `osn-social.pages.dev`, where the `__Host-` cookies do not reach it
  and a ceremony is illegal.
- **Turnstile — OUTSTANDING.** Add `musubi.dev` and `id.musubi.dev` to the
  widget's domain list. The wrangler API token has no `challenge-widgets.write`
  scope, so this is a dashboard step. Only bites once a secret is set — the
  gate is inert today (`[[turnstile]]`).
- **Resend — deliberately not blocking.** The account has only
  `cireweddings.com` verified, so `OSN_EMAIL_FROM` **stayed** on
  `hello@cireweddings.com`. Moving it before verifying a musubi.dev sender
  would fail closed and take OTP step-up with it — and OTP is exactly the step
  that turns a recovery-code login back into a passkey. Verify the sender
  first, then move the var, in that order.

## Cutover order

1. ✅ Set `OSN_PAIRWISE_SALT` on `osn-api-production`. Prerequisite for every
   later step; also ended the outage it was causing.
2. ✅ Mint recovery codes for every account that must survive (above).
   2026-07-26 — both accounts.
3. ✅ `musubi.dev` is in the Cloudflare account. Resend sender **not** verified,
   and `OSN_EMAIL_FROM` stayed on cireweddings.com because of it.
4. ✅ Build the `/authorize` page in `@osn/social` per `[[authorize-ui]]`
   (2026-07-26).
5. ✅ Add an osn-social Pages job to `deploy.yml` (2026-07-26). Written for
   `me.cireweddings.com`, retargeted to the **`musubi.dev` apex** before it ever
   served a hostname.
6. ⬜ **Outstanding — this is now the critical path.** Register cire as an OIDC
   client; convert organiser, vendor and web from direct `@osn/client`
   ceremonies to the redirect flow.
7. ✅ Flipped the osn-api vars + route on 2026-07-27, and the downstream
   verifiers (cire-api, zap-api) with them. **The osn-social Pages custom domain
   is the one piece still outstanding** — a dashboard step.
8. ⬜ Re-enroll passkeys under the new RP ID; regenerate recovery codes.
   Blocked on step 7's dashboard step: there is no origin to enroll from until
   the apex serves the identity app.

### Steps 6 and 7 were deliberately reordered

The original plan below split the move into four PRs — A, B, C, D — so that
"does the OIDC flow work at all" could be debugged separately from "does it
work on a new domain". **That is not what happened.** D shipped before C, as an
explicit call, accepting that cire sign-in goes down in the gap. The reasoning
stands and is left intact, because it is also the description of what the gap
costs:

- **A — the consent screen.** Done: `/authorize` in `@osn/social`.
- **B — deploy `@osn/social`.** Done 2026-07-26. The plan was to serve it from
  `me.cireweddings.com` — a host under the **then-current** registrable domain,
  where the binding and session cookies already worked — and prove the
  authorize → consent → token round-trip before moving anything. In the event
  the hostname was never attached and B merged into D.
- **C — convert cire to the redirect flow.** ⬜ **Not done.** Register cire as
  an OIDC client and move organiser, vendor and web off direct `@osn/client`
  passkey ceremonies. This is the change that removes cire's dependence on the
  RP ID.
- **D — the move itself.** ✅ Shipped 2026-07-27: vars, route, RP ID, and the
  osn-social Pages target.

Ordering C before D would have made D reversible in the sense that mattered:
after C, cire never runs a WebAuthn ceremony of its own, so changing the RP ID
could not take cire's sign-in with it. Shipping D first is exactly why cire's
sign-in went with it. The trade was worth making here because cire has no live
users yet and the identity domain wanted settling before it acquired any — but
that is the condition the trade rests on, and it will not hold twice.

## Rollback

**Step 7 has shipped, so rollback is no longer free.** Reverting `OSN_RP_ID` to
`cireweddings.com` does restore the old passkeys — credentials are never deleted
server-side, only made unusable under a different RP ID — but it kills any
passkey enrolled under `musubi.dev` since the flip, and it puts the issuer back
on a hostname the deployed frontends no longer name. A revert is therefore the
whole branch, not one var.

Keep the recovery-code sets from step 2 until re-enrolment is confirmed on
`musubi.dev`. They are the only credential that spans both RP IDs.

`OSN_PAIRWISE_SALT` is the one thing that must **never** be rotated in a
rollback — it is the HMAC key behind every pairwise `sub`. See
`[[oidc-provider]]`.
