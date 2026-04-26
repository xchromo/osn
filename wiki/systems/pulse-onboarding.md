---
title: Pulse Onboarding
tags: [systems, pulse, onboarding]
related:
  - "[[pulse]]"
  - "[[identity-model]]"
  - "[[arc-tokens]]"
  - "[[component-library]]"
last-reviewed: 2026-04-26
---

# Pulse Onboarding

First-run flow shown to a user the first time they open Pulse with an account that has not previously completed onboarding. Six-step linear stepper with themed illustrations matching `pulse/DESIGN.md`.

## State machine

| Step | Screen | Captures |
|------|--------|----------|
| 1 | Welcome | — |
| 2 | What Pulse is | — |
| 3 | Pick interests (≤ 8) | `interests` |
| 4 | Location permission | `locationPerm` |
| 5 | Notifications permission + reminders opt-in | `notificationsPerm`, `notificationsOptIn`, `eventRemindersOptIn` |
| 6 | Finish (POST /complete) | — (writes captured state) |

## Identity keying — account, not profile

Onboarding state is keyed by **OSN accountId**, not by the JWT-asserted profileId. A user with two profiles on the same account onboards once.

The `accountId` privacy invariant in `[[identity-model]]` rules out putting accountId on the access token (see `osn/api/tests/privacy.test.ts` — explicitly tests that JWTs and API responses never carry it). So Pulse resolves it server-side via ARC:

```
JWT.profileId
  → pulse_profile_accounts cache
  → (cache miss) → ARC GET /graph/internal/profile-account?profileId= → osn/api
  → upsert mapping → return accountId
```

The mapping is immutable from Pulse's perspective (OSN does not move profiles between accounts), so a cache hit is authoritative — no staleness handling needed.

## Schema (Pulse)

Both tables are additive, defined in `pulse/db/src/schema/onboarding.ts`:

```sql
pulse_account_onboarding (
  account_id TEXT PRIMARY KEY,
  completed_at INTEGER NOT NULL,
  interests TEXT NOT NULL DEFAULT '[]',  -- JSON-encoded string[]
  notifications_opt_in INTEGER NOT NULL DEFAULT 0,
  event_reminders_opt_in INTEGER NOT NULL DEFAULT 0,
  notifications_perm TEXT NOT NULL DEFAULT 'prompt',  -- granted|denied|prompt|unsupported
  location_perm TEXT NOT NULL DEFAULT 'prompt'
);

pulse_profile_accounts (
  profile_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  INDEX (account_id)
);
```

Migration: `pulse/db/drizzle/0004_pulse_onboarding.sql`.

**Why a JSON column for interests**: cheapest path for SQLite under the current load. If interests grow into joined queries (e.g. "show me events in categories my friends like"), migrate to a `pulse_user_interests(account_id, category)` join table.

## OSN endpoint

`GET /graph/internal/profile-account?profileId=` → `{ accountId }` or 404.

ARC-protected (`graph:read` scope, audience `osn-api`) — the pattern matches the existing internal-graph endpoints. Defined in `osn/api/src/routes/graph-internal.ts`.

## Pulse endpoints

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|------------|-------|
| GET | `/me/onboarding` | Bearer (user access token) | — | Returns `{ completedAt, interests, *_opt_in, *_perm }`. Sets `Cache-Control: private, max-age=30`. Defaults when no row exists. |
| POST | `/me/onboarding/complete` | Bearer | 10 / 5 min per IP | Idempotent — second call returns the original `completedAt` without overwriting captured prefs. Validates payload with Effect Schema (≤ 8 interests, closed-set categories + perm outcomes). |

**Privacy**: response shapes never carry accountId. Tested explicitly in `pulse/api/tests/routes/onboarding.test.ts`.

## Frontend

