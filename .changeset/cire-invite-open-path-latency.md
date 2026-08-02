---
"@cire/api": minor
"@cire/web": minor
---

Open a returning guest's invite without asking for their code again, and take the
network latency out of the moment a code is entered.

- `@cire/api`: new `GET /api/claim/session` — a restore read gated by
  `sessionAuth()` that returns the same payload `POST /api/claim` returns, keyed
  on the `familyId` derived from the `cire_session` cookie. It accepts no claim
  code and the caller cannot name a family, so it is not a second credential
  surface; it re-checks `families.deactivated_at` as defence in depth and clears
  a stale cookie on that 401. Both entry points now build through a shared
  `buildClaimResponse`, so the events list and the claim-gated closing section
  cannot drift between claim and restore. Mounted as a sibling Elysia instance
  with its own 60/min limiter (`claimSessionLimiter`) rather than sharing the
  claim endpoint's 5/min brute-force budget, which a page-load-frequency read
  would otherwise exhaust.
- `@cire/web`: both design packs restore an existing household session on mount,
  so a guest who has already opened their invite lands straight on their events.
  The restored events section skips the unlock choreography (there is no unlock
  to perform on a return visit) and never starts at `opacity-0`. Adds a
  `preconnect` to the cire-api origin — the guest site and the API are separate
  origins, so the browser otherwise paid DNS+TCP+TLS in the middle of the claim
  request — and prefetches the unlock/modal animation chunks at idle, which were
  previously fetched after the interaction that needs them. Both prefetches are
  hints: every call site keeps its own import and its existing fallback.
