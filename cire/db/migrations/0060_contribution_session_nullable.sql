-- 0060_contribution_session_nullable.sql — the row exists before Stripe does.
--
-- Until now the contribution row was written only AFTER Stripe handed back a
-- Checkout session, because `stripe_checkout_session_id` was NOT NULL and there
-- was nothing to put in it before the call. That ordering means the only record
-- of a gift attempt lives at Stripe until our own insert lands: if the Worker is
-- evicted between the two, a session exists that we have never heard of, and
-- the settle webhook arrives naming a row that does not exist (osn-tracker
-- #528).
--
-- Making the column NULLABLE lets the route mint the row first, hand Stripe the
-- id as `client_reference_id`, and attach the session afterwards. A row with a
-- NULL session is an attempt that never reached Stripe — closed by the failure
-- path, ignored by the reuse lookup, and adopted by settle/expire when the
-- webhook names it.
--
-- The UNIQUE stays, and stays PLAIN rather than partial: SQLite counts NULLs as
-- distinct in a unique index, so many session-less attempts coexist while every
-- real session id is still claimed by exactly one row. (A partial index would
-- also read as drift to `ddl-lockstep.test.ts`, which records a column-level
-- UNIQUE with `where: null`.)
--
-- SQLite cannot drop a NOT NULL in place, so this is a table REBUILD via the
-- create-copy-drop-rename idiom. `registry_contributions` is a LEAF — nothing
-- holds a foreign key INTO it — so no `__keep_*` snapshots are needed; the DROP
-- cascades nowhere. Column order is copied verbatim from 0057 so `table_info`
-- still matches. Forward-only: there is no down migration.
CREATE TABLE `__new_registry_contributions` (
  `id` text PRIMARY KEY NOT NULL,
  `wedding_id` text NOT NULL REFERENCES `weddings`(`id`) ON DELETE CASCADE,
  `item_id` text REFERENCES `registry_items`(`id`) ON DELETE SET NULL,
  `family_id` text NOT NULL REFERENCES `families`(`id`) ON DELETE CASCADE,
  `status` text DEFAULT 'pending' NOT NULL,
  `amount_minor` integer NOT NULL,
  `currency` text NOT NULL,
  `primary_amount_minor` integer,
  `primary_currency` text,
  `fx_rate` text,
  `fx_rate_at` integer,
  `stripe_checkout_session_id` text UNIQUE,
  `stripe_payment_intent_id` text,
  `message` text,
  `display_name` text,
  `thanked_at` integer,
  `thanked_by` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);--> statement-breakpoint
-- Every row VERBATIM, ids preserved.
INSERT INTO `__new_registry_contributions` (`id`, `wedding_id`, `item_id`, `family_id`, `status`, `amount_minor`, `currency`, `primary_amount_minor`, `primary_currency`, `fx_rate`, `fx_rate_at`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `message`, `display_name`, `thanked_at`, `thanked_by`, `created_at`, `updated_at`)
SELECT `id`, `wedding_id`, `item_id`, `family_id`, `status`, `amount_minor`, `currency`, `primary_amount_minor`, `primary_currency`, `fx_rate`, `fx_rate_at`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `message`, `display_name`, `thanked_at`, `thanked_by`, `created_at`, `updated_at` FROM `registry_contributions`;--> statement-breakpoint
DROP TABLE `registry_contributions`;--> statement-breakpoint
ALTER TABLE `__new_registry_contributions` RENAME TO `registry_contributions`;--> statement-breakpoint
CREATE INDEX `registry_contributions_wedding_created_idx` ON `registry_contributions` (`wedding_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `registry_contributions_item_idx` ON `registry_contributions` (`item_id`);--> statement-breakpoint
-- Recreated from 0059: a refund event names a payment intent and nothing else.
CREATE INDEX `registry_contributions_payment_intent_idx` ON `registry_contributions` (`stripe_payment_intent_id`);
