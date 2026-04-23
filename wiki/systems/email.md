---
title: Email Transport (transactional auth emails)
aliases:
  - email
  - email service
  - outbound email
  - cloudflare email worker
tags:
  - systems
  - auth
  - email
  - cloudflare
  - observability
status: current
related:
  - "[[arc-tokens]]"
  - "[[identity-model]]"
  - "[[step-up]]"
  - "[[passkey-primary]]"
  - "[[recovery-codes]]"
  - "[[observability/overview]]"
packages:
  - "@shared/email"
  - "@osn/email-worker"
  - "@osn/api"
last-reviewed: 2026-04-23
---

# Email Transport

OSN's transactional-email surface. Dispatches OTP codes (registration,
step-up, email-change) and security-event notifications
(recovery-code generate/consume, passkey added/removed) to users. No
marketing mail, no product updates — only auth-critical transactional
email.

## Architecture

```
  ┌──────────────────────┐        ┌──────────────────────┐        ┌────────────────────────┐
  │ @osn/api services    │        │  @shared/email       │        │ @osn/email-worker      │
  │ auth.ts call sites:  │ calls  │  EmailService (Tag)  │ ARC+   │ POST /send             │
  │  beginRegistration   ├───────▶│  CloudflareEmailLive ├───────▶│  verifies ARC via JWKS │
  │  beginStepUpOtp      │ Effect │  LogEmailLive (dev)  │  JSON  │  forwards to provider  │
  │  beginEmailChange    │        │                      │        │  (Resend today)        │
  │  notifyRecovery      │        │  renderTemplate()    │        │                        │
  │  notifyPasskey*      │        │                      │        └────────────────────────┘
  └──────────────────────┘        └──────────────────────┘
```

## Packages

- **`@shared/email`** — the Effect service + template renderers + both
  transport Layers. Imported by any OSN service that needs to send mail.
- **`@osn/email-worker`** — Cloudflare Worker. Owns the provider
  credentials (Worker Secret) and the per-recipient rate-limit;
  verifies ARC tokens against OSN's JWKS; forwards to Resend.

## Contract

### Call site (inside `@osn/api`)

```ts
import { EmailService } from "@shared/email";

const email = yield* EmailService;
yield* email.send({
  template: "otp-registration",
  to: normalisedEmail,
  data: { code, ttlMinutes: otpTtl / 60 },
});
```

The template catalogue is the complete list of emails OSN sends:

| Template                 | Data shape                          | Call site |
|--------------------------|-------------------------------------|-----------|
| `otp-registration`       | `{ code, ttlMinutes }`              | `beginRegistration` |
| `otp-step-up`            | `{ code, ttlMinutes }`              | `beginStepUpOtp` |
| `otp-email-change`       | `{ code, ttlMinutes }`              | `beginEmailChange` |
| `recovery-generated`     | `{}`                                | `notifyRecovery("recovery_code_generate")` |
| `recovery-consumed`      | `{}`                                | `notifyRecovery("recovery_code_consume")` |
| `passkey-added`          | `{}`                                | `notifyPasskeyRegisteredByAccountId` |
| `passkey-removed`        | `{}`                                | `notifyPasskeyDeletedByAccountId` |

Adding a template requires three edits in the same PR:
`shared/email/src/templates/index.ts` (union + data map + dispatcher),
a renderer file under `shared/email/src/templates/`, and a branch in
`renderTemplate()`. The compile-time exhaustive-switch check fails
otherwise.

### Worker wire format

```
POST /send
Authorization: ARC <JWT: iss=osn-api, aud=osn-email-worker, scope=email:send>
Content-Type: application/json
{
  "to":      "user@example.com",
  "from":    "noreply@osn.app",      // optional — falls back to FROM_ADDRESS_DEFAULT
  "subject": "Verify your OSN email",
  "text":    "...",
  "html":    "..."                   // optional but recommended
}
```

Responses:

| Status | Meaning                                                           |
|--------|-------------------------------------------------------------------|
| 202    | Accepted and forwarded to the provider                            |
| 400    | Schema violation (invalid `to`, missing `subject`, oversized body)|
| 401    | Missing / invalid ARC token                                       |
| 403    | ARC scope does not include `email:send`                           |
| 429    | Per-recipient rate limit hit (see [[rate-limiting]])              |
| 502    | Provider 5xx                                                      |

## ARC verification (Worker-slim)

`@shared/crypto`'s ARC helpers pull in `@osn/db` transitively (DB-backed
key resolver). That doesn't fit the Workers runtime, so the Worker uses
its own thin verifier at `osn/email-worker/src/arc-verify.ts`:

- `createRemoteJWKSet(new URL(OSN_API_ISSUER_JWKS))` — cached once per
  isolate, reused across requests (sub-ms verify on warm cold-starts).
