---
"@pulse/api": minor
"@pulse/app": minor
"@pulse/db": minor
---

Add full event view: shareable `/events/:id` route with map preview, find-directions, RSVP section + modal (going / maybe / not going / invited), add-to-calendar (ICS), comms summary, and a Zap-bound chat placeholder.

New event configuration: `visibility` (public/private — controls discovery), `guestListVisibility` (public/connections/private), `joinPolicy` (open/guest_list), `allowInterested` (toggles "Maybe"), and `commsChannels` (sms/email). Each option in the create flow has an info popover.

New API surface on `@pulse/api`:

- `GET /events/:id/rsvps` / `/rsvps/latest` / `/rsvps/counts` — server-side visibility filtering using OSN's social graph (connections + close friends), with per-attendee privacy honoured (`attendanceVisibility` in `pulse_users`). Public-guest-list events override per-row privacy.
- `POST /events/:id/rsvps` (upsert own RSVP, enforces `joinPolicy` and `allowInterested`)
- `POST /events/:id/invite` (organiser-only, bulk invite)
- `GET /events/:id/ics` (RFC 5545 calendar export)
- `GET /events/:id/comms` and `POST /events/:id/comms/blasts` (organiser-only blast log; SMS/email send is stubbed pending real providers)
- `PATCH /me/settings` (Pulse-side `attendanceVisibility`: `connections` | `close_friends` | `no_one`)

New `@pulse/db` tables: `pulse_users` (Pulse-side user settings, keyed by OSN user id) and `event_comms` (append-only blast log). `events` gains `visibility`, `guestListVisibility`, `joinPolicy`, `allowInterested`, `commsChannels`. `event_rsvps` gains `"invited"` status and `invitedByUserId`.

`listEvents` now hides `visibility = "private"` events from non-owners — a behaviour change for the discovery feed.

`@pulse/api` now imports `@osn/core` + `@osn/db` directly (the first cross-package consumer of OSN's social graph). The bridge is isolated in `services/graphBridge.ts` so the eventual ARC-token HTTP migration is local to that file.