- Route: `/welcome` (`pulse/app/src/pages/WelcomePage.tsx`), lazy-loaded.
- Stepper: `pulse/app/src/pages/onboarding/OnboardingStepper.tsx` — owns step index + captured state, calls `/complete` on finish.
- Step components: `Step1Welcome` … `Step6Finish` — one file per step, each composes the shared `StepShell`.
- First-run gate: `OnboardingGate` in `pulse/app/src/App.tsx` — fetches status when an access token is available; if `completedAt === null` and the user isn't on `/welcome` and hasn't skipped this session, redirects to `/welcome`.
- Skip-this-session: backed by `sessionStorage` so a tab that lands on the home feed after skip doesn't re-loop the redirect. Server-side state stays "not completed" so the next session re-prompts.

## Themed illustrations

Six SVGs in `pulse/app/src/assets/onboarding/`:

| File | Step | Token usage |
|------|------|-------------|
| `welcome-pulse.svg` | 1 | `--pulse-accent`, `--pulse-accent-soft`, `--pulse-accent-strong` (concentric pulse rings, CSS-animated) |
| `value-map.svg` | 2 | `--pulse-accent`, `--pulse-accent-strong`, `--card`, `currentColor` (city blocks, river, heat blob, three coloured pins) |
| `interests-glyphs.svg` | 3 | `--pulse-accent`, `--pulse-accent-strong`, `--pulse-accent-soft` (Instrument Serif glyph constellation; chips render their own glyphs via `CategoryGlyph.tsx`) |
| `location-pin.svg` | 4 | `--pulse-accent`, `--pulse-accent-strong`, `--pulse-accent-fg`, `currentColor` (map vignette, animated pin drop + ring) |
| `notifications-ember.svg` | 5 | `--pulse-accent`, `--pulse-accent-soft`, `--pulse-accent-strong`, `--pulse-accent-fg` (folded coral envelope + radiating rings) |
| Finish date stamp | 6 | Inline JSX in `Step6Finish.tsx` (today's date driven by `Date` API) — same vocabulary as the Event Card date stamp in `pulse/DESIGN.md` |

Per-category glyphs live as inline JSX paths in `CategoryGlyph.tsx` — single import, recolour via `currentColor` from the chip's `aria-pressed` state.

**Motion budget**: CSS keyframes only (no Lottie/Rive). Pulse rings, ember rings, pin drop, step transitions. Honours `prefers-reduced-motion` — infinite ring animations collapse to a still frame.

## Observability

| Metric | Type | Attributes |
|--------|------|-----------|
| `pulse.onboarding.status.fetched` | counter | `completed: "true" \| "false"` |
| `pulse.onboarding.completed` | counter | `result`, `notifications_opt_in`, `event_reminders_opt_in`, `notifications_perm`, `location_perm`, `interests_bucket` (`"0" \| "1-3" \| "4-6" \| "7-8"`) |
| `pulse.onboarding.interests.selected` | histogram | (none — bucket 0…8) |
| `pulse.onboarding.profile_account.resolved` | counter | `source: "cache" \| "bridge"`, `result` |

All attribute types are bounded string-literal unions (no profileId / accountId / requestId — those go on spans).

| Span | Function |
|------|----------|
| `pulse.onboarding.profile_account.resolve` | `resolveAccountId` |
| `pulse.onboarding.status.get` | `getOnboardingStatus` |
| `pulse.onboarding.complete` | `completeOnboarding` |

`Effect.logError` on database failures in `completeOnboarding`. No `console.*` calls. No new redaction fields needed (payload contains no PII / secrets).

## Future extensions

- Native Tauri permission plugins (`@tauri-apps/plugin-geolocation`, `@tauri-apps/plugin-notification`) for first-class iOS/Android prompts. Currently uses the standard browser APIs which work in WKWebView/Android WebView but route through the JS layer.
- Settings page surface for revisiting captured prefs (interests, reminder opt-in). The service already has `updateOnboardingPrefs` shape sketched out; it just needs a route + UI.
- Friend-suggestion step (post-step-3) once OSN exposes a "people on Pulse you may know" recommendation feed.
