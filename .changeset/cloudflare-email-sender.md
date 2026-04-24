---
"@osn/api": minor
"@shared/email": minor
"@osn/email-worker": minor
---

Add transactional-email transport backed by a Cloudflare Worker.

`@shared/email` is a new workspace package exporting an `EmailService` Effect Tag, a `CloudflareEmailLive` layer that signs an ARC token (`scope: "email:send"`, `aud: "osn-email-worker"`) and POSTs through `instrumentedFetch` to the Worker, and a `LogEmailLive` layer that records sends in memory for local dev + tests. Templates live inside the package so the full set of outbound auth emails is auditable in one place.

`@osn/email-worker` is a new Cloudflare Worker that verifies ARC tokens via OSN's JWKS (no DB dependency — Worker-slim verify via `jose.createRemoteJWKSet`) and forwards via Cloudflare's native `SEND_EMAIL` Worker binding (Email Service, public beta). No third-party API keys, no provider SDK — Cloudflare DKIM-signs via the verified-domain configuration in the dashboard.

`@osn/api` swaps the inline `sendEmail` callback on `AuthConfig` for `EmailService`; auth.ts gains `EmailService` on its R channel wherever it dispatches transactional email. `OSN_EMAIL_WORKER_URL` is required in non-local envs; unset locally falls back to `LogEmailLive` so tests stay offline.
