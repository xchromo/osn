---
"@osn/api": minor
"@shared/observability": patch
---

OIDC provider deferred-hardening batch — closes every deferred finding from the PR #315 prep-pr review that didn't genuinely need the consent-screen UI.

**@osn/api (minor)**

- **S-H1 (oidc)** — honest `auth_time` + enforced freshness. `verifyRefreshToken` now returns `authenticatedAt` (session `created_at`); codes and ID tokens carry the session's real authentication time instead of the code-mint time. `max_age` is parsed and bounded; exceeding it behaves like `prompt=login`; both park the request with `requireAuthAfter` and `/authorize/decision` refuses (`400 login_required`, request kept alive for retry) any session created before that instant, re-checking `max_age` at decision time.
- **S-M1 (oidc)** — per-request browser-binding cookie. `/authorize` sets a 600 s HttpOnly `__Host-`-prefixed cookie per parked request; the store keeps only its SHA-256. Context reads without it 404 like an unknown id; decisions without it fail before the request is consumed.
- **S-M2 (oidc)** — `RESERVED_OIDC_CLIENT_IDS` deny-list enforced at `findClient` (reserved ids read as absent); OIDC access tokens carry a `typ: "at+jwt"` header (RFC 9068) via a new optional `typ` parameter on `signJwt`.
- **S-M3 / C-M3 (oidc)** — user-facing connections routes: `GET /oidc/connections` (live grants with client name/logo) and `DELETE /oidc/connections/:clientId` (revokes the consent and deletes in-flight authorization codes for the pair — withdrawal is immediate). Two new rate-limiter slots (`oidcConnectionsList` 30/min, `oidcConnectionsRevoke` 10/min) across the in-memory, Redis, and native-binding bundles.
- **C-M1 (oidc)** — DSAR export gains an `oidc_consents` section (clientId, clientName, profileId, scope, grantedAt, revokedAt; revoked grants included as withdrawal history).
- **P-W1/2/4/5, P-I3 (oidc)** — exchange and decision return their metric dimensions instead of re-reading the client/parked request; `recordConsent` is insert-first (`ON CONFLICT DO NOTHING`); the two token signatures run concurrently; client/consent reads use explicit projections. P-W3 declined: the `/token` reads are dependency-ordered — consuming the code before client auth would burn a victim's code on an attacker's failed attempt.
- PKCE `code_challenge` is now required to be exactly 43 base64url characters (an S256 digest's only possible length); discovery advertises `auth_time`, `preferred_username`, `picture`, `email_verified`.

**@shared/observability (patch)**

- `AuthRateLimitedEndpoint` widened with `oidc_connections_list` and `oidc_connections_revoke`.
