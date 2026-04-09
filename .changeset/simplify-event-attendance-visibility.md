---
"@pulse/api": minor
"@pulse/db": minor
"@pulse/app": minor
---

Simplify event attendance visibility to `connections | no_one`.

The previous `"close_friends"` bucket was removed. Close-friendship is a
one-way graph edge, so marking someone as a close friend would leak your
attendance to them regardless of whether they reciprocated. Close-friends
are now purely a display signal: friendly attendees are surfaced first in
`listRsvps` (via the existing `isCloseFriend` row flag) and keep the green
ring affordance in `RsvpAvatar`, but they no longer gate access.

- `pulse_users.attendance_visibility` Drizzle enum narrowed to
  `"connections" | "no_one"`.
- `PATCH /me/settings` TypeBox body now rejects `"close_friends"` with 422.
- `filterByAttendeePrivacy` drops the `"close_friends"` switch arm.
- `listRsvps` fetches up to 200 rows then sorts close-friend rows to the
  top (stable sort preserves createdAt DESC within each bucket) before
  slicing to the caller's requested limit, so even the 5-row inline strip
  reliably surfaces close friends when any exist.
- Legacy `"close_friends"` values still on disk are coerced back to the
  default `"connections"` on read — no data migration required.
- Settings page drops the "Close friends only" radio option.
