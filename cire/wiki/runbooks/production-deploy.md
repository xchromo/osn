---
title: Production Deploy Runbook (cire)
description: Cire-specific deploy runbook — covers the Pages surfaces (guest, organiser, vendor portal) and the cire-api Worker. See root wiki/runbooks/production-deploy for the full osn-api + cire first-deploy guide.
tags: [runbook, deploy, production, cire, cloudflare, pages]
severity: high
related:
  - "[[cire-auth]]"
  - "[[vendors]]"
  - "[[../../../wiki/runbooks/production-deploy]]"
last-reviewed: 2026-07-17
---

# Production Deploy Runbook — cire

> Cross-reference: the authoritative first-deploy guide (secrets, osn-api Worker, D1 migrations, ARC key registration, Resend) lives in the **root wiki** at `[[wiki/runbooks/production-deploy]]`. This page covers cire-specific surfaces and the vendor portal first-run steps.

---

## §1 CI auto-deploy (normal merges)

On every merge to `main`, GitHub Actions (`.github/workflows/deploy.yml`) runs:

1. `wrangler deploy --env production` for `cire-api` — picks up `cire/api/wrangler.toml` `[env.production.vars]`.
2. `wrangler pages deploy` for `cire/web` (guest — `invite.cireweddings.com`) and `cire/organiser` (organiser — `host.cireweddings.com`).
3. `wrangler deploy --env production` for `osn-api` — picks up `osn/api/wrangler.toml` `[env.production.vars]`.
4. D1 migrations auto-apply (cire-db) before the worker deploy.

No manual steps are needed for routine feature deploys.

---

## §2 Vendor portal first-run (manual, one-time, authorised at merge time)

> **These steps are NOT automated.** They must be performed manually by a team member with Cloudflare account access before or immediately after the first `deploy-cire-vendor` CI job runs. They are flagged here so the person merging PR B knows to action them.

### 2.1 Create the Pages project

```bash
bunx wrangler pages project create cire-vendor
```

This must be done **once** before the CI deploy job references it. If the project does not exist, the deploy job errors with "project not found."

### 2.2 Add the custom domain

In the Cloudflare dashboard (or via Wrangler if supported):

1. Open the `cire-vendor` Pages project.
2. Go to **Custom domains** → **Set up a custom domain**.
3. Enter `vendor.cireweddings.com`.
4. Cloudflare will create the DNS CNAME record on the `cireweddings.com` zone automatically (zone is managed in this account). Confirm the CNAME is present.

### 2.3 Confirm CORS allowlist changes are live

After the PR B merge deploy completes, verify that both Workers now allow the new origin:

- **cire-api** (`api.cireweddings.com`): `WEB_ORIGIN` now includes `https://vendor.cireweddings.com`. Send a CORS preflight from the portal and confirm a 200 with the correct `Access-Control-Allow-Origin` header.
- **osn-api** (`id.cireweddings.com`): `OSN_ORIGIN` and `OSN_CORS_ORIGIN` now include `https://vendor.cireweddings.com`. Confirm the same.

Both changes ship automatically with the PR B merge via the normal CI deploy jobs — no separate `wrangler deploy` is needed.

Quick smoke check (replace `<token>` with a real short-lived claim token from a test seed):

```bash
# CORS preflight to cire-api
curl -si -X OPTIONS https://api.cireweddings.com/api/vendor/listing \
  -H "Origin: https://vendor.cireweddings.com" \
  -H "Access-Control-Request-Method: GET" \
  | grep -i "access-control"

# CORS preflight to osn-api
curl -si -X OPTIONS https://id.cireweddings.com/organisations \
  -H "Origin: https://vendor.cireweddings.com" \
  -H "Access-Control-Request-Method: GET" \
  | grep -i "access-control"
```

Expected: `access-control-allow-origin: https://vendor.cireweddings.com` in both responses.

### 2.4 Secrets

No new secret is required for the vendor portal itself:

- `RESEND_API_KEY` — already set on `cire-api` (PR A). The `vendor-claim-invite` email uses it.
- The vendor portal (`cire/vendor`) is a static Pages app with no server-side secrets. It reads from `cire-api` and `osn-api` via `authFetch` in the browser.

If `RESEND_API_KEY` was not set in PR A, set it now:

```bash
cd cire/api && bunx wrangler secret put RESEND_API_KEY --env production
```

---

## §3 Rollback

If the vendor portal must be rolled back:

1. Remove the `https://vendor.cireweddings.com` entries from `cire/api/wrangler.toml` `WEB_ORIGIN` and `osn/api/wrangler.toml` `OSN_ORIGIN` / `OSN_CORS_ORIGIN`.
2. Merge the revert PR — CI redeploys both Workers with the narrowed allowlists.
3. Optionally disable the `cire-vendor` Pages project custom domain in the Cloudflare dashboard.

The Pages project itself does not need to be deleted — it can be left idle.

---

## Related

- `[[vendors]]` — vendor portal screens, API surface, token-stripping, Referrer-Policy
- `[[cire-auth]]` — full auth model; organiser JWT verification; ARC bridge pattern
- `[[../../../wiki/runbooks/production-deploy]]` — root runbook (osn-api, first deploy, secrets, ARC registration)
