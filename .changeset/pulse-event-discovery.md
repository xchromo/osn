---
"@pulse/api": minor
"@pulse/app": minor
"@pulse/db": patch
---

Event discovery — unified "What's on" feed.

- New `GET /events/discover` route: filters on category, time window, bbox + haversine radius, price range (with currency), and friends-only. Cursor pagination on `(startTime, id)` with infinite scroll on both web + mobile.
- Friends filter is the union of events hosted by a connection and events RSVPed to by a connection. The RSVP branch LEFT-JOINs `pulse_users` and respects `attendance_visibility = "no_one"` (a user who hid their RSVPs never surfaces events via the friends signal; the viewer's own RSVP is excluded).
- Series-aware: discovery returns individual event occurrences only; the response includes a `series: Record<seriesId, { id, title }>` map so the Explore card can render a "Part of …" banner that links through to the event detail page.
- Visibility predicate extracted into a shared `buildVisibilityFilter` helper in `services/eventAccess.ts`. `listEvents` and `discoverEvents` both consume it — one source of truth keeps the S-H12..S-H16 regression class closed. As a side-effect, `listEvents` now also returns private events the viewer has an RSVP row on (was previously owner-only).
- DB: new indexes on `(visibility, start_time)` (replaces the single-column `events_visibility_idx`), `category`, and `(latitude, longitude)` to support discovery seeks + bbox prefilter.
- App: Explore page is now the unified discovery view (`from = now` default), with a `DiscoveryFilters` drawer for time/radius/price/friends. Existing chip rail translates into query params (e.g. "Tonight" → `to = endOfDay`, "Free" → `priceMax = 0`).
- Observability: `pulse.discovery.search` span + nested `pulse.discovery.friends_lookup`; new metrics in `pulse/api/src/metrics.ts` — `pulse.discovery.searched` (counter, bounded attrs), `pulse.discovery.search.duration` (histogram, seconds), `pulse.discovery.filters.applied` (counter per engaged dimension).

Follow-ups tracked in TODO.md: Pulse interest profile onboarding (unblocks the "interests" dimension), per-user preferred currency on `pulse_users`, server-side free-text search, and the AI prompt filter after extended scrolling.