- `jwtVerify(token, keySet, { algorithms: ["ES256"], audience, issuer })`
  — jose enforces signature, alg, audience, issuer, and expiry.
- Scope check: the Worker requires `email:send` specifically; a token
  that authorizes `graph:read` cannot reach the email path.
- The Worker does **not** consult OSN's `service_accounts` table — it
  has its own issuer allow-list (today just `osn-api`). This is a
  deliberate divergence from the in-process ARC verifier: the Worker is
  a separate trust boundary and shouldn't need a DB.

## Transports

`@shared/email` exposes two production Layers + the `EmailService` Tag:

- `makeCloudflareEmailLive(config)` — real dispatch. Signs an ARC token
  with the calling service's private key, POSTs to the Worker via
  `instrumentedFetch` so the call becomes a child span.
- `makeLogEmailLive()` — dev + test. Renders the template in-process,
  records the payload into an in-memory ring buffer (exposed via
  `recorded()`), emits a single `Effect.logDebug` line with `template`
  + `subject` + `to` — **never** the OTP code. Tests that need to
  assert on captured content read the recorder directly.

Selection in `osn/api/src/index.ts`: `OSN_EMAIL_WORKER_URL` set →
`CloudflareEmailLive`; unset → `LogEmailLive`. Required in non-local
envs (mirrors `OSN_JWT_PRIVATE_KEY` guard).

## Security notes

- **OTP bodies**: the rendered `text` / `html` contains the OTP digit
  string. The service layer only logs `template`, `subject`, `to` —
  never the rendered body, never `data`. The redaction deny-list
  backstops accidental annotations of the `accessToken` / `cookie` /
  `email` keys, but the primary protection is the call-site contract.
- **Phishing resistance**: email-change uses the "somebody asked for
  this on your account" framing (S-L5) so a misdirected message is
  clearly junk and useless as a phishing template. Live in
  `shared/email/src/templates/otp.ts → renderEmailChangeOtp`.
- **ARC scope isolation**: `email:send` is dedicated. A stolen ARC
  token with any other scope cannot reach the Worker.
- **Provider-body opacity**: the Worker reads the provider response but
  never echoes it back to the OSN caller (Resend can embed the
  recipient in error strings). OSN sees `{ ok: true }` or
  `provider_error`.

## Observability

- **Spans** (set on every `send()` invocation):
  - `email.send` (top-level, attrs `{ template }`)
  - `email.render`
  - `email.cloudflare.dispatch`
  - Outbound HTTP becomes a child `HTTP POST` span via
    `@shared/observability/fetch → instrumentedFetch`.
- **Logs**: `Effect.logError("email.dispatch_failed", { template, outcome })`
  on CF failures; `Effect.logWarning("email.rate_limited", { template })`
  on 429. Dev log `[email:log] template=... subject="..." to=...` from
  `LogEmailLive` only (guarded by log level).
- **Metrics** (in `shared/email/src/metrics.ts`):
  - `osn.email.send.attempts` — counter, `{ template: 7 values,
    outcome: sent|failed|rate_limited|skipped }`. Cardinality: 28 series.
  - `osn.email.send.duration` — histogram, same attrs.
  - `osn.email.render.duration` — histogram,
    `{ template, outcome: ok|error }`.
  - `osn.email.dispatch.http_status` — counter,
    `{ template, status_class: 2xx|4xx|5xx|network }`.

No recipient address, no account id, no request id on metric
attributes — bounded literal unions only.

## Rollout

Feature-flagged via `OSN_EMAIL_WORKER_URL`:

1. **Local / tests**: env unset → `LogEmailLive`. Zero behavioural
   change from today. `bun run test` stays offline.
2. **Staging**: deploy the Worker, set the env var for staging pods
   only. Send real mail to a synthetic inbox. Watch the
   `osn.email.send.attempts{outcome="sent"}` panel by template.
3. **Production**: flip the env var in prod secrets. No code change.
   Watch the `outcome="failed"` rate for 24h.
4. **Cleanup**: make `OSN_EMAIL_WORKER_URL` required when `OSN_ENV !==
   "local"`. Delete the `LogEmailLive` fallback branch in
   `osn/api/src/index.ts`.

## Deferred decisions

These live in `wiki/TODO.md > Deferred Decisions`; the defaults here
are the current code path, not a commitment.

- **Provider choice** — Resend is the default adapter; SendGrid /
  Postmark / SES are swap-ins at the Worker level only.
- **Worker-side rate-limit bound** — per-recipient-per-minute cap. TBD
  once we have real send-rate telemetry.
- **Dry-run flag** — `OSN_EMAIL_DRY_RUN` env knob that short-circuits
  before Worker dispatch. Not implemented yet.
- **HTML vs text-only** — current templates send both. If downstream
  analysis shows HTML is unnecessary for auth flows, we can drop it.
