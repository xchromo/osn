# OSN Project TODO

Progress tracking and deferred decisions. Completed items archived in `[[changelog/]]`. For full spec see README.md. For code patterns see CLAUDE.md. For detailed system docs see [[index]].

## Up Next

Now **deployed on `cireweddings.com`** (Cloudflare Free tier — see [[production-deploy]], [[free-tier-limits]], [[changelog/completed-features]] "Production launch" 2026-06-18). Post-deploy priorities:

- [ ] **Activate Cloudflare Turnstile** — create the managed widget in the dashboard, set `PUBLIC_TURNSTILE_SITEKEY` (Pages build var, **sitekey-first**) then `TURNSTILE_SECRET_KEY` (osn-api + cire-api Worker secret). Code shipped inert (#154); gates go live only once the secret is set. See [[turnstile]], [[production-deploy]] §3.4.
- [ ] **Free Cloudflare dashboard hardening** (manual, can't be done from wrangler) — confirm the free WAF Managed Ruleset, add a custom rule blocking public `/internal/*` + `/graph/internal/*`, enable Page Shield on the guest site, confirm L7 DDoS. See [[free-tier-limits]] "Cloudflare security hardening".
- [ ] **Re-enable email later** — provision Cloudflare Email Service (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_EMAIL_API_TOKEN` + `OSN_EMAIL_FROM`), watch `osn.email.send.attempts{outcome="sent"}`, then **remove** `OSN_EMAIL_OPTIONAL=true` from osn-api `[vars]`. Restores OTP step-up everywhere (incl. cire organiser, currently passkey-only). See [[email]], [[production-deploy]] §1.1.
- [ ] **Optional Google Maps key** — set the Maps Embed key so cire location previews render the real map instead of the CSS-card fallback (#146; key-optional today). See [[cire]].
- [ ] **Provision Grafana Cloud + wire `OTEL_EXPORTER_OTLP_ENDPOINT` + headers**; build first dashboards (HTTP RED, auth funnel, ARC verification, events CRUD). NB: OTel export is **deferred on workerd** — the deployed Workers ship to Cloudflare Workers Logs in the interim. See [[observability-setup]], [[observability/overview]].
- _C-H1 (account export) and C-H8 (registration age gate) shipped 2026-07-07 — pruned from Up Next; see `[[compliance/dsar]]` / `[[compliance/coppa]]`._

---

## Auth Audit Remediation (2026-06)

**Status: W1–W7 landed on `claude/stoic-davinci-9v8eap` (PR #116) and reconciled with `main` (#118 shared `appRuntime`, #119 Zap/Pulse Cloudflare Workers).** The workstream checkboxes below are checked off; the review of the remediation PR itself surfaced three must-fix findings (S-H1 zap-IP, P-W1 zap-consent, S-M1 osn-recovery-CAS — all **fixed** in this PR, see Security/Performance Backlog) plus follow-on cire/low findings now tracked open in the Security Backlog. On final merge, move this whole section to `[[changelog/completed-features]]`.

Cross-app authentication audit (OSN core, Pulse, Zap, Cire, shared crypto/auth). Findings are grouped into parallel workstreams **W1–W7**, chosen to minimise file overlap so they can be actioned independently/simultaneously. Each item carries `file:line` + the fix + severity, and cross-references the existing Security Backlog ID where a finding is already tracked (don't double-track — close it there when the workstream lands).

**Sequencing for parallel agents:**
- **W3 (shared rate-limit) should land first** — W4 and W5's per-IP limiter work both consume the same `getClientIp`.
- **W6-O1 pairs with W7-X2** (issuer + clock-skew must change on signer and verifier together).
- W1 (Zap token model) and W5-C1 (Cire claim code) are the only genuinely *exploitable* items — everything else is hardening. Prioritise them.

### W1 — Zap token model (Critical) — `zap/api`

- [x] AUDIT-Z1 — **Replace hand-rolled HS256 shared-secret verification with `@shared/osn-auth-client`.** `zap/api/src/routes/chats.ts:23-37` verifies bearer tokens with a symmetric `OSN_JWT_SECRET` (default `"dev-secret-change-in-prod"`) and trusts `sub`/`profileId` with no audience or algorithm pin — the verifier holds signing material, so anyone with the secret can forge a token for any `profileId`, and it can't validate real OSN ES256 tokens at all. Add the `@shared/osn-auth-client` dep, swap to `extractClaims(authHeader, OSN_JWKS_URL, { audience: "osn-access" })`, delete `OSN_JWT_SECRET` + the HS256 path. Closes **S-L1 (zap)** (algorithm allowlist) and the missing-`aud` gap in one change — see [[rate-limiting]], CLAUDE.md `@shared/osn-auth-client`.
- [x] AUDIT-Z2 — Validate `sub` shape (e.g. `usr_` prefix) post-verify before writing `created_by_profile_id` / `sender_profile_id` (`zap/api/src/routes/chats.ts:31-33`). Defence-in-depth once Z1 lands.

### W2 — Zap authorization & consent (High/Med) — `zap/api/src/services`

- [x] AUDIT-Z3 — `createChat` trusts `memberProfileIds` (up to 500) with no relationship/consent check (`zap/api/src/services/chats.ts:143-159`) → forced-add / messaging spam. Gate added members on an OSN social-graph relationship (ARC S2S) or invite-accept; enforce DM = exactly 2 members; wire the unused `blocked` denial metric (`zap/api/src/metrics.ts:69`).
- [x] AUDIT-Z4 — `addMember` is admin-gated but performs no target-consent check (`zap/api/src/services/chats.ts:193-246`). Same consent/graph gate as Z3.
- [x] AUDIT-Z5 — `removeMember` can remove the last admin, orphaning the chat (`zap/api/src/services/chats.ts:248-285`). Add a "cannot remove last admin" invariant. Closes **S-L3 (zap)**.
- [x] AUDIT-Z6 — Cursor pagination uses a foreign/unknown cursor id verbatim and returns page 1 on a bad cursor (`zap/api/src/services/messages.ts:128-140`) — minor cross-chat leak + confusing contract. Scope the cursor lookup to `chatId`; reject unknown cursors with a validation error.
- [x] AUDIT-Z7 — No ARC S2S trust boundary exists (`zap/` has no `@shared/crypto` dep). Plan an ARC-verified internal surface (e.g. `POST /internal/chats`) on a separate middleware from the user-token routes (mirror cire) before M2 wires Pulse→Zap event-chat provisioning. Relates to **S-M3 (zap)**.
- Note: existing **S-M1/S-M2/S-M4/S-M5/S-M6 (zap)** (rate limiting, CORS, atomic cross-DB write, event-type check, UUID width) also belong to this workstream.

### W3 — Shared rate-limit IP hardening (High) — `shared/rate-limit` ⚠ land first

- [x] AUDIT-S1 — `getClientIp` trusts the first `X-Forwarded-For` hop (spoofable → per-IP limit bypass) and collapses header-less callers into one shared `"unknown"` bucket (one abuser DoSes everyone) (`shared/rate-limit/src/index.ts:85-89`). Add a `trustProxy`/trusted-hop option; resolve from the trusted proxy hop / socket peer (or `cf-connecting-ip` on Workers); fail closed when unresolvable. Closes **S-M34** and **S-L2 (share-attribution)**; unblocks W4/W5 limiter work.

### W4 — Pulse rate-limiting, CORS & exposure (Med) — `pulse/api`

- [x] AUDIT-P1 — Authenticated write endpoints have no rate limiting — event create/update, RSVP, bulk invite, comms blast (`pulse/api/src/routes/events.ts:363,420,663,793,907`), plus `series.ts` and `closeFriends.ts`. Add per-user (`claims.profileId`) fail-closed limiters. Subsumes **S-L1 (series)** and **S-L1 (pulse-close-friends)**.
- [x] AUDIT-P2 — Rate limiters are instantiated with in-memory backends and never wired to Redis despite the injection seam (`pulse/api/src/index.ts:28-35`) → per-process limits that reset on deploy. Add a composition root that builds Redis-backed limiters when `REDIS_URL` is set.
- [x] AUDIT-P3 — Restrict bare `cors()` to known app origins (`pulse/api/src/index.ts:24`). Closes **S-L2 (auth)**.
- [x] AUDIT-P4 — Unauthenticated `POST /events/:id/exposure` accepts a client-supplied `source` and bumps counters with no throttle/replay protection (`pulse/api/src/routes/share.ts:44-71`). Add a per-IP limit (after W3); consider an HMAC'd share token in the `?source=` link. Relates to **S-L2 (share-attribution)**.
- [x] AUDIT-P5 — Attendee list exposed to any viewer who can see the event (`pulse/api/src/routes/events.ts:312-340`) — friends-visibility events let any organiser-friend enumerate every attendee. Add a `canViewAttendees` policy (organiser/co-hosts) or return counts to non-organisers — see [[event-access]].

### W5 — Cire claim-code & guest sessions (High) — `cire/api`

- [x] AUDIT-C1 — **Claim code is ~32-bit, single-factor, throttled only per-isolate.** `publicId` = guessable `SURNAME-` prefix + `crypto.randomUUID().slice(0,8)` (`cire/api/src/services/import.ts:43-51`); it's the sole guest credential and the only throttle is an in-memory `createRateLimiter` that on Cloudflare Workers is per-isolate, not global (`cire/api/src/app.ts:20`, no KV/DO binding in `wrangler.toml`). Raise the suffix to ≥64-bit `getRandomValues` base32, drop the surname from the security-bearing portion, and move the limiter to a shared backend (CF KV / Durable Object / Rate-Limiting binding). **Also correct `cire/wiki/todo/security.md`, which wrongly states the claim limiter is "KV-backed".**
- [x] AUDIT-C2 — `sessionService.revokeAllForFamily` is dead code and there is no claim-code rotation path (`cire/api/src/services/session.ts:128`). Add an organiser "regenerate family code" op that updates `families.publicId` + calls `revokeAllForFamily(familyId)` in one transaction, so a leaked code can be rotated and its ≤30-day sessions evicted.
- [x] AUDIT-C3 — Confirm guest session expiry is enforced on the read path; add `and(eq(tokenHash,…), gt(expiresAt, now()))` to the lookup if absent (`cire/api/src/services/guestSession.ts`).
- [x] AUDIT-C4 — On Workers, key the limiter strictly on `cf-connecting-ip` and fail closed when absent (`cire/api/src/lib/client-ip.ts`). Folds into W3.
- [x] AUDIT-C5 — Add Origin-header validation on state-changing routes (`POST /api/claim`, `/api/rsvp`); today only `SameSite=Lax` defends CSRF. Closes **S-L3 (cire)** — mirror `osn/api/src/lib/origin-guard.ts`.
- [x] AUDIT-C6 (low) — Rotate the guest session token on `POST /api/account/link` (auth-state transition → fixation defence) (`cire/api/src/routes/account.ts`).

### W6 — OSN core hardening (Med/Low) — `osn/api`

- [x] AUDIT-O1 — Set `iss` and add `clockTolerance` to JWT sign/verify (`osn/api/src/services/auth.ts:350-366,1601-1629,2846-2918`). Defence-in-depth + fewer spurious cross-host 401s on the 5-min-TTL refresh path. **Pair with W7-X2.**
- [x] AUDIT-O2 — Recovery-code login has only a per-IP limiter, no per-account lockout (`osn/api/src/services/auth.ts:2641-2750`). Add a per-account failed-attempt counter + temporary lockout + security-event, mirroring the OTP path (`MAX_OTP_ATTEMPTS`).
- [x] AUDIT-O3 — Multi-pod gap: WebAuthn challenge / OTP / pending-registration / pending-email-change / CDL stores and the per-account rate caps are process-local `Map`s (`osn/api/src/services/auth.ts` ~233-657), so begin/complete ceremonies break across pods and the security rate caps degrade to `N×limit`. Give them the injectable-Redis treatment already applied to the jti/rotation stores, or document the single-pod constraint + pin sticky routing.
- [x] AUDIT-O4 — Passkey-registration "invalidate other sessions" (H1) silently no-ops when the session cookie is absent (`osn/api/src/services/auth.ts:1849-1851`); mirror `deletePasskey`'s cookieless branch which invalidates all account sessions.
- [x] AUDIT-O5 (low) — Optional: bind step-up tokens to the issuing session/access-token (`sid`/`cnf` claim) for the most destructive purposes; randomise the enumeration-probe `accountId` so the burn-in predicate isn't a cacheable constant (`osn/api/src/services/auth.ts:2807-2918,1941-1947`).

### W7 — Shared crypto / osn-auth-client (Med/Low) — `shared/crypto`, `shared/osn-auth-client`

- [x] AUDIT-X1 — Add an optional `expectedIssuer` param to `verifyArcToken` and thread it into `jwtVerify`'s `issuer` option (`shared/crypto/src/arc.ts:96-143`); have both ARC middlewares supply it. Today cross-issuer safety is only an emergent property of every caller binding kid→issuer — give the primitive its own defence — see [[arc-tokens]].
- [x] AUDIT-X2 — Add `iss` + `clockTolerance` to access-token verification (`shared/osn-auth-client/src/verify.ts:65`). **Pairs with W6-O1.**
- [x] AUDIT-X3 — ARC token cache key omits `ttl` and uses un-normalised scope (`shared/crypto/src/arc.ts:344-360`) → a caller can receive a shorter-lived cached token than it requested, plus cache fragmentation. Include `ttl` in the key and normalise scope before keying.
- [x] AUDIT-X4 — Document the ≤5-min cross-process ARC public-key revocation window (`shared/crypto/src/arc.ts:154-164`); consider a shorter cache TTL or a pub/sub eviction signal in multi-instance deploys — see [[arc-tokens]].
- [x] AUDIT-X5 (low) — Guard the in-memory Redis client `eval` so a future non-rate-limit Lua script can't silently get rate-limit semantics in dev/test (`shared/redis/src/client.ts:176-193`).

### Verified sound (no action)

Token-verification core (audience enforced inside the single `jwtVerify` pass, ES256/`alg` pinning, alg:none + HS/RS confusion structurally blocked, JWKS amplification defences), OSN session rotation + family-revocation + cookie-only refresh, Cire two-auth separation + guest tenant-scoping + additive `/account/link`, and Pulse single-source-of-truth visibility with no IDOR were all reviewed and found sound. The items above are hardening, except **W1** and **W5-C1**, which are genuinely exploitable.

---

## Pulse (`pulse/app` + `pulse/api` + `pulse/db`)

- [x] "What's on today" default view — unified into the discovery feed on `ExplorePage`; default view is `from = now` with the chip rail + more-filters drawer layered on top
- [x] Prompt for max event duration when creating events without an endTime — duration presets + `maybe_finished` status at 8h, auto-close at 12h, 48h defence-in-depth cap on explicit endTimes (moved to `[[changelog/completed-features]]`)
- [x] Event discovery (location, category, datetime, friends, price) — `GET /events/discover` with cursor pagination; bbox + haversine for radius; friends branch unions organiser ∈ connections and RSVP ∈ connections (positive engagement only — `going` / `interested`) and respects `attendanceVisibility=no_one`; per-IP rate limit; interests deferred until the Pulse interest profile onboarding lands. See `[[event-access]]` for the shared visibility-filter helper consumed by `listEvents` and `discoverEvents`.
- [x] **Pulse new-user onboarding flow** — six-step `/welcome` flow with themed coral illustrations (welcome rings, editorial map, interest constellation, location pin drop, notifications ember, finish date stamp). Account-keyed via new `pulse_account_onboarding` table + `pulse_profile_accounts` mapping cache + `GET /graph/internal/profile-account` ARC endpoint (preserves the multi-account privacy invariant in `[[identity-model]]`). Captures interests (≤8), `notifications_perm`/`location_perm` outcomes, and reminder opt-in. Idempotent `POST /me/onboarding/complete`. Server-side first-run gate redirects to `/welcome`. See `[[pulse-onboarding]]`. (Move to `[[changelog/completed-features]]` on merge.)
- [x] **Pulse calendar agenda page** — `/calendar` route in `@pulse/app` rendering a vertical-timeline agenda (continuous left rail with per-day dated markers; events listed to the right). Lists events the viewer is hosting OR has RSVP'd Going/Maybe to; "Maybe" entries surface an inline reminder to confirm (I'm going) or drop (Can't make it). Backed by a new auth-gated `GET /events/calendar` endpoint + `listMyCalendarEvents` service (UNION-of-two-arms shape so cost scales with per-user data, not global event volume — see P-W1 fix below). Also a full end-to-end rename of the RSVP status value `interested` → `maybe` (DB enum value, API wire value, metrics, UI; no legacy alias). New `pulse.calendar.events.fetched` counter + `pulse.calendar.list_mine` span. (Move to `[[changelog/completed-features]]` on merge.)
- [ ] Wire captured interests into the discovery feed — add a "For you" chip to `ExplorePage` that filters/boosts events by the account's onboarding interests (data lives in `pulse_account_onboarding.interests` — see `[[pulse-onboarding]]`)
- [ ] Pulse user preferred currency — add a currency field to `pulse_users`, drive the discovery drawer's price filter from it (today the client uses a USD default)
- [ ] Discovery v2 — AI prompt filter surfaced after extended scrolling, server-side free-text search (currently client-side over the returned page)
- [x] Recurring events (series + instances) — shipped on `claude/add-recurring-events-11qp9`: `event_series` schema, RRULE expander, `/series` routes, seed fixtures, `SeriesDetailPage`
- [ ] Event group chats (via Zap once M2 lands — placeholder shipped)
- [ ] Organizer tools (moderation, blacklists)
- [x] Venue pages — org-scoped venue detail page (`/venues/:orgHandle/:venueHandle`) with lineup timeline, event carousel, open/closed badge + clickable venue layer on the Explore map; `venues` + `event_lineup` tables. See [[venues]]. (Move to [[changelog/completed-features]] on merge.)
- [x] **Share button with RSVP source attribution** — event detail picker (Popover desktop / Dialog mobile) covering Instagram/Facebook/TikTok/X/WhatsApp/copy-link/system-share-sheet, injects `?source=…` into shared URLs. New `event_rsvps.share_source_first` (sticky) + `share_source_last` (overwriting) columns + `*_seen_at` timestamps. Two unauthenticated rate-limited endpoints (`POST /events/:id/share`, `/exposure`) gated by a lightweight `checkEventVisibility`. Four new bounded-cardinality counters: `pulse.events.share.invoked`, `pulse.events.share.exposure`, `pulse.rsvps.attribution.first`, `pulse.rsvps.attribution.last`. Organiser self-RSVPs and self-views excluded from attribution. See `[[event-access]]`. (Move to `[[changelog/completed-features]]` on merge.)
- [ ] Venue discovery links beyond the Explore map — link into venue pages from event detail + search surfaces (deferred from the venue-pages branch — see [[venues]])
- [ ] **Organiser attribution-analytics surface** — read path that aggregates `event_rsvps.share_source_first` / `share_source_last` into a per-event funnel (exposures → first-touch RSVPs → last-touch RSVPs by platform). Will need the composite indexes called out in `P-I3 (share-attribution)`. See `[[event-access]]`.
- [ ] **Wire Zap + future OSN-native share targets** into the share-source enum (`pulse/api/src/lib/shareSource.ts` + `pulse/app/src/lib/shareSource.ts`) once those surfaces exist. Cardinality stays bounded; today's `other` bucket absorbs them in the interim.
- [ ] Real SMS/email comms providers — `sendBlast` is stubbed (writes to `event_comms`); plug in actual delivery
- [x] **Dead metric emitters (2026-07-03 quality review)** — resolved per-emitter (2026-07-05): `metricJwksCacheLookup` + counter + attrs **deleted** (JWKS cache lives in `@shared/osn-auth-client`, uninstrumented — also closes the Platform "Dead JWKS-cache metric cleanup" row); `metricEventCreateDuration` **wired** via `withEventCreateDuration` around `createEvent`; `metricPulseHostCancelledHardDelete` **wired** into `runEventCancellationSweep` (ok per purged event, error on failed batch). (`zap/api`'s `metricWsConnection` / `metricWsMessageDelivered` remain deliberately pre-declared for the in-flight M1 WebSocket transport.) See [[observability/overview]].
- [x] **`notifyAppJoined` bridge unwired (2026-07-03 quality review)** — **Wired 2026-07-07.** `completeOnboarding` now fires `notifyAppJoined(accountId)` on the first-completion branch as a best-effort `forkDaemon` (new `pulse.onboarding.enrollment_notify{result}` metric). This inserts the `app_enrollments` row that osn-api's full-account-delete fan-out reads — without it, deleting an OSN account silently skipped Pulse. Residual gap: no join-side retry sweeper yet (unlike the leave side), so a transient osn-api outage during onboarding leaves the enrollment row uncreated until the next completion. See [[s2s-patterns]].
- [ ] **Split `pulse/api/src/routes/events.ts`** — **partially done 2026-07-07:** `createSettingsRoutes` extracted to `routes/settings.ts` (clean — it was already a separate `/me` factory). **Remaining:** extract the discovery/share/exposure routes to `routes/discovery.ts`. Deferred because those routes sit mid-chain inside the single `createEventsRoutes` Elysia builder and share closures (`runtime`, `resolveIp`, `checkPerIpLimit`, the per-IP limiters) with the CRUD/RSVP routes — extracting them needs those closures lifted into a shared helper first, so it's a larger, higher-risk surgery on the hottest route file than a same-PR cleanup warrants. (2026-07-03 quality review)
- [x] Drizzle: extract shared `createSchemaSql()` helper so adding a column is a one-file change — shipped on `claude/drizzle-pulse-todo-cX5ps`: `@pulse/db/testing` export with `createSchemaSql()` + `applySchema()`, derived from the live Drizzle schema in FK-respecting order; replaces four hand-rolled DDL blocks across `pulse/db` and `pulse/api` tests; drift-guard regression test in `pulse/db/tests/testing.test.ts`
- [ ] Verified-organisation tier (Phase 2): org accounts can run events over `MAX_EVENT_GUESTS` (1000) via per-event support flow

---

## OSN Core (`osn/api`)

- [x] Multi-account profile CRUD (P3) — create/delete/set-default profiles, maxProfiles enforcement, cascade delete, observability
- [x] Multi-account client SDK (P4) — multi-session storage, profile switching, schema validation, security hardening
- [x] Multi-account UI (P5) — profile switcher component, create form, onboarding
- [x] Multi-account privacy audit (P6) — accountId leak verification, per-profile rate limits
- [ ] Per-app vs global blocking logic (deferred — global blocking across all OSN apps for now)
- [ ] Interest profile selection (onboarding)
- [ ] Third-party app authorization flow
- [x] Organisation frontend — standalone `@osn/social` app delivered (2026-04-16); Tauri wrapping deferred
- [x] Merge `@osn/core` into `@osn/api`, move `@osn/crypto` → `@shared/crypto`; ARC audience updated `"osn-core"` → `"osn-api"`
- [x] Step-up (sudo) tokens (M-PK1) — ES256 JWTs with `aud: "osn-step-up"`, passkey/OTP ceremonies, required on `/recovery/generate` + `/account/email/complete` — see [[step-up]]
- [x] Session introspection + per-device revocation — `GET /sessions`, `DELETE /sessions/:id`, `POST /sessions/revoke-all-other`, coarse UA labels, HMAC-peppered IP hash, `last_used_at` — see [[sessions]]
- [x] Email-change ceremony — step-up gated, OTP to new address, transactional other-session revoke, 2-per-7-days cap, `email_changes` audit table
- [x] Session + `AccountSession` types drop `refreshToken` — cookie-only first-party; `AccountSession.hasSession` replaces stored refresh token. `/logout` body no longer accepts `refresh_token`.
- [x] Cross-device login — QR-code mediated session transfer (4 endpoints: begin, status, approve, reject). In-memory store, 256-bit secret, SHA-256 hashed at rest, security_events audit + email notification. Client SDK + UI deferred to follow-on — see [[sessions]]
- [ ] Recommendations SQL aggregation + compound indexes (P-W7) — push FOF counting into DB, add `connections(status, requester_id)` + `connections(status, addressee_id)` — see [[social-graph]]
- [ ] Unified `handles` reservation table (user + org handles share namespace; currently enforced at service layer — see Deferred Decisions)

---

## Zap (`zap/app` + `zap/api` + `zap/db`)

OSN's messaging app. Stack matches Pulse (Bun, Tauri+Solid, Elysia+Eden, Drizzle+SQLite, Effect.ts) unless a real reason emerges to diverge. Signal Protocol lives in `@osn/crypto`, not `zap/`.

### M0 — Scaffold (remaining)

- [ ] `bunx create-tauri-app` for `@zap/app` (iOS target enabled, Solid template)
- [ ] `@zap/app` consumes `@osn/client` + `@osn/ui/auth` for sign-in (re-uses `<SignIn>` / `<Register>` from Pulse)
- [ ] Register `zap-app` and `zap-api` in `service_accounts` + `service_account_keys` (ARC issuer rows + initial key)

### M1 — 1:1 DMs (E2E)

- [ ] Signal Protocol primitives in `@shared/crypto/signal` — **PQXDH** handshake (post-quantum hybrid: X25519 + ML-KEM-768) and double ratchet. Classical-only X3DH is HNDL-exposed and must not ship for durable message ciphertext
- [ ] WebSocket transport for live message delivery (`@zap/api`)
- [ ] Push receipt + read receipt model (defer push notifications to M4)
- [ ] `@zap/app` Socials view: chat list + message thread UI
- [ ] Resolve recipients via `@osn/client` (handle → user lookup) + ARC-gated `/graph/internal/connections` to filter out blocked users
- [ ] Test coverage: handshake, ratchet, message ordering, blocked-user enforcement
- [ ] Disappearing messages flag at chat level + per-message TTL sweep

### M2 — Group chats

- [ ] Group session establishment (sender keys or MLS — pick one and document)
- [ ] `@zap/db` schema: `chat_role` (admin/member), `chat_invites`
- [ ] Add/remove members, role transitions, invite links
- [ ] Group-level disappearing-message defaults
- [ ] Show linked event overview inside the chat settings sheet (read from `@pulse/api` via Eden or ARC-gated S2S)
- [ ] Test coverage: group rekeying on member removal, race conditions on simultaneous joins

### M3 — Organisation chats (the differentiator)

- [ ] Verification flow (manual review for now; document the criteria)
- [ ] `org_chats` and `org_agents` schemas in `@zap/db` — assignment, queue, status (open/pending/resolved), SLA timestamps
- [ ] Organisation-side dashboard (separate `@zap/app` view, role-gated): inbox, agent assignment, transcript export, analytics
- [ ] Embeddable web widget — small standalone bundle (Vite + Solid) shipped from `@zap/api` static
- [ ] E-commerce checkout integration: capture OSN handle alongside email at checkout
- [ ] Public REST API for orgs to ingest support context from third-party systems

### M4 — Locality / government channels

- [ ] Locality opt-in flow in `@zap/app` (permanent home + temporary travel subscriptions with expiry)
- [ ] `localities` and `locality_subscriptions` schemas in `@zap/db`; `locality_org` join to organisations
- [ ] Push channel for verified locality/government broadcasts (one-way; users can ask follow-ups via org channel)
- [ ] AI-assisted query endpoint scoped to a locality — defer model choice
- [ ] Privacy: locality stored on device + minimal server-side join; user-resettable
- [ ] Test coverage: travel subscription expiry, broadcast fan-out, query authority filtering

### M5 — Polish + AI view + native

- [ ] Themes (token-driven, share `@osn/ui` design tokens)
- [ ] Stickers + GIFs (third-party provider TBD; needs CSP review)
- [ ] Polls (per-chat, with privacy mode)
- [ ] Easter-egg mini-games (scoped, opt-in)
- [ ] AI view: dedicated tab for model conversations, quarantined from Socials inbox
- [ ] Push notifications (APNs first, FCM later)
- [ ] Backup options: encrypted cloud / self-hosted / local-only
- [ ] Device transfer flow (key migration, backup restore)

### Cross-cutting / open questions

- [ ] Signal vs MLS for group chats — decide before M2
- [ ] Storage backend at scale: SQLite → Postgres / Supabase when message volume forces it
- [ ] Message media (images, video, voice notes) — needs E2E-friendly blob storage. Defer to post-M2
- [ ] Spam / abuse model for organisation handles — verification gate is M3 but needs ongoing review tooling

---

## Cire (`cire/web` + `cire/organiser` + `cire/api` + `cire/db`)

Wedding-invite stack merged from cire.git (2026-06). Cire-internal feature work tracks in `cire/wiki/todo/` shards; this section holds the OSN-facing integration work. See [[cire]] and [[cire-auth]].

- [x] **`diffAgainstDb` wedding-scoping** — `cire/api/src/services/import.ts` `diffAgainstDb` is `weddingId`-scoped (tenant-isolated preview/apply/revert; `guest_events` join load-bearing). See [[cire]]. (Moved to [[changelog/completed-features]].)
- [x] **Multiple weddings (#147)** — organisers list / select / create weddings (`GET`/`POST /api/organiser/weddings`); every wedding-scoped route carries an explicit `:weddingId`; import routes rescoped to `/api/organiser/weddings/:weddingId/import/*`. See [[cire-auth]]. (Moved to [[changelog/completed-features]].)
- [x] **Co-hosts by OSN handle (#148)** — new `wedding_hosts` table + owner-or-host `weddingMember()` gate; handle → profile id resolved via ARC-gated osn-api `GET /graph/internal/profile-by-handle`. See [[cire-auth]]. (Moved to [[changelog/completed-features]].)
- [x] **Per-section invite theming (#152)** — bounded, CSS-injection-safe fonts + colours; migration `0014`. See [[cire]]. (Moved to [[changelog/completed-features]].)
- [x] **Any OSN user is a first-class organiser (#156)** — `ensureBootstrapOwner` 503 gate + `BOOTSTRAP_OWNER_PROFILE_ID` removed; migration `0015` drops `wed_bootstrap`. See [[cire-auth]]. (Moved to [[changelog/completed-features]].)
- [x] **Organiser Security / Devices section (#155)** — `PasskeysView` (list/add/rename/remove) + passkey-only step-up in the portal `SecurityPanel`. See [[passkey-primary]]. (Moved to [[changelog/completed-features]].)
- [x] **Host-preview RSVP is an interactive no-op** — the organiser host preview's RSVP was greyed out (`disabled` in preview mode); it's now fully interactive with submit short-circuited to a no-op + a "nothing you send here is saved" banner (`RsvpModal` `preview` prop). Lets a host feel the guest flow without writing RSVP data. See [[cire-landing]].
- [ ] Pulse event-feed integration — surface cire weddings in Pulse's discovery/feed. Blocked on the mechanism decision (ARC-token pull from `cire/api` vs push-on-publish into `pulse/db`) — see Deferred Decisions.
- [ ] Co-host **roles** — membership shipped (#148, read-only co-hosts); add a role column (`owner`/`editor`/`viewer`) so a co-host (partner / planner) can be granted write access short of ownership. See [[cire-auth]].
- [ ] Guest claim-code → optional OSN account linking (frontend) — backend shipped; the guest-site "link my Pulse account" affordance remains (guests stay deliberately account-free — see [[cire-auth]]).
- [x] **IB-S-L1 / colour-allowlist duplication (#152)** — single source of truth factored into the new zero-dependency `@cire/theme` package (`isSafeCssColor`); `cire/api` (write-time) and `cire/web` (render-time) both import it, so the CSS-injection-safe guarantee can't drift — see [[cire]]. (Moved to [[changelog/security-fixes]].)

---

## Cire Landing (`cire/landing`)

Static marketing site for the apex `cireweddings.com`. Full design + deploy +
domain-migration plan in [[cire-landing]].

- [x] **Build `@cire/landing`** — static Astro + SolidJS + Tailwind v4 marketing site; brand tokens kept byte-identical to `cire/web`. Promise/features/how-it-works/craft/FAQ sections, hotlinked-Unsplash imagery (centralised + swappable in `lib/site.ts`), legal drafts, `SiteFooter`. See [[cire-landing]].
- [x] **Full-page envelope hero** — the whole first screen is the front of a sealed envelope (`WaxSealHero` + `WaxSeal.motion.ts`) that opens to unveil the page.
- [x] **Generative scroll-grown vine backdrop** — `VineCanvas` + `lib/vines/` (seeded PRNG + Catmull-Rom smoother, unit-tested for determinism); SSR roots + per-load-unique client field, vines draw on as you scroll, per-element reveal locked to the growth front. Scroll-paint culled to in-view vines; resize-regen gated to width changes. See [[cire-landing]].
- [x] **Interactive no-op demo invite** — in-page "See it live" invitation (`demo/DemoRsvp.tsx`); RSVP is fully interactive but never hits the network (test-asserted).
- [x] **Hidden testimonials** — section designed but gated behind `SHOW_TESTIMONIALS = false` until real, permissioned quotes exist.
- [x] **CI deploy** — `deploy-cire-landing` (in `deploy.yml`) + a push-triggered `deploy-landing-preview.yml`; both ship to a **non-apex** Pages preview (`cire-landing.pages.dev`); apex untouched so live invites don't break. The `cire-landing` Pages project is auto-created on first deploy.
- [ ] **Replace the wax-seal graphic** — the hero's seal disc is a `TODO(design)` placeholder pending a separately designed asset; only the inner seal `<div>` needs swapping. See [[cire-landing]] "Deferred".
- [ ] **Apex cutover (separate, reviewed change)** — move `cire/web` → `invite.cireweddings.com` (+301 from old invite paths), `cire/organiser` → `host.cireweddings.com` (update WebAuthn `OSN_ORIGIN`/CORS), point `PUBLIC_ORGANISER_URL`/`SITE` at the new hosts, then flip `cire/landing` onto the apex. Also fold in **S-L1/S-L2** hardening (self-host fonts, proxy imagery, drop CSP `'unsafe-inline'`; list Unsplash + Google Fonts in [[subprocessors]]). See [[cire-landing]], [[production-deploy]].
- [ ] **Real hero/gallery art** — replace the hotlinked Unsplash placeholders in `lib/site.ts` with brand photography.
- [ ] **Wire a real demo invite** — set `PUBLIC_DEMO_INVITE_URL` to a seeded read-only invitation so "See a live invite" links out instead of scrolling to the in-page demo.

### Platform roadmap (withjoy parity)

- [ ] **Gift registry** — first-class registry surface (parity with withjoy).
- [ ] **Wedding-management platform** — budget, vendors, seating, timeline, guest comms — built out from the organiser dashboard (`host.cireweddings.com`). Multi-tenant `weddings` root already in place. See [[cire]].
- [ ] **Marketing depth** — pricing page, case studies, blog/SEO content; flip testimonials live once permissioned.

---

## Landing (`osn/landing` + `pulse/landing`)

- [x] **Build `@osn/landing`** — static Astro + SolidJS + Tailwind v4 marketing site; dark-grey / dotted-network identity (`ConstellationCanvas` backdrop + `ConnectionsHero`), connections-led copy, Apps/Principles/FAQ sections, legal drafts, tight CSP, `data-reveal` reveal. Space Grotesk + Inter. Dev port 4324. See [[osn-landing]].
- [x] **Build `@pulse/landing`** — static Astro + SolidJS + Tailwind v4 marketing site following `pulse/DESIGN.md`; colourful + fun (`PulseField` backdrop + `PulseHero`, colourful Categories showcase, Venues lineup teaser). Instrument Serif / Geist / Geist Mono. Dev port 4325; root script `dev:pulse-landing`. See [[pulse-landing]].
- [x] **CI preview deploy** — `.github/workflows/deploy-osn-pulse-landing.yml` builds + ships both sites to their own Cloudflare Pages previews on every branch push: **`osn-landing.pages.dev`** and **`osn-pulse-landing.pages.dev`** (the plain `pulse-landing` subdomain was already taken by an unrelated account). Pulse is a hybrid static + Pages Function deploy (`/api/geo`). See [[osn-landing]], [[pulse-landing]].
- [ ] **Domains** — replace the placeholder `SITE` / `PUBLIC_APP_URL` build vars with real hosts once the OSN + Pulse marketing/app domains are chosen; add custom-domain Pages bindings. See [[osn-landing]], [[pulse-landing]].
- [ ] **"State's main city" geo routing** (pulse-landing) — the hero CTA currently targets the visitor's nearest Cloudflare city; add a region → capital/major-city map so small-town visitors route to their state's main city. See [[pulse-landing]].
- [ ] **Marketing depth** — pricing, deeper feature pages, real imagery/screenshots, SEO/blog content.

---

## Verified Identity (`@osn/api` + `@osn/db` + `@shared/crypto` + `@osn/social`)

Yoti-style reusable verified-attribute layer. **Australia first** —
driver's licence (DVS), mobile driver's licence (ISO 18013-5), and
myID once AGDIS opens to private-sector relying parties (30 Nov
2026). Other countries layer onto the same provider abstraction.
Cryptography: SD-JWT VC (RFC 9901 + draft-ietf-oauth-sd-jwt-vc) over
the existing OSN ES256 ARC key. See [[verified-identity]] for the
design doc, threat model snapshot, and vendor shortlist.

### V-M0 — Foundations (no provider yet)

- [ ] DPIA filing under GDPR Art. 35 — biometric template hashes +
      identity-document data are Special Category Personal Data
      (Art. 9). Block all later milestones until filed. Add to
      [[compliance/gdpr]] and link from C-M3.
- [ ] Data map + retention + subprocessor entries: new categories
      (biometric template hash, document number hash), default
      retention 24 months from `verified_at` or until document
      expiry whichever sooner, KYC vendor as a new subprocessor
      with signed DPA. See [[compliance/data-map]],
      [[compliance/retention]], [[compliance/subprocessors]].
- [ ] Vendor RFP: Persona (M1 facial age estimation, top-scoring AU
      trial vendor), idvPacific vs Equifax IDMatrix (M2 DVS
      gateway), MATTR/GBG (M3 mDL acceptance). Trade-off matrix
      lives at `wiki/verified-identity/vendor-rfp.md`.
- [ ] DB schema in `@osn/db`: `verification_providers`,
      `verification_runs`, `verified_attributes` (encrypted
      `value` column), `presentations`. New `security_events`
      kinds: `identity_verified`, `identity_presentation_issued`.
- [ ] SD-JWT VC issuer in `@shared/crypto/vc` — salted-hash
      disclosures, `aud`-bound presentations, `jti` single-use
      store mirroring [[step-up]]. ES256 key reused from ARC
      issuer; new credential audience `osn-vc`.
- [ ] `/.well-known/openid-credential-issuer` metadata + JWKS
      reuse from existing `/.well-known/jwks.json`.
- [ ] Observability: `osn.identity.verification.runs{kind, outcome}`
      counter, `osn.identity.verification.duration{kind, provider}`
      histogram, `osn.identity.presentation.issued{audience, claims}`
      counter (claims as bounded enum, not free-form).

### V-M1 — Facial age estimation

Lowest regulatory bar; closes the social-media-minimum-age (10 Dec
2025) compliance gap before harder document flows are wired.

- [ ] Persona (or chosen vendor) integration in
      `osn/api/src/services/identity/age-estimate.ts`. Pure HTTP +
      vendor SDK; selfie capture via WebAuthn-style platform API.
- [ ] `POST /identity/verify/begin { kind: "age_estimate" }` +
      `POST /identity/verify/complete` (step-up gated). On
      success, mint `age_band` + (if estimate ≥ 16 with margin)
      `age_over_16: true` attributes. Source image discarded after
      vendor returns the estimate.
- [ ] **Under-13 termination branch**: if facial-age-estimate
      returns ≤ 13 with confidence margin, abort the flow,
      do **not** persist the estimate value, do **not** log
      the value, write a generic `age_estimate_below_threshold`
      `security_event`, and return a fixed-shape failure to the
      client. This is COPPA "actual knowledge" — the moment OSN
      learns of a likely under-13 user it must not retain the
      signal that triggered the inference. See [[compliance/coppa]].
- [ ] `@osn/social` Settings → Identity tab: entry-point card
      "Confirm you're old enough" + selfie ceremony UI.
- [ ] Tighten C-H8 (registration age gate): if a verified
      `age_over_16` attribute exists, skip the self-declared
      birthdate path entirely. See [[compliance/coppa]].
- [ ] Tests: provider mock layer; refusal on margin-of-error
      bands; revocation on `DELETE /identity/attributes/age_band`.

### V-M2 — AU document verification (DVS + selfie + face-match)

- [ ] Department of Home Affairs DVS registration paperwork +
      DVS-approved consent statement (verbatim) shown before each
      DVS call; consent record retained.
- [ ] DVS gateway provider integration (idvPacific or Equifax
      IDMatrix). Document capture + OCR client-side; submit
      extracted fields to DVS for yes/no match.
- [ ] Liveness selfie + face-match against the licence photo.
      Provider returns face-match score; OSN refuses below
      configurable threshold.
- [ ] Mint attributes: `dob`, `given_name`, `family_name`,
      `country=AU`, `document_type`, `document_expires_at`,
      `document_number_hash` (SHA-256 + per-attribute pepper —
      lets us refuse Sybil re-use without retaining the number).
      Pre-compute boolean predicates `age_over_16`, `age_over_18`
      alongside `dob`.
- [ ] Settings → Identity: list verified attributes with
      provenance ("Verified 12 Jan 2026 via NSW driver licence")
      and per-attribute revoke.
- [ ] Tests: DVS no-match path returns generic failure (no
      enumeration oracle); face-match below threshold; replay of
      same document number across accounts blocked.

### V-M3 — mDL acceptance (ISO 18013-5 / 18013-7)

- [ ] CBOR/COSE verifier for state-issued mDL presentations
      (NSW + QLD live; others as they roll out late 2026). MATTR
      SDK or hand-rolled — decide in V-M0 vendor RFP.
- [ ] Re-issue mDL claims as OSN SD-JWT VCs so downstream
      relying parties see one credential format on the holder
      side.
- [ ] Settings → Identity: "Verify with your phone's digital
      driver licence" entry alongside the document upload flow.

### V-M4 — Relying-party API (Pulse, Zap, third-party)

- [ ] `POST /identity/presentation/request` (RP-facing) — accepts
      claim set + audience + nonce, returns OAuth-style consent
      URL.
- [ ] `POST /identity/presentation/issue` (user-facing) — after
      consent + step-up, releases SD-JWT VC for **only** the
      requested claims with the audience binding.
- [ ] OpenID4VP wire format so external apps can integrate
      against a published spec rather than an OSN-bespoke one.
- [ ] Pulse: optional "verified attendees only" event setting +
      "host requires verified given-name" gate on RSVP.
- [ ] Zap M3: trader-traceability flow (DSA Art. 30, C-M12)
      consumes verified `given_name` / `country` / business
      registration ID.
- [ ] Per-RP audit trail in `presentations` + user-facing
      "Connected apps" view showing every prior presentation.

### V-M5 — myID / AGDIS

Unblocked 30 Nov 2026 when private-sector relying parties become
eligible under the Digital ID Act 2024.

- [ ] AGDIS accreditation paperwork (relying-party tier).
- [ ] Accept myID assertion as a verification source — yields
      higher-assurance attributes than DVS for the same fields,
      plus reduces vendor lock-in to a single KYC provider.
- [ ] Settings → Identity: "Verify with myID" surface.

### V-M6 — Other countries

- [ ] UK: DIATF-accredited provider (Yoti, Onfido, Persona) for
      passport / driving-licence verification.
- [ ] EU: eIDAS 2.0 / EUDI Wallet acceptance (SD-JWT VC
      interoperable on the wire — same verifier code).
- [ ] US: state mDL acceptance (Apple / Google wallet) as it
      rolls out; plus document-verification provider for
      driver's licence + state ID.

### Cross-cutting / open questions

- [ ] Which verified attributes are "always public" once minted
      (e.g. `country` for compliance routing) vs always
      consent-gated (DOB, full name)?
- [ ] BBS+ unlinkable VC vs SD-JWT-per-audience for cross-RP
      correlation defence — defer to v2 unless a documented
      threat lands.
- [ ] How does verified identity interact with multi-account
      profiles (P3-P6)? Verification is account-level; profile
      switching exposes the same attributes — is that the right
      ergonomic, or should profile-A be able to present `age_over_18`
      while profile-B presents nothing?
- [ ] Step-up requirement on every presentation vs cached
      consent (e.g. "Pulse can re-use my `age_over_16` for 30
      days without prompting") — UX vs privacy trade-off.

---

## Platform

### Pulse events API (`pulse/api`)

- [ ] Batch status-transition `UPDATE`s in `listEvents`/`listTodayEvents` (currently N individual writes)
- [x] Eliminate extra `getEvent` round-trip in `createEvent` via `RETURNING *` — was already shipped as P-I7 (`db.insert(events).values(row).returning()` in `services/events.ts`); stale row checked off 2026-07-05
- [x] S2S graph access: graphBridge migrated to ARC-token HTTP calls against `/graph/internal/*` (direct @osn/core import removed)
- [ ] OSN/messaging domain modules
- [ ] WebSocket setup for real-time
- [ ] REST endpoints for third-party consumers
- [x] Dead JWKS-cache metric cleanup — **deleted** (2026-07-05): `metricJwksCacheLookup` + `authJwksCacheLookups` counter + `JwksCacheLookupAttrs` removed from `pulse/api/src/metrics.ts`; the now-unused `JwksCacheResult` type removed from `@shared/observability`. Re-add in the shared package if `@shared/osn-auth-client`'s cache is ever instrumented — see [[observability/overview]]

### Client SDK (`osn/client`)

- [ ] Export an `isAuthExpiredError()` helper from `@osn/client` — Effect's FiberFailure wrapping defeats `instanceof AuthExpiredError`, so consumers string-match the error printout today (see `cire/organiser/src/lib/api.ts:isAuthExpired`). Ship a tag/printout-aware predicate next to the error class — see [[cire-auth]]

### Database (`osn/db`, `pulse/db`)

- [x] Local DB dev tooling — root + per-package `db:reset` across `osn/db`/`pulse/db`/`zap/db`/`cire/db` (wipe → `db:push` → seed; seed skipped where no seed file, without swallowing real failures). `cire/db` `db:seed` runs `scripts/cire-db-seed.sh` (seeds local D1 + re-points the bootstrap wedding owner from `CIRE_DEV_OWNER_PROFILE_ID`); `cire/db` drizzle.config points `db:studio` at the local miniflare D1 sqlite; `cire/api` `local.ts` re-points the bootstrap wedding owner so the signed-in dev account owns it. Dev-only — no shipped runtime code.
- [x] OSN Core: session schema — server-side sessions with SHA-256 hashed opaque tokens (Copenhagen Book C1)
- [ ] Pulse: event series schema
- [ ] Add indexes on `status` and `category` columns in pulse-db events schema
- [x] Mirror `@pulse/db/testing` (`createSchemaSql()` + `applySchema()`) into `@osn/db` and `@zap/db` — both now derive DDL from the live Drizzle schema via `getTableConfig()` in FK order, used by the Miniflare D1 integration tests. (Migrating the hand-rolled `osn/api/tests/helpers/db.ts` unit fixtures onto it is still open but optional.)

### Four-environment DB story (local / dev / staging / prod) — see [[database-environments]]

`local` = bun:sqlite (fast/free in-memory tests + dev); `dev`/`staging`/`prod` = Cloudflare D1 on Workers. Foundation + Zap + Pulse + OSN DB layer landed.

- [x] `@shared/db-utils`: driver-agnostic `Db<S>` type, `createD1Db`/`makeD1DbLive`, `dbQuery` bridge, `commitBatch` (atomic `db.batch` on D1 / sequential on bun:sqlite); `makeDbLive` accepts broadened tags
- [x] Zap migrated end-to-end: `createApp` factory (`aot:false`) + `local.ts` (Bun.serve) + `index.ts` (Workers/D1) + `wrangler.toml` (dev/staging/prod) + Miniflare integration test + first generated D1 migration
- [x] Pulse migrated end-to-end: 5 `accountErasure.ts` transactions → `commitBatch`; `createApp`/`local.ts`/`index.ts`/`wrangler.toml`/Miniflare test (`bun run --cwd pulse/api test:d1`)
- [x] OSN core **DB layer** migrated: all 17 `db.transaction()` calls across `auth`/`profile`/`graph`/`organisation`/`account-erasure` → `commitBatch`, preserving the S-H1/S-M2 atomicity invariants (UNIQUE-constraint guards for handle/email races; count-guarded conditional DELETE for the last-passkey invariant). `@osn/db` type broadened + D1 layer; Miniflare integration test (`bun run --cwd osn/api test:d1`); `wrangler.toml` for D1 migration tooling.
- [ ] **OSN core → Workers hosting** (in progress):
  - [x] **P1 — `createApp` factory + `local.ts` Bun entry** (PR #131): osn-api now uses the same factory/entry split as Zap/Pulse — `createApp` builds the Elysia app from injected deps, `local.ts` is the `Bun.serve` entry. Until the remaining items land, osn-api still runs only as the Bun.serve `local` host even though its D1 DB layer is ready.
  - [ ] **P2 — Workers-compatible Redis backend** (in flight): replace ioredis (rate-limiters, rotated-session + step-up JTI stores) with an Upstash REST backend.
  - [ ] **D1 wiring** in the request path: move env-based JWT-key loading into the request path so the Worker has no module-load env dependency.
  - [ ] **Workers `index.ts` entry** (+ `main` in `osn/api/wrangler.toml`) to actually host osn-api on Workers.
- [ ] **Pulse/Workers cron**: the leave-app deletion sweepers run on the long-lived `local` host (`pulse/api/src/local.ts`). On Workers they belong on a Cron Trigger (`[triggers] crons` + `scheduled()` handler).

**Resolved during prep-pr review:** `[x]` build blocker — `@shared/db-utils` no longer statically imports `bun:sqlite` (lazy indirect imports) so Worker bundles build; `[x]` **S-H1** — Zap Worker fails closed on missing `OSN_JWT_SECRET` + non-local dev-secret fallback removed; `[x]` **T-M1** — `commitBatch` unit tests added. See [[database-environments]].

**Deferred review follow-ups (non-blocking):**
- [ ] **P-W1** — `refreshTokens` re-SELECTs the session row that `verifyRefreshToken` already loaded; return the metadata instead (one extra RTT on the hottest auth path, only bites once osn-api runs on D1 — gated on the Workers-hosting item above). [[sessions]]
- [ ] **S-L1** — `deletePasskey` returns `remaining` + writes the audit row from the pre-read count even when the count-guarded DELETE matched 0 rows (race loser). Inspect rows-affected before auditing. [[passkey-primary]]
- [ ] **S-L2** — `commitBatch` bun:sqlite branch has no rollback (local/tests only); optionally wrap in a sync transaction for local atomicity parity.
- [ ] **T-M2** — port `pulse/db`'s `tests/testing.test.ts` to `@osn/db` + `@zap/db` (the new schema-reflection emitters are untested in the unit lane).
- [ ] **T-E1** — add a unit test for `completeEmailChange`'s UNIQUE-conflict catch branch (the constraint guard that replaced transactional rollback).
- [ ] **T-S1** — add a concurrent-delete Miniflare case asserting the last-passkey count-guarded DELETE leaves exactly one passkey on real D1.
- [ ] **T-S2** — smoke-test `createApp`/`local.ts` bootstrap for pulse/api + zap/api.

### Crypto (`osn/crypto`)

- [x] JWKS endpoint + ES256 access tokens — `GET /.well-known/jwks.json` live in `@osn/api`; `@pulse/api` verifies via JWKS cache — see [[arc-tokens]]
- [ ] JWKS URL fallback in `resolvePublicKey` for third-party apps (currently first-party only via `service_account_keys`)
- [x] **W7 issuer hardening** — `verifyArcToken` gains optional `expectedIssuer` (X1: `requireArc` binds signed `iss` to the kid→issuer DB row; Pulse receiver passes it too); ARC token cache key now includes `ttl` + canonicalised scope (X3); ARC public-key cache TTL configurable via `ARC_PUBLIC_KEY_CACHE_TTL_SECONDS` (X4); `@shared/osn-auth-client` `extractClaims`/`osnAuth` gain optional `issuer` + 30s `clockTolerance` (X2, issuer optional/unset for rollout safety); `@shared/redis` memory `eval` asserts the rate-limit script (X5). See [[arc-tokens]]. (Move to `[[changelog/completed-features]]` on merge.)
- [ ] **Enforce access-token `issuer` in downstream verifiers** — once all live access tokens carry a matching `iss`, set `issuer` on `@shared/osn-auth-client` `osnAuth` consumers (currently optional/unset for rollout safety, X2).

### UI Components (`osn/ui`)

- [ ] Design system / tokens
- [ ] Button, Input, Card basics
- [ ] Chat interface (shared between Pulse and Messaging)
- [ ] Event card component
- [ ] Calendar component

### Redis Migration Phase 4 — see [[redis]]

Phases 1–3 complete (abstraction layer, `@shared/redis` package, wire-up). Details in [[changelog/completed-features]].

**Phase 4 — Auth state migration (S-M8)**
- [ ] `otpStore` → Redis with TTL (resolves S-M8 partial, P-W4 partial)
- [ ] `magicStore` → Redis with TTL
- [x] ~~`pkceStore` → Redis with TTL + size bound (resolves S-L23)~~ — **Obsolete**: `pkceStore` deleted entirely with the PKCE flow removal (Phase 5b)
- [ ] `pendingRegistrations` → Redis with TTL

**Phase 4 — ARC key revocation fan-out (X4 follow-up) — see [[arc-tokens]]**
- [ ] Redis pub/sub eviction of `service_account_keys` revocations across processes — publish `(kid)` on revoke; every process subscribes and calls `evictPublicKeyCacheEntry(kid)`. Closes the ≤5-min cross-process revocation window (currently bounded by `ARC_PUBLIC_KEY_CACHE_TTL_SECONDS`, default 300).

**Observability (Redis)**
- [ ] Logs: `Effect.logError` on Redis connection failures + command errors; `Effect.logWarning` on fallback-to-in-memory transitions; add `redisPassword` / `redis_password` to redaction deny-list
- [ ] Traces: `Effect.withSpan("redis.rate_limit.check")`, `Effect.withSpan("redis.connection.health")`, `Effect.withSpan("redis.auth_state.get|set")` (Phase 4)
- [ ] Metrics: `redis.command.duration` histogram, `redis.command.errors` counter, `redis.connection.state` gauge; bounded attrs
- [ ] Capacity: `redis.memory.bytes` gauge (from `INFO memory`; alert at 80% of `maxmemory`), `redis.store.keys` gauge per namespace

---

## Security Backlog

Open findings only. Completed fixes archived in [[changelog/security-fixes]].

### High

- [x] S-H1 (client) — Refresh token sent in JSON body to `/profiles/list`, `/profiles/switch`, `/profiles/create`, `/profiles/delete`. **Fixed** — all profile endpoints now authenticate via `Authorization: Bearer <access_token>` header; refresh token no longer sent in request body — see [[identity-model]]
- [x] S-H21 — Dev-mode `console.log` of OTP codes + recipient email in `osn/core/src/services/auth.ts`. **Fixed** — already uses `Effect.logDebug` (not `console.log`); guard tightened to `OSN_ENV` in log-level-debug PR.
- [x] S-H100 — Revoked ARC keys valid for 5 min after revocation (in-process cache bypass). **Fixed** — `evictPublicKeyCacheEntry(kid)` called immediately on revoke; `publicKeyCache` stores `allowedScopes` for cache-hit scope validation — see [[arc-tokens]]
- [x] S-H101 — `INTERNAL_SERVICE_SECRET` comparison not timing-safe. **Fixed** — `crypto.timingSafeEqual` in both `/register-service` and `/service-keys/:keyId` — see [[arc-tokens]]
- [x] S-H (astro-ssrf) `GHSA-2pvr-wf23-7pc7` — Astro Host-header SSRF in the prerendered error-page fetch (`astro <6.4.6` did not validate request origin against `allowedDomains`); was flagged on **every push** by the pre-push `bun audit --audit-level=high` gate across `@cire/web`, `@cire/organiser`, `@osn/landing`. **Fixed** — direct `astro` bump `^6.4.2` → `^6.4.6` in all three packages (no override; resolves to 6.4.6, lowest patched). Also clears bundled moderate `GHSA-jrpj-wcv7-9fh9` (spread-prop XSS). See [[changelog/security-fixes]].
- [x] S-H (undici-tls) `GHSA-vmh5-mc38-953g` — undici TLS cert-validation bypass via dropped `requestTls` in SOCKS5 `ProxyAgent` (`undici >=7.23.0 <7.28.0`); transitive via `jsdom@29` (`@cire/web`) + `miniflare@4` (`@cire/api`, which **pins** `undici@7.24.8`). Also flagged on every push. **Fixed** — narrowest root `overrides` entry `"undici": "^7.28.0"` (the miniflare pin rules out a parent bump); resolves both copies to 7.28.0. Also clears bundled moderate `GHSA-pr7r-676h-xcf6`. Test/build-tooling-only, no deployed-Worker path. See [[changelog/security-fixes]].

### Medium

- [ ] S-M1 (arc-key-scopes) — ARC scope authorisation is **service-granular**: `allowedScopes` lives on `service_accounts` (one row per serviceId, `/register-service` upsert = full replace) while keys live per-`kid` in `service_account_keys`. pulse-api registers two keys (graphBridge + leave-app) under one serviceId, so per-key least privilege between them is structurally impossible — either key can mint any scope in the service union, defeating the blast-radius separation `pulse/api/src/lib/outbound-arc.ts` was designed for. **Mitigated 2026-07-05** (both registrations + seed carry the identical union so scope state is at least deterministic — see [[changelog/security-fixes]]); the real fix is a per-key `allowed_scopes` column on `service_account_keys` + `resolvePublicKey` checking the key's scopes. Raised as S-H1 in the prep-pr review of the hardening sweep — see [[arc-tokens]]
- [ ] S-M1 — `verifyAccessToken` rejects tokens missing `handle` claim — treat missing as `null` during transition
- [ ] S-M2 (pulse-discovery) — friends predicate assumes the OSN social graph is symmetric. Today this is a wiki note; if asymmetric follows / blocks ever land, the RSVP branch must additionally verify `viewerId ∈ RSVPer.connections` not only `RSVPer ∈ viewerId.connections` — see `[[event-access]]`
- [x] S-M3 — No "resend code" button after registration OTP; SMTP failure = claimed handle with no recovery — **Fixed**: OTP input component now shows "Resend code" button on error with 30s cooldown
- [ ] S-M4 — Legacy `POST /register` returns raw `String(catch)` — extend `publicError()` mapper
- [ ] S-M5 — `displayName` in JWT (1h TTL) — stale after profile update
- [x] S-M6 — Wildcard CORS on auth server. **Fixed** — `cors()` consumes `OSN_CORS_ORIGIN`; local dev falls back to the monorepo Tauri dev ports (`http://localhost:1420`, `http://localhost:1422`); non-local deploys fail-closed at boot via `assertCorsOriginsConfigured` — see `[[arc-tokens]]`
- [ ] S-M11 — Magic-link tokens use `crypto.randomUUID` without additional entropy hardening
- [ ] S-M13 — Photon geocoding sends keystrokes to third-party with no user notice — add consent UI or proxy
- [ ] S-M14 — Pulse `REDIRECT_URI` falls back to `window.location.origin` — validate allowed redirect URIs server-side (see S-H3)
- [ ] S-M19 — Legacy `/register` does not lowercase emails — add `lower(email)` unique index
- [x] S-M20 — Refresh tokens in `localStorage` — XSS = permanent account takeover. **Mitigated** by C3 (refresh tokens in HttpOnly cookie) + Phase 4 short access-token TTL (5 min) with `authFetch` silent-refresh. Access token remains in `localStorage` but blast radius is ≤5 min. See [[identity-model]]
- [ ] S-M21 — `/register/begin` differential timing oracle on silent no-op branch
- [ ] S-M22 (account-deletion) — Pulse ARC key registry is in-memory only (`pulse/api/src/lib/arc-middleware.ts`). Restart drops registrations; osn-api eventually re-registers but there's a window where Pulse rejects valid ARC tokens (DoS) and any in-flight account-deletion fan-out fails. Persist a small `service_accounts` / `service_account_keys` table in `pulse/db` mirroring the osn-api schema — see [[arc-tokens]]
- [ ] S-M23 (account-deletion) — `POST /account/restore` only requires the cancellation session cookie; a passive cookie thief at deletion time can DoS the user for the rest of the 7-day grace window. Add an OTP-to-email re-confirm before honouring the restore — see [[wiki/compliance/dsar]]
- [ ] S-M24 (account-deletion) — No rate limit on `/internal/{step-up/verify, app-enrollment/{leave,join}, account-deleted}` ARC routes. Add a per-kid limiter at the ARC middleware layer (60 req/min per kid) — see [[arc-tokens]]
- [ ] S-M25 (account-deletion) — `/internal/app-enrollment/leave` accepts an ARC-authenticated body-supplied `account_id` without a fresh step-up token (the verify endpoint consumed the JTI). Residual confused-deputy risk: a compromised Pulse instance can flip arbitrary enrollments. Considered: a single-use server-issued "leave-app token" returned by `/internal/step-up/verify` and required by the leave endpoint. Defer until rate-limit (S-M24) lands; combined risk is low enough — see [[wiki/compliance/dsar]]
- [x] S-M34 — Rate limiter trusted `X-Forwarded-For` without a reverse-proxy guarantee. **Fixed** — `getClientIp(headers, options?)` in `@shared/rate-limit` now resolves the keying IP under a fail-closed `ClientIpOptions` trust policy (`trustCloudflare` → `cf-connecting-ip`; `trustedProxyCount: N` → Nth-from-right of XFF; else socket peer), exporting `UNRESOLVED_IP` / `isUnresolvedIp` / `isValidIp`. `@osn/api` opts in via `TRUSTED_PROXY_COUNT` (default 0 = socket-peer; startup warning when unset in non-local) and denies (429) unresolved IPs instead of bucketing them. Legacy no-options form kept `@deprecated` so Pulse/Zap/Cire keep building until their own opt-in workstreams (integration notes in [[rate-limiting]]). Also transitively closes **S-L2 (share-attribution)**: Pulse share / exposure endpoints key off the same `getClientIp`, so a spoofable left-most-XFF could forge the share-source attribution IP; hardening the shared helper removes that vector once Pulse passes the options — see [[rate-limiting]], [[event-access]]
- [ ] S-M35 — Redirect URI allowlist matches origin only, not exact URI per RFC 9700 §4.1.3
- [ ] S-M43 — No rate limiting on `/graph/internal/*` S2S endpoints — see [[arc-tokens]]
- [x] S-M44 — `/register-service` stored JWK without verifying it could be imported. **Fixed** — `importKeyFromJwk` called before DB upsert; returns 400 on invalid key — see [[arc-tokens]]
- [x] S-M100 — `peekClaims` used `atob()` which breaks on base64url (`-`/`_` in UUID kids). **Fixed** — `decodeJwtSegment` converts base64url → base64 before decode (RFC 7515 §2) — see [[arc-tokens]]
- [x] S-M101 — `/register-service` stored arbitrary `allowedScopes` without server-side validation. **Fixed** — `PERMITTED_SCOPES` allowlist in `graph-internal.ts`; unknown scopes return 400 — see [[arc-tokens]]
- [x] S-M102 — `resolvePublicKey` cache hit skipped scope check when `tokenScopes` empty. **Fixed** — cache entry now stores `allowedScopes`; scope validated on every cache hit — see [[arc-tokens]]
- [x] S-M1 (pulse-onboarding) — `/graph/internal/profile-account` was gated only by the generic `graph:read` scope. **Fixed (2026-07-05)** — dedicated `graph:resolve-account` scope added to `PERMITTED_SCOPES` and required on the endpoint; pulse-api registers + requests it (graphBridge), cire-api's account-link resolver requests it (its prod registration must be widened — see [[production-deploy]] §6); a `graph:read`-only token now gets 401 (regression-tested). See [[pulse-onboarding]], [[changelog/security-fixes]]
- [x] S-M1 (zap) — No rate limiting on Zap API endpoints. **Fixed** — per-IP write limiters on `POST /chats`, `/chats/:id/members`, `/chats/:id/messages` (`createDefaultZapRateLimiters`); fail-closed — see [[rate-limiting]]
- [x] S-H1 (zap) — Zap write-endpoint rate limiters keyed off the legacy spoofable `getClientIp(headers)` (no trust policy), so a client could forge `x-forwarded-for` to evade or amplify the per-IP limit. **Fixed (PR #116 review)** — Zap is a Cloudflare Worker, so the limiter now resolves the key via `getClientIp(headers, { trustCloudflare: true })` (validated `cf-connecting-ip`) and denies (429) when `isUnresolvedIp(ip)` is true, mirroring cire's Worker (`zap/api/src/routes/chats.ts` createChat/addMember/sendMessage) — see [[rate-limiting]]
- [x] S-M2 (zap) — CORS wildcard on `@zap/api`. **Fixed** — `cors()` consumes `ZAP_CORS_ORIGIN`; local dev falls back to the monorepo Tauri dev ports (`:1420`, `:1422`); non-local deploys fail closed at boot via `assertCorsOriginsConfigured` (`zap/api/src/lib/cors-config.ts`, mirrors OSN's `OSN_CORS_ORIGIN`) — see [[apps/zap]]
- [ ] S-M3 (zap) — `zapBridge.provisionEventChat` does not verify caller owns event
- [ ] S-M4 (zap) — Non-atomic cross-DB writes in `zapBridge.provisionEventChat`
- [ ] S-M5 (zap) — `addEventChatMember` does not verify chat is type "event"
- [ ] S-M6 (zap) — Truncated UUIDs (12 hex chars = 48 bits)
- [x] S-L1 (multi) — `maxProfiles` column set to 5 but never enforced. **Fixed in P3** — `createProfile` checks count vs `accounts.maxProfiles`
- [x] S-L2 (multi) — Email duplication between `accounts.email` and `users.email`. **Resolved** — `users` table has no `email` column; all email access via JOIN to `accounts`
- [x] S-H1 (session) — In-memory `rotatedSessions` map did not survive restarts or scale across pods. **Fixed** — `RotatedSessionStore` abstraction with Redis-backed impl wired in `osn/api/src/index.ts`; fail-open on Redis error so outages can't manufacture false-positive family revocations — see [[sessions]]
- [x] S-M2 (auth) — `resolveAccessTokenPrincipal` and `resolveAccountId` duplicated across `routes/auth.ts` and `routes/profile.ts`. Extract shared Elysia derive — see [[identity-model]]
- [ ] S-M2 (cdl) — No per-entry failed-secret attempt counter on CDL poll/approve/reject — IP rate limiter is the only brute-force defence; 256-bit entropy makes this low-risk but breaks the MAX_OTP_ATTEMPTS defence-in-depth precedent — see [[sessions]]
- [ ] S-H1 (org) — `listMembers` service returns full profile rows; route projects, but service should restrict
- [ ] S-M1 (org) — `GET /organisations/:handle/members` has no membership gate
- [ ] S-M3 (org) — `getOrganisation` returns `ownerId` internal ID
- [x] S-M1 (passkey) — `deletePasskey` last-passkey/recovery-code lockout guard was SELECT-then-DELETE outside a transaction; two concurrent deletes could bypass it. **Fixed** — gate + delete + security-event insert wrapped in `db.transaction`, returns tagged result; collapses TOCTOU window to zero — see [[identity-model]]
- [x] S-M2 (passkey) — `PATCH /passkeys/:id` had no step-up gate; XSS-captured access token could swap labels to mislead the user before a delete. **Fixed** — rename now uses the same step-up gate as delete (`passkeyDeleteAllowedAmr`); client + UI thread the token through — see [[identity-model]]
- [x] S-M3 (passkey) — Discoverable login did not cross-check assertion `userHandle` against the credential row's `accountId`. **Fixed** — verifier decodes the base64url userHandle and compares to `accounts.passkeyUserId` before completing the ceremony — see [[identity-model]]
- [x] S-M1 (recovery) — `consumeRecoveryCode` was check-then-act: it SELECTed the code row and tested `usedAt === null` outside the write, so two concurrent requests with the same code could both pass and double-consume (each wiping sessions + writing an audit row). **Fixed (PR #116 review)** — the consume is now a compare-and-swap (`UPDATE recovery_codes SET usedAt = :now WHERE id = :id AND usedAt IS NULL`); 0 rows-affected means another request won the race, so the session wipe + audit insert are skipped and the attempt is treated as a replayed used code (generic failure + lockout counter). Mirrors the passkey-rename CAS pattern in `osn/api/src/services/auth.ts` — see [[recovery-codes]]
- [ ] S-M1 (series) — `GET /series/:id/instances` leaks existence of private series (404 on missing id vs 200 `[]` on private unviewable). Align with [[event-access]] — return 200 `[]` when series exists-but-invisible (or 404 for both) — `pulse/api/src/routes/series.ts:149`, `pulse/api/src/services/series.ts:494`
- [ ] S-M1 (vid) — Unbounded presentation issuance / no rate limit on `POST /identity/presentation/issue`. Spec a per-(user, audience) limit (~10/hr) + global per-user cap before V-M4 — see [[verified-identity]], [[rate-limiting]]
- [ ] S-M2 (vid) — Selfie / biometric raw-image retention boundary owned by vendor, not OSN. Spec direct browser→vendor upload (signed URL or vendor SDK); `osn/api` only sees `runId` + redacted response. Add biometric to `redact.test.ts` denylist — block V-M1 — see [[verified-identity]]
- [ ] S-M3 (vid) — `presentations.requested_claims` / `released_claims` JSON unbounded in current schema spec. Constrain to bounded enum of attribute kinds, cap row size; mirror the bounded-enum rule for the `presentation.issued{claims}` metric — see [[verified-identity]]
- [ ] S-M4 (vid) — `verified_attributes.value` encryption-key custody underspecified. Move from "key in env" to envelope encryption (KEK in KMS, per-row DEK, AES-256-GCM, AAD = `account_id ‖ attribute_kind`). Document in [[compliance/data-map]]. Block V-M2 — see [[verified-identity]]
- [ ] S-M2 (series) — `listInstances` ignores the invited-RSVP branch in `canViewEvent` ([[event-access]]). Invited non-organiser viewers are wrongly 404'd on the private-series gate, and a single promoted-to-public instance leaks the parent series to anonymous callers. Replace inline visibility filter with per-row `canViewEvent` (or a parallel RSVP-join predicate) — `pulse/api/src/services/series.ts:500-502`
- [ ] S-M2 (cire) — Guest claim-code rate limiter on the Workers runtime is in-memory per-isolate, so a distributed guesser fans requests across isolates to multiply the effective ceiling. The global Workers rate-limit binding must be the load-bearing throttle in production — verify `wrangler.toml` wires the CF Rate-Limiting (or KV/Durable-Object) binding and that the code never silently falls back to the in-memory limiter when the binding is configured — see [[cire-auth]], [[rate-limiting]] (PR #116 review)
- [ ] S-M3 (cire) — **Accepted product decision.** Simple-tier claim codes carry ~40 bits of entropy (6-char hash, `SURNAME-WORD-HASH`). Deliberately kept low for guest UX (a wedding household types it from a paper invite); the load-bearing defence is the global Workers rate limiter (see S-M2 cire), not code length. No change planned — documented here so the finding isn't re-raised — see [[cire-auth]] (PR #116 review)
- [ ] S-M4 (cire) — Guest-session token rotation is not performed on the auth-state transition at `POST /api/account/link` (the additive guest-cookie ↔ OSN-account bind), leaving a residual session-fixation surface. Rotate the `cire_session` token inside the link transaction. Folds into AUDIT-C6 — see [[cire-auth]] (PR #116 review)

### Low

- [x] S-L (export-passkey-user-id, 2026-07-08 prep-pr review of C-H1) — `GET /account/export`'s `account` section emits `passkeyUserId`. **Decision: keep as spec'd** (2026-07-08). It matches the explicit `[[compliance/dsar]]` field list, is not a P6 violation (it is not `accountId`, and it is the owner's own data), and is an opaque WebAuthn user-handle rather than a cross-service identifier. Accepted-risk (data-minimisation nit, not a leak). `osn/api/src/services/account-export.ts`.
- [ ] S-L (export-profileids-crosscheck, 2026-07-08 prep-pr review of C-H1) — the Pulse/Zap `POST /internal/account-export` handlers query directly on the ARC-supplied `profile_ids` without cross-checking they belong to `account_id`. Not exploitable today (only osn holds the `account:export` scope and derives the IDs server-side), but a bug/compromise in osn that sent foreign `profile_ids` would leak another account's data with no downstream guardrail. Defence-in-depth: Pulse can intersect against `pulse_profile_accounts`; Zap has no such cache (document the trust assumption). See `[[arc-tokens]]`, `[[cire-auth]]`.
- [ ] S-L3 (pulse-ip-keying, 2026-07-03 quality review) — `pulse/api` still keys three per-IP limiters via the deprecated no-args `getClientIp(headers)` (left-most XFF / `"unknown"` bucket): `routes/venues.ts:78`, `routes/onboarding.ts:130,176`. Low severity (read-mostly public surfaces, in-memory limiters anyway) but should adopt the S-M34 `clientIpConfig` + `isUnresolvedIp`-deny pattern when the Pulse limiter backend moves to Redis/Workers bindings (S-L1 pulse-workers) — see [[rate-limiting]]
- [ ] S-L1 (landing) — CSP keeps `script-src 'self' 'unsafe-inline'` on `@osn/landing` + `@pulse/landing` `_headers` (required by Astro's island bootstrap + `is:inline` scripts; no first-party HTML sink today, so residual XSS risk is low). Harden to hashed/nonce-based CSP. See [[osn-landing]], [[pulse-landing]].
- [x] S-L2 (pulse-landing) — `/api/geo` returned per-visitor IP location with `Cache-Control: public`, so a shared proxy could cross-serve one visitor's coarse location to another. **Fixed** — changed to `private, max-age=300` (browser-only). See [[pulse-landing]].
- [x] S-L3 (landing-deploy) — `.github/workflows/deploy-osn-pulse-landing.yml` declared no `permissions:` block (inherited the default `GITHUB_TOKEN`). **Fixed** — added top-level `permissions: { contents: read }` (least privilege; deploy auth is the Cloudflare token, not `GITHUB_TOKEN`).
- [ ] S-L1 — Seed data uses reserved handle `"me"` — reservation not DB-enforced
- [ ] S-L2 — `Effect.orDie` in `requireAuth` swallows auth errors — replace with `Effect.either` + 401
- [ ] S-L2 (pulse-onboarding) — `_testKey?: CryptoKey` positional argument on `createOnboardingRoutes` (and 3 other Pulse route factories: `createCloseFriendsRoutes`, `createEventsRoutes`, `createSeriesRoutes`). A misuse where a non-test caller passes a key would bypass JWKS rotation + kid-binding. Defence-in-depth fix: gate `_testKey` honouring on `process.env.NODE_ENV === "test"` inside `extractClaims` so production bundles can never honour it. Pre-existing pattern, called out by the security review of this branch — track as a Pulse-wide cleanup — see [[pulse-onboarding]]
- [ ] S-L4 — `createdByAvatar` always null — no avatar claim in JWT
- [ ] S-L5 (account-deletion) — Adaptive AMR for `*_app_delete` purposes: when an account has at least one passkey, refuse OTP-only step-ups for app-deletion ceremonies. Today both flows accept passkey OR OTP via `recoveryGenerateAllowedAmr` — tighter posture available but conflicts with the "user with lost passkey can still leave" UX. Consider once recovery-flow UX matures — see [[passkey-primary]]
- [x] S-L6 (account-deletion) — **Fixed (2026-07-05)** — Pulse `requireArc` early-exit branches now record the shared `arc.token.verification` counter (malformed / `unknown_issuer` / new `revoked_key` / `scope_denied`); paths reaching `verifyArcToken` were already self-reported. See [[observability/overview]], [[changelog/security-fixes]]
- [ ] S-L7 (osn) — The five native rate-limit `namespace_id`s (2001–2005 in `osn/api/wrangler.toml`) are account-scoped and unverified against the live Cloudflare account. A collision with another Worker's namespace silently merges global counters (no deploy error). Confirm 2001–2005 are unused in the osn-api account at deploy (cire uses 1001; no in-repo collision) — see [[rate-limiting]], [[runbooks/production-deploy]] (ratelimit-hardening branch review)
- [ ] S-L8 (osn) — `[observability] head_sampling_rate = 1` in `osn/api/wrangler.toml` captures every Workers invocation. No PII concern today (redacting `osnLoggerLayer` unchanged, no client IP logged), but revisit the sampling rate once invocation volume grows for cost/retention — see [[observability/overview]] (ratelimit-hardening branch review)
- [ ] S-L3-follow-up (pulse) — Tauri CSP `connect-src` includes a transitional `https:` entry because production `@osn/api` + `@pulse/api` origins aren't pinned in-repo. Replace with the deployed origins once they land in env. See [[changelog/security-fixes]] entry "Pulse Tauri CSP allowlist (2026-04-25)"
- [x] S-L7 — `jwtSecret` falls back to `"dev-secret"` — **Superseded**: symmetric `OSN_JWT_SECRET` removed entirely; replaced by ES256 key pair (`OSN_JWT_PRIVATE_KEY`/`OSN_JWT_PUBLIC_KEY`); startup guard uses `OSN_ENV` — see [[arc-tokens]]
- [x] S-L29 — `/graph/internal/*` mounted under open CORS. **Fixed** — `cors()` now uses `OSN_CORS_ORIGIN`; local dev fallback = monorepo Tauri dev ports (`:1420`, `:1422`); wildcard removed; derivation extracted to `resolveCorsOrigins` (see `osn/api/src/lib/cors-config.ts`) — see `[[arc-tokens]]`
- [x] S-L1 (cors) — `resolveCorsOrigins` initially tied the local-dev fallback to `OSN_ENV`, so a non-local deploy missing both `OSN_ENV` and `OSN_CORS_ORIGIN` would silently pick up dev ports instead of failing closed. **Fixed** — fallback now gated on the same `cookieConfig.secure` signal used for cookie hardening; the S-L4 boot-time check covers both predicates.
- [x] S-L2 (cors) — `OSN_CORS_ORIGIN` entries matched browser `Origin` headers byte-for-byte, so `"HTTPS://App.Example.com/"` (trailing slash / mixed case) would reject legitimate requests and push ops toward widening the allowlist. **Fixed** — entries are lowercased and stripped of a single trailing slash in `resolveCorsOrigins`.
- [x] S-L32 — `OSN_JWT_SECRET` in `osn/api` fell back to `"dev-secret-change-in-prod"` at startup. **Superseded**: symmetric secret removed; ES256 key pair required in non-local envs (guarded via `OSN_ENV`) — see [[arc-tokens]]
- [x] S-L8 — OTP codes and magic link URLs logged to stdout. **Fixed** — guard tightened to `OSN_ENV` (excludes staging); dev log level defaults to debug so codes are visible without manual config.
- [ ] S-L9 — `imageUrl` allows `data:` URIs — add CSP `img-src` header
- [ ] S-L10 — SimpleWebAuthn loaded from unpkg CDN without SRI hash
- [x] S-L11 — ~~Failed OAuth callback leaves PKCE verifier in `localStorage`~~ — **Obsolete**: PKCE flow deleted (Phase 5b)
- [x] S-L12 — ~~`REDIRECT_URI` from `window.location.origin` — prefer explicit env var~~ — **Obsolete**: `REDIRECT_URI` constant deleted with PKCE cleanup
- [x] S-L13 — ~~PKCE `state` not validated against stored nonce~~ — **Obsolete**: PKCE flow deleted
- [x] S-L40 — `publicKeyCacheSize`, `_setPublicKeyCacheMaxSizeForTest`, `_resetPublicKeyCacheMaxSize` re-exported from `@shared/crypto` public index.ts (test-only symbols in public API). **Fixed** — removed from `index.ts`; tests import direct from `../src/arc` — see [[arc-tokens]]
- [ ] S-L14 — `assertion: t.Any()` on passkey routes — add TypeBox shape validation
- [ ] S-L15 — No reserved-handle blocklist in DB
- [x] S-L101 — `registerWithOsnApi()` silently returned early when `INTERNAL_SERVICE_SECRET` unset. **Fixed** — throws in non-local envs (`OSN_ENV != "local"`) so misconfiguration is caught at boot; in local dev logs a warning and boots anyway to unblock developer workflows — see [[arc-tokens]]
- [x] S-M1 (auth) — ~~`pkceStore` unbounded + no expiry sweep~~ — **Obsolete**: `pkceStore` deleted with PKCE cleanup (Phase 5b)
- [x] S-M2 (auth) — ~~`/authorize` has no rate limiter~~ — **Obsolete**: `/authorize` route deleted with PKCE cleanup (Phase 5b)
- [x] S-M4 (auth) — **Fixed (2026-07-05)** — `loadJwtKeyPair` asserts `privateKey.usages.includes("sign")` after import; a public JWK pasted into the private slot now fails at boot instead of on the first token mint. See [[changelog/security-fixes]]
- [ ] S-L4 (auth) — `logDevOtp` (`osn/api/src/services/auth/helpers.ts`) interpolates recipient email + OTP code into a free-text `Effect.logDebug` message, bypassing the annotation-key-based redaction deny-list (`shared/observability/src/logger/redact.ts`). Only fires when `OSN_ENV` is unset/`"local"` (fail-closed env gate verified), so no leak in any deployed env — defence-in-depth note only. If hardening: drop the email from the line (operator already knows the address) — see [[email]], [[observability/overview]]
- [x] S-L5 (auth) — **Fixed (2026-07-05)** — `buildAppDeps` throws when `OSN_ENV` is non-local and `OSN_ORIGIN` is unset, mirroring `assertCorsOriginsConfigured`; all deployed wrangler tiers already set it. See [[passkey-primary]], [[changelog/security-fixes]]
- [ ] S-L2 (auth) — Wildcard CORS on `@pulse/api` — restrict to known client origins (mirrors OSN_CORS_ORIGIN pattern) — see [[rate-limiting]]
- [ ] S-L22 — `listRsvps` counts privacy-filtered rows toward `limit` (weak side-channel oracle)
- [x] S-L23 — ~~`pkceStore` has no size bound or eviction sweep~~ — **Obsolete**: `pkceStore` deleted
- [ ] S-L24 — `/token` and legacy `POST /register` have no rate limiting (partial: `authorization_code` grant deleted; `refresh_token` grant and legacy `POST /register` still unthrottled)
- [ ] S-L30 — `createInternalGraphRoutes` has no `loggerLayer` — see [[arc-tokens]], [[observability/overview]]
- [x] S-L1 (zap) — `jwtVerify` did not restrict algorithms (HS256 shared secret). **Fixed** — token verification migrated to ES256/JWKS via `@shared/osn-auth-client` (`extractClaims`, `algorithms: ["ES256"]` + `audience: "osn-access"` enforced in-pass); `OSN_JWT_SECRET` removed; non-local plaintext-JWKS boot guard added; AUDIT-Z2 chokepoint rejects non-`usr_` subs — see [[apps/zap]], [[identity-model]]
- [x] S-L2 (zap) — DM chats had no member count enforcement. **Fixed** — `createChat`/`addMember` enforce DM = exactly two members (`InvalidDmMembership`) — see [[apps/zap]]
- [x] S-L3 (zap) — Admin could remove themselves leaving chat with no admin. **Fixed** — `removeMember` rejects removing the last remaining admin (`LastAdmin`, 409) — see [[apps/zap]]
- [x] S-L1 (passkey) — `PasskeysView` `window.confirm` race could swap pending delete id on rapid double-click. **Fixed** — every Rename / Delete button is disabled while a step-up ceremony is in flight (`locked()`); pending action stored as a single tagged signal — see [[identity-model]]
- [x] S-L2 (passkey) — `listPasskeys` exposed raw `credentialId` to the browser without UI need. **Fixed** — projection drops `credentialId`; opaque `pk_<hex>` `id` is the only handle reaching the client — see [[identity-model]]
- [x] S-L3 (passkey) — Fallback "no caller session" branch in `deletePasskey` nuked all sessions silently. **Fixed** — branch now `Effect.logWarning`s the anomalous condition before the wipe — see [[sessions]]
- [x] S-L4 (passkey) — `DELETE /passkeys/:id` accepted OTP step-up via reused `recoveryGenerateAllowedAmr`. **Fixed** — new `passkeyDeleteAllowedAmr` config knob defaults to `["webauthn"]` (passkey-only); operators can widen if their threat model requires — see [[step-up]]
- [x] S-L5 (passkey) — `verifyPasskeyAssertion` reflected raw `@simplewebauthn/server` error text to the client (verifier-probe oracle). **Fixed** — fixed `"Passkey verification failed"` on the wire; cause logged via `Effect.logWarning` — see [[identity-model]]
- [ ] S-L1 (org) — Org creation rate limit (60/min) shared with member ops
- [ ] S-L3 (org) — TOCTOU gap in handle uniqueness check
- [ ] S-L1 (social) — Access tokens in `localStorage` via `StorageLive` — XSS = token exfiltration. Inherited from `@osn/client`; revisit alongside S-M20 by moving to HttpOnly cookie BFF or `sessionStorage` with tight TTL — see [[identity-model]]
- [ ] S-L4 (recs) — `mutualCount` discloses graph-inference signal; adversary with many test accounts can combine counts to deduce third-party connection sets. Consider bucketing (e.g. "10+") above a threshold — see [[social-graph]]
- [ ] S-L1 (auth-fetch) — `OsnAuthService.authFetch` attaches `Authorization: Bearer` + `credentials: include` to any URL; no origin allowlist. Add `allowedOrigins` to `OsnAuthConfig` and skip header attachment off-list (defence-in-depth against mis-routed fetches / injected URLs) — see [[identity-model]]
- [ ] S-L2 (security-events) — `notifyRecovery` logs a stable `"notify_dispatch_failed"` message, but if `AuthError.message` ever embeds the mailer-provider response body a future refactor could leak the recipient email past the key-based redactor. Pin the log message shape with a test and assert the raw cause only appears on the span — see [[recovery-codes]]
- [ ] S-L3 (security-events) — `securityEventList` + `securityEventAck` limiters are keyed per-IP via `getClientIp` (`osn/api/src/routes/auth/`), but both endpoints are authenticated. Key by `claims.profileId` to strengthen the CGNAT / botnet-fan-out threat model (same pattern as `/recommendations/connections`) — see [[rate-limiting]]
- [ ] S-L1 (series) — No rate limit on `POST /series`, `PATCH /series/:id`, `DELETE /series/:id`. Each POST materialises up to 260 rows. Add per-user limits (e.g. 10/hour create, 60/hour patch) — see [[rate-limiting]]
- [ ] S-L1 (vid) — `DELETE /identity/attributes/:kind` revokes locally but outstanding SD-JWT VCs minted from that attribute remain cryptographically valid until expiry. Add an OAuth Status List endpoint at `/.well-known/`; require verifiers to consult it; document TTL trade-off — see [[verified-identity]]
- [ ] S-L2 (vid) — Threat-model snapshot in [[verified-identity]] is missing: holder device compromise (stolen session can mint presentations — call out step-up gating explicitly), issuer-side internal abuse (`@osn/api` operator silently minting VCs without user consent → `admin_actions` audit, ties to C-M16), `nonce`/`jti` clock skew + replay window, and downgrade attacks where an RP requests `age_band` instead of `age_over_18` to learn more than needed (consent UX should warn on over-broad asks). Expand before V-M0 STRIDE pass
- [ ] S-L3 (vid) — `verification_runs.failure_reason` and "redacted provider response" are undefined. Spec a vendor-response-redactor module with explicit allowlist (status, score, run id, error code) and denylist for everything else; mirror [[observability/overview]] redaction pattern — see [[verified-identity]]
- [ ] S-L2 (series) — `expandRRule` safety valve (`weekIdx > 10_000`) permits ~70k `Date` allocations when `UNTIL < dtstart`. Reject `UNTIL < dtstart` in `parseRRule` and lower the valve to ~520 weeks / 120 months — `pulse/api/src/services/series.ts:187-237`
- [ ] T-M (series) — Coverage gaps from review: `listInstances` `scope: "all"`; `updateSeries` `this_and_following` with/without `from`; `parseRRule` happy paths for `UNTIL`/`INTERVAL`/`BYDAY`; `expandRRule` `UNTIL` + `BYDAY` fanout; `materializeInstances` `extend_window` trigger; `GET /series/:id` 200 happy path + private-visibility 404 masking; `PATCH /series/:id` 200/422/404 paths
- [ ] S-L1 (pulse-close-friends) — `POST /close-friends/:friendId` is unrate-limited and the 422-vs-201 distinction makes it a connection-existence oracle. Caller can only probe their own connections (already enumerable via OSN `/graph/connections`), but the asymmetry bypasses OSN's 60/min limit. Defer to a Pulse-wide rate-limiter when one lands; mirror the OSN `GRAPH_RATE_LIMIT_MAX` (60/min/user) — see [[rate-limiting]], [[pulse-close-friends]]
- [ ] S-L2 (pulse-close-friends) — Cross-DB hygiene: `pulse_close_friends.friendId` references an OSN profile but Pulse has no S2S notification or reconciliation hook for OSN profile deletion. Stale rows render as ghost entries (null handle/displayName) on the close-friends page. Add an internal Pulse endpoint OSN can ARC-call post-deletion, or a periodic reconciliation job — see [[pulse-close-friends]], [[s2s-patterns]]
- [ ] S-L1 (cire) — Verify `ORGANISER_TOKEN` is not set as a CF secret on the deployed cire-api worker; the `X-Organiser-Token` auth path is deleted from code, but a secret set during the interim would linger as stale config. If present: `wrangler secret delete ORGANISER_TOKEN` (manual, from `cire/api`) — see [[cire-auth]]
- [ ] S-L3 (cire) — No Origin-header validation on cire's state-changing routes (`POST /api/claim`, `/api/rsvp`). Relies solely on `SameSite=Lax` for CSRF defence; OSN convention (origin-guard M1) additionally rejects POST/PUT/PATCH/DELETE whose `Origin` is present and not in the CORS allowlist. Apply the origin-guard equivalent on cire/api — see [[cire-auth]], `osn/api/src/lib/origin-guard.ts`
- [ ] S-L1 (cire-landing) — CSP on the static marketing site (`cire/landing/public/_headers`) allows `script-src 'self' 'unsafe-inline'` (needed by Astro's island bootstrap + the `is:inline` reveal/font scripts). No active vector today — the site is fully static with no user-reflected content — but move to nonce/hash-based `script-src` and drop `'unsafe-inline'` once Astro's inline bootstrap is hashable. Fold into the apex cutover. See [[cire-landing]]
- [ ] S-L2 (cire-landing) — Hotlinked third-party origins (`images.unsplash.com`, `fonts.googleapis.com`/`fonts.gstatic.com`) receive visitor IP/UA; passive subresources (no code-exec), CSP-allowlisted. Privacy/ePrivacy concern, not a code flaw: before the apex flips to real traffic, self-host fonts + proxy/self-host imagery and list Unsplash + Google Fonts in [[subprocessors]]. See [[cire-landing]]
- [ ] S-L1 (db-dev-tooling) — `scripts/cire-db-seed.sh` interpolates `CIRE_DEV_OWNER_PROFILE_ID` directly into a SQL `UPDATE` string (string-breakout shape). Bounded: developer-supplied env var, executed against a `--local` miniflare D1 only — not an exploitable vector, but the wrong pattern to copy. Parameterise via `wrangler d1 execute --param` (the equivalent re-point in `cire/api/src/local.ts` already uses Drizzle binding correctly) — see [[cire-auth]]
- [ ] S-L2 (share-attribution) — `getClientIp` shared `"unknown"` bucket. When `x-forwarded-for` is absent, `shared/rate-limit/src/index.ts` keys everyone under the literal `"unknown"`, collapsing the per-IP guarantee that the share/exposure (60/120 req/min) limits depend on. Pre-existing helper, but the new unauthenticated `pulse.events.share.invoked` / `pulse.events.share.exposure` counters are the most sensitive consumers. Fold into the planned Redis-backed limiter so per-IP buckets can pull from the connection address — see [[rate-limiting]]
- [ ] S-L4 (zap) — On the Cloudflare Workers runtime the per-IP write limiters use in-memory counters scoped to a single isolate (`zap/api/src/index.ts buildApp` → `createDefaultZapRateLimiters`), so the effective ceiling multiplies with isolate count. The IP key is now spoof-safe (S-H1 fixed) but the bucket store is not yet distributed. Move to a durable backend (CF Rate-Limiting binding / KV / Durable Object) before relying on Zap limits as a hard throttle in prod — see [[rate-limiting]] (PR #116 review)
- [ ] S-L1 (pulse-workers) — Same per-isolate limiter caveat for the Pulse Worker (`pulse/api/src/index.ts buildApp` uses `makeMemoryRateLimiters()`); the long-lived `local` host wires Redis via `REDIS_URL`, but the Worker path has no distributed store yet. Per-user write limits + per-IP share/exposure limits are per-isolate on `dev`/`staging`/`prod`. Wire a durable backend before the Worker deploy is the load-bearing path — see [[rate-limiting]], [[redis]] (PR #116 review)
- [x] S-L1 (deps-audit) — **Resolved (#214 dependency sweep + audit-gate retighten).** The pre-push `bun audit` gate in `lefthook.yml` previously carried `--ignore` entries accepting known `high` advisories in dev/test-only transitive deps. All are now fixed at source via root `overrides` (#214): `GHSA-96hv-2xvq-fx4p` (ws → ≥8.21.0), `GHSA-fx2h-pf6j-xcff` (vite → ≥7.3.5), plus the earlier `GHSA-77vg-94rm-hx3p` (devalue) and `GHSA-gv7w-rqvm-qjhr` (esbuild). The last two `--ignore` flags (ws, vite) were dropped and the gate is back to a clean `bun audit --audit-level=high` with **zero** ignores — `bun audit` reports no vulnerabilities. The convention for accepting a genuinely-unreachable NEW advisory is documented inline in `lefthook.yml`. Moved to [[changelog/security-fixes]].
- [ ] T-S1 (cire) — Mechanically enforce the DDL lockstep contract: a test that applies `cire/db/migrations/*.sql` (journal order) to one in-memory DB and the `setup.ts` DDL to another, then diffs normalised `sqlite_master`. Today the three-way mirror (schema.ts / migrations / setup.ts DDL) is comment-enforced only — a future migration that skips the mirror passes the whole cire/api suite against a shape D1 rejects
- [ ] T-S2 (cire) — `weddingsService.listForOwner` has no co-located unit test (only route-level coverage); add `services/weddings.test.ts` asserting oldest-first ordering, the one behaviour route tests don't pin
- [ ] T-x (hardening-sweep, 2026-07-05 prep-pr review) — deferred test gaps from the review of the hardening-sweep PR (T-M1/T-U1/T-U2 were fixed in-PR): **T-U3** assert `metricEventCreateDuration` emission (ok/error) via spy in `pulse/api/tests/services/events.test.ts`; **T-E1** assert `metricPulseHostCancelledHardDelete` ok + error paths in `runEventCancellationSweep` (error branch has never executed in a test); **T-S1** positive test that a `graph:resolve-account`-ONLY token passes `/profile-account` and 401s on a `graph:read` route; **T-S2** local-env complement for the S-L5 `OSN_ORIGIN` boot guard (no-throw + localhost fallback)
- [ ] T-M2 (cire) — `cire/organiser` ships the OSN sign-in flow with zero tests (workspace `test` script is still the `echo 'No tests yet'` stub). Add vitest + unit-test `isAuthExpired` (tagged `AuthExpiredError`, Effect FiberFailure string form, unrelated error) — its string-match fallback is fragile and a misclassification means redirect loops or a dead dashboard on token expiry. Mirror `cire/web`'s vitest setup
- [x] IB-S-M1 (cire) — _fixed PR #112_: added `X-Content-Type-Options: nosniff` to the invite image-serve `Response` (served type already derives from the upload-time magic-byte allowlist). See `cire/wiki/todo/security.md`, [[cire-auth]]
- [x] IB-S-L1 (cire) — _fixed PR #112_: per-IP rate limiter (30 req/min, overridable) on the organiser invite instance, ahead of auth; 429 test added. See `cire/wiki/todo/security.md`, [[rate-limiting]]
- [x] IB-S-L2 (cire) — _done `feat/cire-assets-reconcile`_: both R2-orphan paths now closed. The retention sweep reaps `cire-sheets` CSVs (`feat/cire-retention-r2-sweep`), and a new daily scheduled **`cire-assets` orphan reconciliation** (`services/asset-reconcile.ts`) deletes invite-image objects under `assets/` referenced by no live `wedding_invite_customisations`/`events` row, with hard fail-safe guards (abort-on-uncertainty: a failed or empty referenced-key read against a non-empty bucket deletes nothing; 7-day grace window; prefix scoping; per-run cap; best-effort deletes). Folds into C-H1 (account-export still open). See `cire/wiki/todo/security.md`

### Recovery / passkey-primary (Phase 5 prerequisites)
- [x] M-PK1b — Out-of-band recovery-code regeneration + consumption notification. `security_events` audit table covers both recovery code kinds; `/account/security-events[/:id/ack | /ack-all]` routes require step-up (S-M1) and the Settings banner uses optimistic local removal (P-I3). **Shipped** — see [[recovery-codes]] and `[[changelog/completed-features]]`
- [x] **M-PK** — Passkey-primary login (2026-04-22). OTP/magic-link primary login removed. `enrollmentToken` JWT machinery deleted — `/passkey/register/*` now authenticates via the normal access token issued by `/register/complete`. Registration is WebAuthn-gated (no flow without a supported browser) and enrollment is mandatory (no "skip" button). WebAuthn registration options: `residentKey: "preferred"` + `userVerification: "required"` — admits FIDO2 keys with PIN/biometric, rejects obsolete UP-only U2F. `deletePasskey` refuses **unconditionally** if it would leave 0 passkeys — account-level invariant "every live account has ≥1 WebAuthn credential" cradle-to-grave. Hardenings from the security review: **S-H1** step-up gate on `/passkey/register/*` when ≥1 passkey + `security_events{passkey_register}` audit row + email notification + server-derived session token; **S-H2** options/verifier UV alignment; **S-M1** uniform `/login/passkey/begin` response closing the enumeration oracle; **S-M2** `aud: "osn-access"` pinned on access tokens. See `[[passkey-primary]]`.

---

## Performance Backlog

Open findings only. Completed fixes archived in [[changelog/performance-fixes]].

### Warning

- [ ] P-W6 (export-fanout-buffering, 2026-07-08 prep-pr review of C-H1) — the osn export streams with keyset pagination + a byte `ReadableStream`, but the downstream `POST /internal/account-export` handlers (`pulse/api/src/services/accountExport.ts`, `zap/api/src/routes/internal.ts`) query `WHERE profileId IN (...)` with **no LIMIT** and materialise the whole NDJSON body in one string before returning — undoing the streaming design at the weakest link (a 128 MB Cloudflare Worker). Bounded per-request by the 1/24h cap, but a pathological account (tens of thousands of RSVPs/events) can OOM the downstream. Fix: keyset-paginate the downstream queries (indexes already exist: `event_rsvps_profile_idx`, `events_created_by_profile_id_idx`, `chat_members_profile_idx`) and stream the sub-bundle via `ReadableStream`. See `[[compliance/dsar]]`.
- [ ] P-I (export-connections-keyset, 2026-07-08 prep-pr review of C-H1) — the `connections` export section pages with `WHERE (requesterId IN ids OR addresseeId IN ids) AND id > cursor ORDER BY id`; the single-column indexes let SQLite union the `OR` but it must then sort each page by `id`, so the keyset benefit is partially lost. Per-user, 1/24h-gated → Info only. Escape hatch: two separately-keyset-paginated passes each ordered by the indexed column, or `(requesterId,id)`/`(addresseeId,id)` composite indexes. `osn/api/src/services/account-export.ts`.
- [x] P-W1 (osn-landing) — `ConstellationCanvas` sized its backing store to the full document height × dpr (≈100 MB on a long page) and cleared+repainted it at ~60 fps forever, on every page. **Fixed** — the layer is now `position: fixed` and the canvas is sized to the viewport (a few MB regardless of page length), and the rAF loop pauses on `visibilitychange`. See [[osn-landing]].
- [x] P-W2 (pulse-landing) — `PulseField`'s rAF `tick` re-ran `querySelectorAll` + allocated ~300 `toFixed` strings every frame (the dot/ring set only changes on resize). **Fixed** — the SVG elements + parsed speed/phase are cached after `regen()` and reused each frame; no per-frame DOM walk. See [[pulse-landing]].
- [x] P-W5 (zap) — `createChat` checked OSN social-graph consent for every initial member in a sequential `for` loop (one S2S round-trip per member, up to `MAX_CHAT_MEMBERS`), serialising a large group create. **Fixed (PR #116 review, labelled P-W1 in the review)** — replaced with bounded-concurrency `Effect.forEach(initialMembers, (t) => checkConsent(creator, t), { concurrency: 10, discard: true })` so the round-trips overlap; any rejection still short-circuits (fail-closed, no half-built chat) — `zap/api/src/services/chats.ts`
- [ ] P-W3 (zap) — `provisionEventChat` non-atomic cross-DB writes
- [ ] P-I2 (zap-cursor) — `listChats` cursor resolution is a second round-trip (caller-scoped lookup, then the page query). Accepted in the 2026-07-03 audit review to keep the unknown/foreign-cursor 422 contract simple; fold the lookup into the page statement as a correlated subquery if zap list QPS ever matters — `zap/api/src/services/chats.ts`
- [ ] P-I3 (zap-sort) — `listChats` sorts the caller's entire chat set per page (`USE TEMP B-TREE FOR ORDER BY` — join-keyed sort can't be index-served). Bounded by per-user membership count; escape hatch if traces ever show it: denormalise `created_at` onto `chat_members` so `(profile_id, created_at DESC)` serves filter + order — `zap/api/src/services/chats.ts`
- [ ] P-I1 (erasure-sweep, 2026-07-05 prep-pr review) — `runEventCancellationSweep` deletes ready events one-at-a-time (up to 100 sequential `commitBatch` round-trips of 4 single-id DELETEs on D1). Background sweeper with a bounded batch, so Info-only; if sweep runtime ever matters, collect `ready.map(r => r.id)` into one `commitBatch` of 4 `inArray` deletes + record the hard-delete counter once via a batch `add(count)` (the `metricEventStatusTransitionBatch` precedent) — `pulse/api/src/services/accountErasure.ts`
- [ ] P-I5 (pulse-write-on-read) — list GETs (incl. the anonymous venue-events surface) can still persist status transitions — now batched to ≤ a handful of statements per request (2026-07-03 sweep), but reads-that-write serialise on SQLite's single writer and block a future read-replica split. Follow-up shape: derive status read-only at query time + background sweep — see [[event-access]], [[venues]]
- [ ] P-I1 (pulse-discovery) — cursor `(start_time, id)` ordering relies on the single-column `events_start_time_idx` for the tiebreak; cheap to add a compound index if series materialisation produces same-second collisions at scale — see `[[event-access]]`
- [ ] P-I1 (pulse-onboarding) — `getOnboardingStatus` re-validates the JSON `interests` column on every read (defensive walk through `INTEREST_CATEGORIES`) even though `Schema.decodeUnknown(CompleteOnboardingSchema)` already enforced membership at write time. Sub-millisecond cost; flagged purely as Info — only worth changing if profiling later shows it. See [[pulse-onboarding]]
- [x] P-W2 — `resolvePublicKey` hits DB when `tokenScopes` provided even if `kid` cache is warm. **Fixed** — cache entry now stores `CryptoKey` + `allowedScopes`; scope validated from cache on hit, no DB round-trip — see [[arc-tokens]]
- [x] P-W100 — `publicKeyCache` unbounded under key rotation churn. **Fixed** — `MAX_CACHE_SIZE` cap with oldest-entry eviction on write — see [[arc-tokens]]
- [x] P-W101 — `peekClaims` decoded payload before checking header validity. **Fixed** — header decoded first; payload decode gated on `kid` present — see [[arc-tokens]]
- [x] P-W102 — `evictExpiredTokens` O(n) scan on every `getOrCreateArcToken` call. **Fixed** — internal debounced sweep (`maybeSweepExpiredTokens`) runs at most once per 30 s; public `evictExpiredTokens` still sweeps immediately — see [[arc-tokens]]
- [x] P-W1 (session) — `trackRotatedSession` swept in-memory Map O(n) on every refresh. **Fixed** — Redis-backed store uses native PX TTL per key; in-memory fallback keeps the existing O(1) amortised FIFO sweep bounded by `ROTATED_SESSIONS_MAX` — see [[sessions]]
- [ ] P-W2 (session) — S-H1 migration adds extra `findProfileById` DB round-trip on every profile endpoint. Embed `accountId` in access token or add profileId→accountId cache — see [[identity-model]]
- [ ] P-W3 (jwks) — `extractClaims` in pulse/api serialises JWKS resolve before DB I/O on read-only routes — parallelise with `Promise.all` for anonymous-capable endpoints — see [[arc-tokens]]
- [ ] P-I4 (auth) — `/login/magic/verify` has no rate limiter — add `magicVerify: RateLimiterBackend` (10/60s per-IP, mirror `/login/otp/complete`). Pre-existing, not a regression; parity with the rest of `/login/*` — see [[rate-limiting]]
- [ ] P-I3 (cire) — `GuestTable` over-fetches the full `/events` payload only to build an id→name chip map, and `DashboardTabs` `<Show>`-mounts tables so a tab switch destroys `GuestTable` and refires both guests + events fetches. Lift the guests/events fetches to the dashboard shell (`createResource` at `DashboardTabs` level) so tab state doesn't own fetch lifetime; sibling of the already-tracked ImportPanel tab-switch refetch in `cire/wiki/todo/perf.md` — see [[cire]]
- [x] IB-P-W1 (cire) — _fixed PR #112_: `index.astro` resolves the customisation at build time and passes it to `InviteHeader` as `initial`, so hero copy + `<img src>` are in the SSR'd HTML; island revalidates on mount. See `cire/wiki/todo/perf.md`
- [x] IB-P-W2 (cire) — _fixed PR #112_: `index.astro` emits `<link rel="preload" as="image">` for the build-resolved hero image. See `cire/wiki/todo/perf.md`
- [x] IB-P-W3 (cire) — _fixed PR #112_: `getForWeddingId` collapsed into one `weddings LEFT JOIN wedding_invite_customisations`; `imageKeyForSlug` likewise (IB-P-I1). See `cire/wiki/todo/perf.md`
- [ ] P-I17 (venues) — a venue page view re-reads the venue row up to 3× (detail route, inside `listVenueEvents`, lineup gate) and the client lineup fetch waits on venue + events (two-hop waterfall). Consider joining the lineup gate's event check to the venue row and embedding the featured event's lineup in the `/events` response (`?include=featured_lineup`) to drop the serial RTT — see [[venues]]
- [ ] P-W22 — Two `Effect.runPromise` calls per internal graph request — consolidate when S2S throughput grows — see [[arc-tokens]]
- [x] P-W25 — `publicKeyCache` uses FIFO eviction; upgrade to LRU so the most-recently-used keys are kept under churn. **Fixed** — side-timestamp map (`publicKeyLastAccess`) records last-access in ms; O(1) touch on hit, O(n) scan only at eviction (DB-miss path) — see [[arc-tokens]]
- [x] P-W26 — `publicKeyCache` hit path used Map delete+re-insert for LRU touch (O(log n) + allocation on hot path). **Fixed** — replaced with `publicKeyLastAccess.set(kid, Date.now())` (single map write) — see [[arc-tokens]]
- [x] P-W27 — `allowedScopes` stored as raw comma-separated string; split+includes on every cache-hit scope check. **Fixed** — stored as `Set<string>` parsed once at DB-miss time; hit path uses `Set.has()` O(1) — see [[arc-tokens]]
- [x] P-I16 — `tokenCache` used FIFO eviction (insertion-order head eviction). **Fixed** — `tokenLastAccess` side-map added; `getOrCreateArcToken` evicts true LRU entry on overflow; sweep/clear functions maintain the side map — see [[arc-tokens]]
- [x] P-W1 (explore) — `ExplorePage` not lazy-loaded despite being the heaviest route. **Fixed** — wrapped in `lazy()` for route-level code splitting
- [x] P-W2 (explore) — Render-blocking Google Fonts `@import` in CSS. **Fixed** — moved to `<link>` tags in `index.html` with `preconnect` hints
- [ ] P-W28 (explore) — `GET /venues` (`listAllVenues`) does an unbounded table scan to feed the Explore map; replace with a bbox-aware query (`WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`, viewport derived from the map) and an in-memory haversine refine. Same shape needed for events (`listEvents` accepts no bbox today either) — both surfaces should share a `(minLat, maxLat, minLng, maxLng, limit)` contract. Pre-req: compound index on `(latitude, longitude)` (already present on `venues_lat_lng_idx`, `events_lat_lng_idx`). When built, select a thin pin projection (`id, orgHandle, handle, name, kind, capacity, latitude, longitude`) instead of `SELECT *` — the map renders none of the heavy fields (description, hours JSON, image/website URLs). Owner: Pulse — see [[venues]], [[event-access]]
- [ ] P-W23 — `tailwind-merge` (~12-14 KB) in initial bundle — see [[component-library]]
- [ ] P-W24 — `cn()` with signal reads replaces `classList` — avoid in `<For>` loops — see [[component-library]]
- [x] P-W3 (org) — Sequential queries in `removeMember` and `updateOrganisation` could be parallelised. **Fixed** — `callerMember`+`targetMember` in `removeMember` and `orgRows`+`memberRows` in `updateOrganisation` now use `Effect.all({ concurrency: 2 })`. `resolveOrg`+`resolveHandle` in the three member routes now run via `Promise.all`
- [ ] P-W6 (recs) — No caching/pagination contract on `/recommendations/connections`. Every request re-runs the FOF pipeline. Add short-lived per-caller cache (5-15 min) and/or `generated_at` timestamp so clients can detect cached responses — see [[social-graph]]
- [ ] P-W7 (recs) — FOF aggregation in JS after capping fan-out (current). Next step: push aggregation to SQL via `SELECT candidate_id, COUNT(*) FROM (...) GROUP BY candidate_id ORDER BY count DESC LIMIT ?`. Add compound indexes `connections(status, requester_id)` + `connections(status, addressee_id)` — see [[social-graph]]
- [ ] P-W2 (auth-ttl) — 3600s → 300s access-token TTL raises `/token` write load ~12× per session (DELETE+INSERT on `sessions` each refresh). Single-flight refresh (shipped as S-H1 fix) caps concurrent multiplication but doesn't change the baseline. Before horizontal-scale promotion: (a) watch `osn.auth.token.refresh` rate, (b) consider window-based session rotation (only rotate the refresh-token row when `now - createdAt > rotateAfterMs`) so the common case becomes "issue new access token, leave sessions row untouched" while still preserving C2 reuse detection — see [[identity-model]]
- [ ] P-W3 (graphBridge) — `osGet`/`osPost` in `pulse/api/src/services/graphBridge.ts` have span tracing but no per-call latency histogram. Without a histogram we can't set an SLO on the bridge or detect tail-latency regressions; `GET /close-friends` and the rsvps `isCloseFriend` stamp both sit on the bridge's hot path. Add a histogram metric keyed by endpoint + outcome — see [[pulse-close-friends]], [[s2s-patterns]]
- [x] P-W1 (passkey) — `completePasskeyRegistration` MAX_PASSKEYS race guard was SELECT-then-INSERT outside a transaction. **Fixed** — both statements now run inside `db.transaction`, collapsing the TOCTOU window to zero on SQLite — see [[identity-model]]
- [x] P-I1 (passkey) — `deletePasskey` issued two SELECTs against `passkeys` for the same account. **Fixed** — collapsed into one query inside the transaction; the per-account 10-row cap means the in-memory `.some(…)` check is O(1) — see [[identity-model]]
- [x] P-I2 (passkey) — `loginChallenges` map had no hard cap, only TTL eviction. **Fixed** — `MAX_LOGIN_CHALLENGES = 10_000` ceiling enforced on both the identifier-keyed and discoverable (`__disc__:<uuid>`) insert paths — see [[identity-model]]

### Info

- [ ] P-I1 (osn-landing) — `ConnectionsHero.render()` re-maps the ring points (`RING.map(pt)`) each frame during the 1.6 s entrance; hoist alongside `edges` in `rebuildEdges()`. Trivial, animation is bounded. See [[osn-landing]].
- [ ] P-I2 (osn-landing) — `ConstellationCanvas` link loop calls `Math.hypot` per node pair; compare squared distance (`dx*dx+dy*dy < LINK_DIST²`) and only sqrt the surviving pairs. Micro-opt, bounded by `MAX_NODES=120`. See [[osn-landing]].
- [x] P-W1 (cire-landing) — Vine scroll loop repainted the whole field every frame. **Fixed on `claude/cire-landing-page-hcebp7`** — `VineCanvas` now skips redundant `--p` writes (off-screen vines pinned at 0/1 are unchanged → no recalc/paint), bounding per-frame paint to vines crossing the growth front. See [[cire-landing]].
- [x] P-W2 (cire-landing) — Full vine regenerate fired on every resize settle, incl. mobile URL-bar height-only resizes (jank + reseed glitch mid-scroll). **Fixed** — regen gated to real WIDTH changes; the per-load seed is stable across resizes so a genuine resize re-lays-out the same plant. See [[cire-landing]].
- [ ] P-I1 (cire-landing) — Optional: self-host the Google Font WOFF2 subsets (collapses two third-party connections into same-origin `_astro/*` immutable-cached requests) and pass tighter `sizes` to `Figure.astro` where a figure renders narrower than 45vw. Low priority for a low-traffic static page; fold into the apex cutover. See [[cire-landing]].
- [x] P-I1 — `evictExpiredTokens` iterates full cache on every `getOrCreateArcToken` call. **Fixed as P-W102** — debounced internal sweep — see [[arc-tokens]]
- [x] P-I100 — `rotateKey` retry had no jitter; simultaneous failures on horizontal instances caused thundering-herd on `/register-service`. **Fixed** — retry delay is `5 min ± 30 s` — see [[arc-tokens]]
- [x] P-I101 — `startKeyRotation` scheduled a rotation timer for the pre-distributed key path that always silently no-oped. **Fixed** — pre-distributed key path removed entirely; all rotation is ephemeral auto-rotation — see [[arc-tokens]]
- [ ] P-I1 (osn-runtime) — The shared `appRuntime` (`osn/api/src/index.ts`) has no `dispose()` wired to a SIGTERM/SIGINT handler, so a clean shutdown defers the final OTel exporter flush + SQLite close to the platform's grace period. One-time, process-lifetime concern (the opposite of the per-request rebuild it replaced); add a shutdown hook if a graceful-drain story is needed — see [[architecture/backend-patterns]]. **2026-07-03 update:** `pulse/api` + `zap/api` now build one `ManagedRuntime` per route factory (9 total) — same undisposed-at-shutdown posture, and a candidate to consolidate into one shared per-process runtime (osn's `makeAppRunner` model) if/when those services grow an observability layer.
- [ ] P-I1 (pulse) — `Register`/`SignIn` eagerly imported in `Header.tsx` — lazy-load for authenticated users — see [[component-library]]
- [ ] P-I2 (pulse) — Module-level `createSignal` in `createEventSignal.ts` outside reactive owner — wrap in `createRoot` if effects added later
- [ ] P-I3 (share-attribution) — Once an organiser attribution-analytics endpoint lands (the consumer of `share_source_first` / `share_source_last`), add a composite index on `event_rsvps (event_id, share_source_first)` and `(event_id, share_source_last)` to keep the per-event aggregation off a table scan. No-op until that read path exists — see [[event-access]]
- [ ] P-I (series) — `SeriesDetailPage` refetches on every scope tab switch (no cache); `summariseRRule` recomputes on every render — `createMemo` + a `Map<scope, SeriesInstance[]>` cache
- [ ] P-I1 (vid) — `presentations` table grows unbounded per account. When V-M4 lands, add retention to [[compliance/retention]] (e.g. 12 months), index `(account_id, issued_at desc)`, cursor-paginated history view — see [[verified-identity]]
- [ ] P-I2 (vid) — Sybil dedupe will sequential-scan `verified_attributes` without an index. Add a unique partial index on `verified_attributes(document_number_hash) WHERE document_number_hash IS NOT NULL` and a covering `(provider_id, document_number_hash)` index in V-M2 schema migration — see [[verified-identity]]
- [ ] P-I3 (vid) — Per-request AES decrypt for `age_over_16` / `age_over_18` predicates is wasted CPU on hot paths. Store boolean predicates plaintext alongside the encrypted JSON `value` — booleans alone are not Special Category data, only DOB/name need Art. 9 protection — see [[verified-identity]], [[compliance/gdpr]]
- [ ] P-I4 — Deprecated `bx()` still exported from `@osn/ui` — remove once no external consumers remain — see [[component-library]]
- [ ] P-I5 — Auth Dialog components always mounted in EventList (vs conditional `<Show>`) — negligible for two forms but revisit if dialogs grow heavier
- [ ] P-I4 — `AuthProvider` reconstructs Effect `Layer` on every render — wrap with `createMemo`
- [ ] P-I1 (db-dev-tooling) — Root `db:reset` runs the four app resets sequentially via `&&` though the DBs are independent. Wall-clock-only cost on a hand-run command; could fan out via a `turbo run db:reset` task if it ever becomes annoying. Sequential fail-fast is an acceptable default
- [ ] P-I2 (db-dev-tooling) — `cire/db` `db:reset` spawns multiple `bunx wrangler`/`bun run` processes (startup overhead). Negligible on a manual command; collapsing the two D1 `execute` calls in `scripts/cire-db-seed.sh` is only worth it if startup time becomes a nuisance
- [ ] P-I5 — `/graph/internal/connections` has no `offset` parameter — see [[arc-tokens]]
- [ ] P-I3 (recovery) — `generateRecoveryCodesForAccount` computes `genId()` + `hashRecoveryCode()` synchronously for the whole batch before the DB transaction. Nil impact at `RECOVERY_CODE_COUNT = 10` with SHA-256; flag only as a precondition for any future switch to a memory-hard KDF — wrap the `rows.map(...)` in `Effect.sync` so the runtime can yield — see [[recovery-codes]]
- [ ] P-I20 (account-deletion) — Pulse in-memory ARC key registry (`pulse/api/src/lib/arc-middleware.ts`) grows unboundedly across osn-api restarts (each restart registers a fresh kid; old ones stay in the map). Periodic eviction of entries with `expiresAt < now - 24h`, or cap to N most-recent kids per issuer — see [[arc-tokens]]
- [ ] P-I21 (account-deletion) — `runFanOutRetrySweep` `WHERE pulse_done_at IS NULL OR zap_done_at IS NULL` cannot use the partial indexes under an OR; SQLite falls back to a table scan as `deletion_jobs` grows. Replace with `UNION ALL` of two queries (each using its dedicated partial index) deduplicating in JS, OR add a `fanout_pending` generated column. Volume is low so deferred — see [[wiki/compliance/dsar]]
- [ ] P-I2 (security-events) — `listUnacknowledgedSecurityEvents` returns up to 50 rows with no pagination token. Fine for today's single-kind taxonomy, but silently drops older rows if the list grows past the cap. Add `?before=<createdAt>` + `{ events, hasMore }` once another kind is introduced — see [[recovery-codes]]
- [ ] P-I4 (security-events) — `GET /account/security-events` has no `Cache-Control` header. Low-impact today (the query is cheap and the banner fetches once per mount); add `Cache-Control: private, no-store` + a weak ETag on `MAX(created_at)` once the banner starts polling or is embedded outside Settings — see [[recovery-codes]]
- [x] P-I10 — `beginPasskeyRegistration` fetches all passkeys without `LIMIT` — `MAX_PASSKEYS_PER_ACCOUNT = 10` enforced at begin and race-safely re-checked at complete — see [[identity-model]]
- [ ] P-I6 — Duplicate index on `users.email` — `unique()` already creates one implicitly in SQLite
- [ ] P-I1 (client) — Duplicated `authGet`/`authPost`/`authPatch`/`authDelete` helpers across `graph.ts`, `organisations.ts`, `recommendations.ts`. Factor to `@osn/client/src/lib/auth-fetch.ts` parameterised by error-class constructor — see [[component-library]]
- [ ] P-I4 (social) — List pages (`ConnectionsPage`, `OrganisationsPage`) have no pagination UI. Server supports `limit`/`offset` but users with &gt;50 connections silently lose visibility. Add infinite-scroll via `IntersectionObserver` or paginator
- [ ] P-I1 (ratelimit-native) — The Workers native rate-limit bindings (`RL_AUTH_IP_*`, #153) count **per colo**, not globally — an IP hitting two Cloudflare data centres gets up to N× the nominal 60s budget. Accepted trade-off for the 60s auth-IP tier (the 1h IP limiters + per-user/account limiters stay on Upstash for global counting); document so it isn't re-flagged as a bug, and revisit if a distributed auth-flood is observed across colos — see [[rate-limiting]], [[redis]]
- [ ] P-I2 (workerd-otel) — **OTel metric/trace export is deferred on workerd** — the deployed `osn-api` + `cire-api` Workers don't ship app-level OTel to Grafana Cloud (the runtime doesn't support the `@effect/opentelemetry` NodeSdk export path yet); Cloudflare Workers Logs are the interim signal. So `osn.*` / `cire.*` metrics + spans are NOT queryable in Grafana while those services run as Workers. Re-wire once a workerd-compatible exporter lands (or a CF→OTLP bridge). Until then, dashboard work that depends on Worker-emitted metrics is blocked to the Bun-hosted dev path — see [[observability/overview]], [[free-tier-limits]]

---

## Compliance Backlog

Open compliance findings only. Closed items will be archived in a future `wiki/changelog/compliance-fixes.md` (created on first close). See `[[compliance/index]]` for the programme overview and `[[compliance/scope-matrix]]` for the in-scope-laws map. ID format documented in `[[review-findings]]`.

### High

- [ ] **C-H1** — Account-level data export endpoint (`GET /account/export`, step-up gated). GDPR Art. 15 + Art. 20 + CCPA right to know. JSON bundle including ARC fan-out to `@pulse/api` (RSVPs, hosted events, close-friends) and `@zap/api` (chat membership, NOT message ciphertext). Streaming JSON, rate-limit 1/day/account. See `[[compliance/dsar]]`, `[[compliance/data-map]]`.
- [x] **C-H2** — Account-level erasure endpoints. Two flows: `DELETE /account` on osn-api (full OSN deletion, 7-day soft-delete tombstone, fan-out to enrolled apps via ARC + retry sweeper); `DELETE /account` on pulse-api (Flow B, leave-Pulse, 7-day grace, hosted-event 14-day public cancellation window). Step-up gated with new `purpose` claim (`account_delete`, `pulse_app_delete`). New `app_enrollments` table tracks per-app opt-in. Recorded in `[[changelog/compliance-fixes]]`.
- [ ] **C-H3** — Photon geocoder keystroke leak (S-M13 follow-up). GDPR Art. 5(1)(c) data minimisation + Art. 7 consent. Proxy through `@pulse/api` so Photon never sees user IP, debounce server-side, add one-time consent dialog on first use. See `[[compliance/data-map]]`, S-M13 in Security Backlog.
- [x] **C-H4** — Privacy notice + ToS published. GDPR Art. 12-14 + CCPA notice-at-collection + DSA Art. 14. **Cire guest site shipped `/privacy` + `/terms` with a site-wide footer (PR #124)** — Australia/APP framing, controller Aniket Chavan, DSAR contact chavaniket@duck.com, 1-year retention basis, plain language, linked from the RSVP point of collection. The parallel `@osn/landing` notice (drafts under `wiki/compliance/legal-drafts/`) remains a follow-up. Move to `wiki/changelog/compliance-fixes.md`. See `[[compliance/gdpr]]`, `[[compliance/dsa]]`, `[[compliance/ccpa]]`, `[[changelog/compliance-fixes]]`.
- [ ] **C-H5** — DPA + SCC pack signed for active processors. GDPR Art. 28 + Art. 44-49. Cloudflare DPA, Grafana Labs DPA + SCCs, chosen Redis provider DPA, Komoot/Photon DPA. File under `wiki/compliance/dpa/<vendor>.md` with execution date + scope. See `[[compliance/subprocessors]]`.
- [ ] **C-H6** — DSA notice-and-action endpoint (`POST /reports`). DSA Art. 16. Lands in both `@pulse/api` and `@zap/api` with shared `@shared/moderation` package. Accepts the Art. 16 minimum schema (substantiated explanation, exact location, notifier identity, good-faith statement). See `[[compliance/dsa]]`.
- [ ] **C-H7** — DSA statement-of-reasons system. DSA Art. 17. `moderation_actions` table + email template + `GET /account/moderation-actions` for the affected user. Mandatory for every restriction (post removal, account suspension, demotion, RSVP rejection by host). See `[[compliance/dsa]]`.
- [ ] **C-H8** — Date-of-birth field + age gate on registration. COPPA actual-knowledge defense. TypeBox `birthdate: Date` schema; reject under-13 before email OTP send; rejected DOB not retained. See `[[compliance/coppa]]`. **Note**: the V-M2 verified-identity flow can short-circuit this self-declared path with a verified `age_over_16` attribute — see [[verified-identity]].
- [ ] **C-H9** — DPIA for Verified Identity (V-M0 prerequisite). GDPR Art. 35. Biometric template hashes + identity-document data are Special Category Personal Data under Art. 9; DPIA must be filed before the first KYC vendor is wired. See [[verified-identity]], [[compliance/gdpr]].
- [ ] **C-H10** — DVS access registration with the Department of Home Affairs (V-M2 prerequisite). Australian Privacy Act 1988 + APP 11 + DVS-approved consent statement displayed verbatim before each call. See [[verified-identity]], [[compliance/data-map]].
- [ ] **C-H11** — Art. 9 explicit-consent capture for Verified Identity. Each verification ceremony must capture timestamp + version + locale + SHA-256 of the exact wording shown, stored in a `consent_records` table (likely scaffolds C-L1 ahead of schedule). Withdrawal path documented. Block V-M1 — see [[verified-identity]], [[compliance/gdpr]].

### Medium

- [ ] **C-M1** — DSAR runbook operationalised (`dsar_requests` audit table, `dsar@osn.example` email alias + automated acknowledgement, postal address on landing legal page, internal triage doc, SLA monitoring alerting at 25 d). GDPR + CCPA + state-law DSARs. See `[[compliance/dsar]]`.
- [ ] **C-M2** — Sweeper jobs for retention windows: `security_events` >12 months, `email_changes` >90 days, expired `sessions` rows, deletion tombstones >30 days. GDPR Art. 5(1)(e). Single cron-style worker in `@osn/api` using Bun `setInterval`. See `[[compliance/retention]]`.
- [ ] **C-M3** — DPIA template + first three filings: Pulse special-category event exposure, Zap M3 org-chat transcripts (before M3 ships), Zap M4 locality channels (before M4 ships). GDPR Art. 35. See `[[compliance/gdpr]]`.
- [ ] **C-M4** — Continuous-control monitoring tool selected (Vanta / Drata / Secureframe) before SOC 2 Type I prep. SOC 2 evidence-collection lifecycle. See `[[compliance/soc2]]`.
- [ ] **C-M5** — Production access control matrix (`wiki/compliance/access-matrix/<YYYY>-<Q>.md`) — first cycle 2026-Q3. SOC 2 CC6. See `[[compliance/access-control]]`.
- [ ] **C-M6** — Backup + DR plan finalised + first restore drill (Q3 2026 dry run). SOC 2 A1. RTO 4h / RPO 24h initial targets. See `[[compliance/backup-dr]]`.
- [ ] **C-M7** — Dependency CVE scanning in CI (`osv-scanner` or equivalent). Fail on critical, warn on high. SOC 2 CC7 + supply-chain hygiene. See `[[compliance/soc2]]`.
- [ ] **C-M8** — `security.txt` + Vulnerability Disclosure Policy (`/.well-known/security.txt` on `@osn/landing`; VDP at `wiki/compliance/vdp.md`). SOC 2 CC2 + breach-detection channel. See `[[compliance/soc2]]`, `[[compliance/breach-response]]`.
- [ ] **C-M9** — "Do Not Sell or Share My Personal Information" + "Limit Use of My Sensitive Personal Information" footer links on `@osn/landing`. CCPA + state-privacy laws. We do not sell/share but the link is mandatory. See `[[compliance/ccpa]]`.
- [ ] **C-M10** — DSA points of contact (Art. 11 authority + Art. 12 user) + ToS draft published. See `[[compliance/dsa]]`.
- [ ] **C-M11** — Internal complaint / appeal endpoint (`POST /moderation/appeals`) routing to a human reviewer; 6-month availability per DSA Art. 20. See `[[compliance/dsa]]`.
- [ ] **C-M12** — Trader-traceability flow built into Zap M3 verification (Art. 30 — name, address, phone, email, registration ID, self-declaration). Block trader from interacting until verified. See `[[compliance/dsa]]`.
- [ ] **C-M13** — Under-13 detected account-deletion runbook for support-discovered minors. Immediate delete + parent notification. COPPA. See `[[compliance/coppa]]`.
- [ ] **C-M14** — Axe-core in CI (`@axe-core/playwright`) running against `@osn/landing`, `@osn/social`, `@pulse/app` on every PR. Fail on serious / critical violations. EAA / WCAG 2.1 AA. See `[[compliance/eaa]]`.
- [ ] **C-M15** — Sweeper-job framework (cron-style worker in `@osn/api`). Foundation for C-M2. See `[[compliance/retention]]`.
- [ ] **C-M16** — `admin_actions` audit log table (append-only) + Grafana log mirror. SOC 2 CC6 attribution requirement. See `[[compliance/access-control]]`.
- [ ] **C-M17** — KYC vendor RFP must enumerate per-vendor data residency (storage region), SCC required (Y/N), DPA template available (Y/N), and sub-sub-processors disclosed (Y/N). Block vendor selection on these columns. See `[[verified-identity]]`, `[[compliance/subprocessors]]`.
- [x] **C-M18 (C-M1, Upstash region)** — **Resolved: Upstash region = `ap-southeast-2` (Sydney).** Co-located with the D1 databases (`oc`/Sydney) + Australian edge traffic for low RSVP/auth-write latency; the project is AU-centric. The P2 Redis backend holds only pseudonymised auth/rate-limit state, so AU hosting raises no new GDPR Chapter V transfer concern — EU/UK guest data transiting to AU is covered by the same consent/notice basis as the rest of the guest data (DPA still to sign under C-H5). Recorded in `[[changelog/compliance-fixes]]`. See `[[compliance/subprocessors]]`, `[[compliance/gdpr]]`.

### Low

- [ ] **C-L1** — `consents (id, account_id, purpose, given_at, withdrawn_at, evidence)` table. Required once first consent-based purpose lands (geocoder, marketing email, analytics). GDPR Art. 7. See `[[compliance/gdpr]]`.
- [ ] **C-L2** — DPO designated and named on `@osn/landing/legal/contact`. Even if not strictly required, simplifies enterprise customer DPAs. See `[[compliance/gdpr]]`, `[[compliance/breach-response]]`.
- [ ] **C-L3** — Quarterly access review process (calendar + checklist + record under `wiki/compliance/access-reviews/`). First cycle 2026-Q3. SOC 2 CC6. See `[[compliance/access-control]]`.
- [ ] **C-L4** — GitHub org hardening: required hardware-key MFA, required signed commits, branch protection, codeowners on prod paths. SOC 2 CC6 + CC8. See `[[compliance/access-control]]`.
- [x] **C-L5** (pulse-landing) — new IP-geo processing surface (`@pulse/landing` `/api/geo`) needed an Art. 30 ROPA row. **Fixed** — added to `[[compliance/data-map]]` Cross-cutting: coarse city-level, Art. 6(1)(f) legitimate interest, computed per request at the edge, not retained, no third party, no cookies. See `[[pulse-landing]]`.
- [ ] **C-L5** — Annual third-party penetration test before SOC 2 Type II. Budget allocation. See `[[compliance/soc2]]`.
- [ ] **C-L6** — Cyber + E&O insurance quote before first paying customer. Claim contact listed in `[[compliance/breach-response]]`. See `[[compliance/soc2]]`, `[[compliance/breach-response]]`.
- [ ] **C-L7** — Global Privacy Control (`Sec-GPC: 1` header) recognition middleware in `@osn/api`. CCPA + Connecticut + Colorado universal-opt-out signal. See `[[compliance/ccpa]]`.
- [ ] **C-L8** — Recommender-transparency disclosure in ToS (Pulse discovery factors documented in plain language). DSA Art. 27. See `[[compliance/dsa]]`.
- [ ] **C-L9** — Strike system + misuse safeguards: counter on accounts; auto-suspend at threshold; auto-rate-limit unfounded reporters. DSA Art. 23. See `[[compliance/dsa]]`.
- [ ] **C-L10** — Annual transparency-report data collection scaffold (we are SME-exempt today but the data should be collected anyway, ready to publish if threshold crossed). DSA Art. 15 / 24. See `[[compliance/dsa]]`.
- [ ] **C-L11** — Annual COPPA self-assessment (30-min doc confirming the design has not drifted toward a child audience). See `[[compliance/coppa]]`.
- [ ] **C-L12** — Verify `oxlintrc.json` `jsx-a11y` rules match WCAG 2.1 AA (some are off by default). EAA. See `[[compliance/eaa]]`.
- [ ] **C-L13** — Manual screen-reader pre-release checklist (VoiceOver on macOS Safari, NVDA on Windows Firefox, TalkBack on Android Chrome). EAA. See `[[compliance/eaa]]`.
- [ ] **C-L14** — Pulse map keyboard parity (marker selection, zoom, pan, detail expand). EAA. See `[[compliance/eaa]]`.
- [ ] **C-L15** — Pulse calendar non-colour state cues (icons / text labels for "Not Started / Started / Ongoing / Finished"). EAA. See `[[compliance/eaa]]`.
- [ ] **C-L16** — Accessibility statement on `@osn/landing/legal/accessibility` listing supported AT, known gaps, contact. EAA Art. 13. See `[[compliance/eaa]]`.
- [ ] **C-L17** — Captions / transcripts for any video content on `@osn/landing`. EAA Art. 4. See `[[compliance/eaa]]`.
- [ ] **C-L18** — Lint rule blocking new third-party script tags in HTML / Astro templates. Forces explicit decision before flipping us into "ePrivacy consent required". See `[[compliance/eprivacy]]`.
- [ ] **C-L19** — Cookie banner scaffold built into `@osn/landing` (built but not mounted). Mounting requires DPO sign-off. ePrivacy. See `[[compliance/eprivacy]]`.
- [ ] **C-L20** — Pulse event archival flow (`endTime + 90 d` → archived view or status flag). Retention. See `[[compliance/retention]]`.
- [ ] **C-L21** — Tailscale (or equivalent bastion) for direct DB access; no public DB endpoint. SOC 2 CC6. See `[[compliance/access-control]]`.
- [ ] **C-L22** — Departure runbook formalised (the access-revocation checklist). SOC 2 CC6. See `[[compliance/access-control]]`.
- [ ] **C-L23** — GitHub mirror to a second host (Codeberg / Gitlab.com / private S3) for code-catastrophic-loss scenarios. SOC 2 A1. See `[[compliance/backup-dr]]`.
- [ ] **C-L24** — Encryption-at-rest documentation (Supabase / R2 / Redis-provider defaults captured). SOC 2 C1. See `[[compliance/backup-dr]]`.
- [ ] **C-L25** — Backup integrity verification (per-snapshot checksum; reject restores from corrupted snapshots). SOC 2 A1. See `[[compliance/backup-dr]]`.
- [ ] **C-L26** — Cross-link DSA Art. 28 (minor protections) to ToS recommender-transparency disclosure. Verified Identity unlocks credible age-gating; ToS update should ship same PR as V-M1. See `[[verified-identity]]`, `[[compliance/dsa]]`.
- [x] **C-L27 (cire, IB-C-L1)** — _done PR #112_: `[[compliance/data-map]]` + `[[compliance/retention]]` rows added for `cire-assets` invite images + `wedding_invite_customisations`. Erasure reachability remains open (D1 cascade doesn't reach R2, no wedding-delete flow) — recorded in those pages and folded into C-H1 / cire IB-S-L2. GDPR Art. 5(1)(e). See `cire/wiki/todo/security.md`.

---

## Auth Improvements (Copenhagen Book Audit)

Findings from auditing OSN auth against [The Copenhagen Book](https://thecopenhagenbook.com/) by pilcrowonpaper. Organised in priority phases.

### Phase 1 — Session Revocation (Critical)
- [x] C1: Server-side session table in `osn/db` — store hashed refresh tokens, enable revocation — see [[identity-model]]
- [x] C2: Refresh token rotation on `/token` refresh grant — new token each refresh, detect reuse — see [[identity-model]]
- [x] H1: Invalidate all sessions on security events (passkey registration, email change) — see [[identity-model]]

### Phase 2 — Token Storage + Transport (Critical)
- [x] C3: Move refresh tokens from `localStorage` to `HttpOnly; Secure; SameSite=Lax` cookies (BFF pattern) — see [[identity-model]]
- [x] M1: Add Origin header validation middleware (required once cookies carry auth state) — see [[rate-limiting]]

### Phase 3 — Defense-in-Depth (High)
- [x] H2: SHA-256 hash magic link tokens before storage in `magicStore` — see [[identity-model]]
- [x] H3: SHA-256 hash OTP codes before storage in `pendingRegistrations` — see [[identity-model]]
- [ ] H4: Migrate `@zap/api` from shared-secret JWT verification to JWKS-based (align with Pulse) — see [[arc-tokens]]

### Phase 4 — Hardening (Medium)
- [x] M2: Recovery codes — 10 × 64-bit single-use codes, SHA-256 hashed at rest, revoke-all-sessions on consume. See [[recovery-codes]] + [[identity-model]]
- [x] M3: Email max length validation (≤255 chars) in `EmailSchema` — done 2026-07-05 (length gate ahead of the format regex; 255-char boundary tested)
- [ ] M5: Increase registration OTP from 6-digit to 8-digit (or 6-char alphanumeric)
- [x] C3-follow-up: Access token TTL cut from 1h → 5min; client `authFetch` silent-refreshes on 401 via the HttpOnly session cookie. Caps XSS blast radius on the remaining localStorage secret. See [[identity-model]]

### Phase 5 — Passkey-primary (Next)
- [x] S-H1 (session): Move in-memory `rotatedSessions` map to Redis so C2 reuse detection survives restart + scales across processes. **Done** — see [[sessions]]
- [ ] Device/session listing + revocation UI (`GET /sessions`, `DELETE /sessions/:id`). Requires `sessions.user_agent`/`ip_hash` columns. Depends on: nothing.
- [x] M-PK: Switch to passkey-primary login — see `[[passkey-primary]]`. OTP/magic-link primary login deleted; recovery code remains as the "lost device" escape hatch; security keys accepted in addition to platform passkeys; `deletePasskey` strict last-passkey guard locks in the ≥1-credential invariant.

---

## Deferred Decisions

| Decision | Context | Revisit When |
|----------|---------|--------------|
| Social media platform name | Need a catchy name | Before starting Phase 3 |
| CI lint gate: deny warnings? | 2026-07-03 quality review drove oxlint 463 → 21 warnings; the 21 survivors are the deliberately-warn jsx-a11y set (native `<dialog>`/`<progress>`/`<output>` refactors that change behaviour). `--deny-warnings` in CI would stop future drift but makes "warn" mean "error" — either fix/waive the a11y set first or keep warnings advisory | Next time lint drift is noticed, or when the a11y items are actioned |
| Signal vs MLS for Zap group chats — see [[zap]] | Sender-keys is simpler; MLS scales past ~50 members. **Hard constraint either way:** hybrid PQ KEM (classical + ML-KEM-768) — messages are durable and HNDL-exposed | Before Zap M2 |
| Zap media storage (images / voice / video) | Needs E2E-friendly blob storage; SQLite-only won't cut it | When Zap M2 lands |
| Effect.ts adoption | Trial underway in `pulse/api` | After more service coverage |
| Supabase migration | Currently SQLite | When scaling needed |
| Android support | iOS priority | Phase 3 |
| Self-hosting | Enterprise use case | Phase 3 |
| Payment handling | Deferred for Pulse ticketing | After core Pulse features |
| Two-way calendar sync | Currently one-way (Pulse → external) | Phase 2 |
| Community event-ended reporting | 15–20 attendees auto-finish; host notified | When attendee/messaging features land |
| DB table rename `users` → `profiles` | Table represents profiles; renaming is migration-heavy for minimal benefit | Only if it causes genuine confusion |
| S2S scaling — see [[s2s-patterns]], [[arc-tokens]], [[s2s-migration]] | `pulse/api` graphBridge now uses HTTP + ARC. Remaining: `zap/api` bridge still uses direct import | When `zap/api` needs horizontal scaling |
| Per-app blocking — see [[social-graph]] | Blocks global across all OSN apps. Per-app scope deferred | When Messaging or third-party app needs independent block lists |
| `@chenglou/pretext` for Zap virtual scroll — see [[zap]] | Pure-JS text measurement/layout. Enables virtualised message lists | When Zap UI needs message list virtualisation |
| Profile transfer between accounts | Meta supports unlinking/relinking profiles | After multi-account ships (P6) |
| Per-profile notification email | Profiles might want separate contact emails | When notification system is built |
| Profile-level 2FA | Currently 2FA would be account-wide (passkeys on accounts) | When 2FA is implemented |
| Cross-profile content sharing | Reposting between own profiles | Phase 2 social features |
| Max profiles per account | Set to 5 via `accounts.maxProfiles`; make configurable? | Before launch |
| Self-interaction policy | Two profiles from same account CAN interact (preventing it leaks the link) | Multi-account P6 privacy audit |
| Build-time `cn()` evaluation — see [[component-library]] | `tailwind-merge` runs at runtime. Options: Vite plugin, drop to `clsx`-only | When bundle size is a concern |
| Tauri passkey support on iOS | Webview lacks WebAuthn natively — auto-skips passkey step. Options: `tauri-plugin-webauthn`, custom plugin, wait for upstream | When iOS build of Pulse is ready for sign-in |
| Email Worker per-recipient rate-limit bound — see [[email]] | Prevents OSN from flooding an inbox under bug / abuse. Tune once we have send-rate telemetry | After first week of real traffic |
| Dry-run flag for email — see [[email]] | `OSN_EMAIL_DRY_RUN` env knob that short-circuits before Worker dispatch; useful for staging smoke tests | When we need it |
| KYC vendor for V-M1 / V-M2 — see [[verified-identity]] | Persona (top AU age-assurance trial scorer; combined estimation + verification) vs idvPacific (AU-domiciled DVS gateway, OCR-first) vs Equifax IDMatrix (heavyweight gateway) vs MATTR/GBG (mDL-native; mDL roadmap partner) | V-M0 vendor RFP |
| BBS+ vs SD-JWT-per-audience for verified presentations — see [[verified-identity]] | SD-JWT-per-audience is the v1 default (mint a fresh credential per RP); BBS+ adds true unlinkable presentations at higher operational cost | If a documented cross-RP correlation threat lands |
| Verified attributes scope: account-level vs profile-level — see [[verified-identity]], [[identity-model]] | Verification ceremony is per-account; multi-account P3-P6 lets one account hold multiple profiles. Should profile-A be able to present `age_over_18` while profile-B presents nothing, or are attributes always inherited? | Before V-M4 ships consent UX |
| Pulse–cire integration mechanism — see [[cire]] | ARC-token pull (Pulse fetches weddings from `cire/api` at feed time) vs push-on-publish (cire writes into `pulse/db` when a wedding goes live) | When Pulse surfaces cire weddings in its feed |
| vite 7→8 + Astro 6→7 upgrade | **Deferred — ecosystem beta-only (checked 2026-06-21).** vite 8 requires Astro 7, and `astro@7`, `@astrojs/cloudflare@14` (the gating one — `@cire/web` is a live SSR Worker), and `@astrojs/solid-js@7` are all `beta`/`alpha`-only on npm. Root override `"vite": "^7.3.5"` is the single lever holding the whole tree at vite 7; `@osn/social`/`@osn/ui`/`@pulse/app`/`@cire/organiser` already *declare* `vite@^8` in-manifest but are force-held down by it. Astro 7 also ships a Rust compiler default + Rolldown-powered vite 8 (esbuild→Oxc) — re-check the `esbuild`/`postcss` overrides + `cire/web` `astro.config.ts`/`middleware.ts` when upgrading. | When `astro@7`, `@astrojs/cloudflare@14`, `@astrojs/solid-js@7`, and an Astro-7 `@astrojs/check` are all on the `latest` dist-tag — then flip the override to `^8`, `bun install`, full `check`/`test`/`lint`/`build`, and a Cloudflare deploy-preview of the SSR Worker before relying on it |

### Decided this session (2026-06-18) — recorded, no longer open

- **Email provider → degraded-for-now.** osn-api ships with **no** Cloudflare Email Service creds and `OSN_EMAIL_OPTIONAL=true` (no-op transport). The provider choice (Resend / SendGrid / Postmark / SES at the Worker level) is parked until email is actually re-enabled — see [[email]]. Redis provider likewise **decided: Upstash** (`ap-southeast-2`, C-M18) — see [[redis]].
- **Production domain → `cireweddings.com`** (guest apex / `app.` / `api.` / `id.`; passkey RP ID `cireweddings.com`) — #149.
- **Maps approach → Google Maps Embed** (key-optional, CSS-card fallback) — #146.
- **WAF vs own rate limiter → keep the app limiter.** The Cloudflare Free WAF (1 rule, 10s window) can't replace the app's per-IP/per-user limiters; WAF is reserved for coarse edge defence. Free dashboard hardening steps documented in [[free-tier-limits]].
- **osn-api topology → single Worker** (split + service-bindings/Access "VPC" evaluated and **deferred**); osn-api runs as one Worker on `id.cireweddings.com`.
- **Cire test idiom** → unblocked by the Hono → Elysia migration (2026-06-12); cire follows the platform `it.effect` + `createTestLayer()` convention going forward.

---

## Future

### Phase 2: Polish
- [ ] Advanced discovery algorithms
- [ ] Venue pages with DJ schedules
- [ ] Recurring event management UI
- [ ] Calendar integration improvements
- [ ] Accessibility audit

### Phase 3: Expansion
- [ ] Social media platform (spec exists, implementation deferred)
- [ ] Android support
- [ ] Self-hosting capabilities
- [ ] Third-party API ecosystem
- [ ] Supabase migration (from SQLite)
- [ ] Verified Identity expansion to UK / EU / US (V-M6) — see [[verified-identity]]
