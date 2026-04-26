---
title: DSAR Runbook (Access, Erasure, Rectification, Portability)
tags: [compliance, gdpr, ccpa, dsar, runbook]
related:
  - "[[index]]"
  - "[[gdpr]]"
  - "[[ccpa]]"
  - "[[data-map]]"
  - "[[retention]]"
last-reviewed: 2026-04-26
---

# DSAR Runbook

How OSN handles a **Data Subject Access Request** (GDPR Arts. 15, 16, 17,
18, 20, 21) or a **Verifiable Consumer Request** (CCPA / state laws). One
runbook, two regimes, because the operational steps overlap.

## Endpoints and entry points

| Channel | Who uses it | Where it lands | SLA |
|---|---|---|---|
| `GET /account/export` (planned C-H1) | The account holder, self-service | `@osn/api` — streams JSON | Immediate |
| `DELETE /account` (planned C-H2) | The account holder, self-service | `@osn/api` — soft delete, then hard delete in 7 d | 7 d |
| `dsar@osn.example` (planned, alias on landing) | Anyone via email | Identity team inbox | 30 d (GDPR) / 45 d (CCPA) |
| Postal address (planned, on landing) | Anyone via mail | Identity team inbox | Same |
| Authorised agent | Third party with notarised authority | Same email + verification | Same; verification adds days, log it |

## Step-by-step for a written request

1. **Acknowledge within 72 hours** — automated reply confirming receipt and the response deadline.
2. **Identify the regime** — GDPR if EU/UK; CCPA + state laws if US-resident; treat unclear cases as both (apply the stricter rule).
3. **Verify identity** — for the account holder using the in-app endpoints, the bearer token + step-up token verifies. For email/postal:
   - First test: email-controlled OTP to the email on file.
   - If that fails (e.g. user has lost the email): require step-up via a recovery code, OR a notarised statement of identity, OR proof of association (last login IP region, recent profile activity).
   - **Do not** require government ID for a basic DSAR — over-collection.
