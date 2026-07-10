-- Wedding profile (platform Phase 0, PR 1): organiser-provided planning facts
-- on the `weddings` root. Nothing here is guest-facing — the profile drives the
-- planning modules (vendor radius search, pricing estimates, checklist
-- lead-time seeding), never the invite render.
--   wedding_date          date-only ISO string (YYYY-MM-DD); nullable — engaged
--                         couples often don't have one yet
--   location_name         free-text venue/locality as the organiser typed it
--   location_lat/lng      canonical point for vendor radius search; set by the
--                         key-optional server-side geocode, or typed manually
--   pricing_region        key into the checked-in pricing dataset (closed enum
--                         validated at the API boundary — lib/pricing-regions.ts)
--   guest_count_estimate  rough head count for estimates
--   currency              ISO 4217 code for every money figure on this wedding;
--                         NOT NULL DEFAULT so existing rows land on AUD
--   budget_total_minor    total budget in MINOR units (cents) of `currency`
ALTER TABLE `weddings` ADD `wedding_date` text;--> statement-breakpoint
ALTER TABLE `weddings` ADD `location_name` text;--> statement-breakpoint
ALTER TABLE `weddings` ADD `location_lat` real;--> statement-breakpoint
ALTER TABLE `weddings` ADD `location_lng` real;--> statement-breakpoint
ALTER TABLE `weddings` ADD `pricing_region` text;--> statement-breakpoint
ALTER TABLE `weddings` ADD `guest_count_estimate` integer;--> statement-breakpoint
ALTER TABLE `weddings` ADD `currency` text NOT NULL DEFAULT 'AUD';--> statement-breakpoint
ALTER TABLE `weddings` ADD `budget_total_minor` integer;
