---
"@cire/api": minor
"@cire/db": minor
"@cire/organiser": minor
---

Wedding profile + Settings tab (platform Phase 0, PR 1): organisers record the
planning facts — date, location, expected guests, currency, and total budget —
that the upcoming planning modules (checklist lead times, pricing estimates,
vendor radius search) build on. Nothing here is guest-facing.

- `@cire/db`: migration `0030_wedding_profile.sql` adds `wedding_date`,
  `location_name`, `location_lat`/`location_lng`, `pricing_region`,
  `guest_count_estimate`, `currency` (`NOT NULL DEFAULT 'AUD'`), and
  `budget_total_minor` (integer minor units) to `weddings`. All nullable /
  defaulted — additive + self-backfilling, mirrored across the three DDL
  surfaces under the T-S1 lockstep test.
- `@cire/api`: `GET /api/organiser/weddings/:weddingId/settings` (owner or
  co-host) + `PUT …/settings` (owner-only; PATCH semantics — omitted fields
  keep their value, explicit `null` clears; slug renames validated with 409 on
  collision) + `POST …/settings/geocode` (owner-only, per-IP rate-limited).
  Geocoding is **key-optional + fail-soft**: with no `GOOGLE_GEOCODING_API_KEY`
  secret (or on any upstream failure) the endpoint answers `unavailable`, the
  form degrades to manual lat/lng entry, and nothing is sent to Google.
  `pricing_region` is a closed, state-granular enum in `lib/pricing-regions.ts`
  (single source of truth for the Phase 3 pricing dataset), derived server-side
  from the geocoded state/country. New metrics `cire.wedding.settings.saved` +
  `cire.geocode.requests`.
- `@cire/organiser`: a "Settings" tab on each wedding's dashboard — name,
  invite-link slug (with a breaks-shared-links warning), date, location with
  server-side "Look up" (or manual coordinates when geocoding is off), region,
  guest count, currency, and budget. Co-hosts see it read-only; a saved rename
  updates the header + wedding list without a refetch.
