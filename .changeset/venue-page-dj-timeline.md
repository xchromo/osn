---
"@pulse/db": minor
"@pulse/api": minor
"@pulse/app": minor
---

Add a venue detail page (initially scoped to clubs) with venue
information, a programmed lineup timeline for the next night, and a
carousel of upcoming events at the venue.

- New `venues` and `event_lineup` tables, plus a nullable `events.venue_id`
  FK so existing free-text venues keep working until backfill.
- New `GET /venues/:id`, `GET /venues/:id/events`, and
  `GET /venues/:id/events/:eventId/lineup` routes wired through Effect
  services with `pulse.venue.*` spans + `pulse.venue.detail.*` /
  `pulse.venue.events.listed` / `pulse.venue.lineup.listed` metrics.
- New `VenueDetailPage` at `/venues/:id` with a vertical mono-time
  timeline component (centrepiece) and a snap-scrolling event carousel
  with prev/next chevrons. Discovery surfaces linking into the page are
  intentionally deferred.