4. **Verify scope** — the request must specify the right exercised. "I want my data" = Art. 15 (access). "I want it deleted" = Art. 17. "I want it sent to Acme" = Art. 20 (portability). Document the inferred scope back to the requester before acting.
5. **Authorised agent path** — verify notarised power-of-attorney + the underlying user's identity per step 3. CCPA also allows the user to confirm direct.
6. **Execute** — see "Per-right execution" below.
7. **Respond** — include what was provided / deleted, the format, the lawful basis to refuse anything refused (see "Refusals"), and the right to lodge a complaint with a supervisory authority (GDPR Art. 77 — list the relevant DPA based on user's residence).
8. **Log** — add a row to `dsar_requests` (planned table) including: opened, closed, regime, right exercised, decisions, evidence path. Retain 24 months (CCPA min).

## Per-right execution

### Art. 15 — Right of access

Use `GET /account/export`. The endpoint returns a JSON bundle:

- `account` — row from `accounts` (email, passkey_user_id, max_profiles, timestamps).
- `profiles[]` — rows from `users` for this account.
- `passkeys[]` — `id`, `label`, `aaguid`, `backup_eligible`, `backup_state`, `last_used_at`, `created_at`. **Not** `credentialId` or `publicKey` — those have no value to the user and could leak in transport.
- `sessions[]` — `ua_label`, `ip_hash` (raw, not the public 16-hex handle), `last_used_at`, `created_at`. Note: `ip_hash` is HMAC-peppered; we cannot reverse to an IP.
- `security_events[]` — kind, metadata, created_at, acknowledged_at.
- `recovery_codes` — `total`, `used` (counts only; never the hashes).
- `email_changes[]` — old / new email, timestamp.
- `connections[]` — requester / addressee handles + status + timestamps.
- `blocks[]` — blocked handles + timestamps.
- `organisations[]` — orgs the account's profiles own or are members of.
- `pulse.rsvps[]` — fetched via ARC from `@pulse/api`. Status, event title (if visible to the requester), timestamps.
- `pulse.events_hosted[]` — events created by the account's profiles.
- `pulse.close_friends[]`.
- `zap.chats[]` — chat ids, role, joined-at. **Message content is excluded** because it is E2E-encrypted and we cannot decrypt; the user's local Zap client can export the decrypted history separately.
- `consents[]` — once consent records ship (C-L1).
- `dsar_requests[]` — prior requests for this user.

Format: streaming JSON (multi-MB plausible for prolific users). Auth: bearer access token + step-up token. Rate-limit: 1 export per 24 h per account.

### Art. 16 — Rectification

Most fields are user-editable in `@osn/social` (handle change, displayName, avatar, email change). For non-editable fields (security_events metadata, sessions ua_label) — these are observed facts, not user-supplied data; rectification right is narrower under GDPR Recital 65 ("inaccuracy" must be the data itself). Document the refusal under "Refusals" if challenged.

### Art. 17 — Right of erasure

Use `DELETE /account`. Two-phase:

1. **Soft delete** — sets `accounts.deleted_at`, immediately invalidates all sessions, redacts handles to `deleted_<id>`, blocks new logins. Returns 202.
2. **Hard delete** after 7 days unless the user re-authenticates (recovery flow). Cascade includes:
   - All rows in `osn/db` referencing the account (via existing FK cascade or explicit deletes in the deletion service).
   - ARC fan-out to `@pulse/api/internal/account-deleted` and `@zap/api/internal/account-deleted` — Pulse hard-deletes RSVPs / events / close-friends entries; Zap revokes chat memberships, replaces sender_id with a deletion sentinel in retained ciphertext (we cannot decrypt, but participants can still read).
   - Backups remain until next rotation cycle (document in privacy notice).
   - Grafana logs: redacted at write time, no PII to scrub. Trace and metric retention windows handle the rest.

Tombstone (deletion sentinel) retained 30 days then purged.

**Refusals permitted** under Art. 17(3):

- Legal-obligation retention (e.g. Pulse ticketing receipts under tax law — once paid Pulse ticketing lands).
- Establishment / exercise / defence of legal claims (open dispute, abuse-report under investigation).
- Public-interest archiving (N/A here).

Document refusals in the response with the specific exemption.

### Art. 18 — Restriction of processing

Sets `accounts.processing_restricted_at` (planned column with C-H2). Effect: account cannot post events, send messages, accept connections, but data is preserved. Used pending dispute.

### Art. 20 — Portability

Same `GET /account/export` JSON bundle. Format is machine-readable + commonly used. Per Art. 20(2), where technically feasible, we will offer direct transmission to another controller — defer this until requested in practice; not mandatory under "technically feasible" if no industry-standard receiver exists.

### Art. 21 — Right to object

Today: no marketing email, no LI-based processing of individuals beyond
fraud detection and security. Objection to fraud detection / security =
account suspension (we cannot serve the user without those). Document.

If a marketing channel ever lands (e.g. event-host newsletter from
Pulse), this becomes operational: object → flag account → exclude from
future sends.

## Refusals

When refusing in whole or part, the response must:

- Identify the request and the refused part.
- State the exemption with the article reference.
- Inform of right to complain to the supervisory authority (list relevant DPA with contact link).
- Inform of right to a judicial remedy.
- Be sent within the same 30 / 45 day deadline as a positive response.

Refusals get logged in `dsar_requests` with `decision: refused` + `exemption: <article>`.

## Verification thresholds for "manifestly unfounded or excessive"

Per GDPR Art. 12(5), we may charge a reasonable fee or refuse if a request is manifestly unfounded or excessive. In practice:

- Repeated identical request <30 d after the prior — refuse OR charge.
- Request that requires disproportionate effort relative to benefit — limited grounds; document carefully.
- Request submitted to harass (threats, automation) — refuse.

Default position: do the work. Refusals are exceptional and have to survive a DPA challenge.

## Escalation

| Trigger | Action |
|---|---|
| Request from a minor's parent | Treat as legitimate; verify per COPPA process. |
| Request invokes "right to be forgotten" against indexed search engines | Out of scope (we are not the search engine); inform requester. |
| Request claims breach has occurred | Treat as breach notification; trigger [[breach-response]]. |
| Authority subpoena vs DSAR | Different flow; route to legal counsel. |

## Project changes required

Tracked with `C-` IDs, all rolled up under **C-M1** (DSAR runbook):

1. `dsar_requests` table for audit log.
2. `dsar@osn.example` email alias + automated acknowledgement.
3. Postal address published on `@osn/landing` legal page.
4. Internal triage doc with the team rotation.
5. SLA monitoring (alert when a request is >25 d unresponded).
