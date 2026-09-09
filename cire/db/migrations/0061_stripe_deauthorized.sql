-- A couple revoking cire's access from their own Stripe dashboard.
--
-- Stripe announces it once, as `account.application.deauthorized`, and after it
-- the platform cannot act on that account at all: no charge, no account link,
-- no capability read. The webhook clears `stripe_account_id` when it lands, so
-- the guest contribute button disarms (the guest gate needs an account AND
-- `stripe_charges_enabled`) and a reconnect can mint a fresh account — the
-- attach path only ever fills a NULL id, so a stale one would wedge the couple
-- on a dead account for good.
--
-- These two columns are what the cleared id leaves behind. Nothing reads them;
-- they are the audit trail for "which account did this wedding's gifts settle
-- into", which has no other answer once the id is gone.
ALTER TABLE `registry_settings` ADD `stripe_deauthorized_at` integer;--> statement-breakpoint
ALTER TABLE `registry_settings` ADD `stripe_deauthorized_account_id` text;
