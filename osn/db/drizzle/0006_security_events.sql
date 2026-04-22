-- M-PK1b: out-of-band security event audit trail.
--
-- Captures account-level security actions (recovery-code regeneration today;
-- more kinds to follow) so the client can surface a dismissible banner on
-- behalf of the account holder. `kind` is a bounded string enum enforced at
-- the service layer, not the column, so expanding the taxonomy does not
-- require another migration.

CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer,
	`ip_hash` text,
	`ua_label` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `security_events_account_ack_idx` ON `security_events` (`account_id`, `acknowledged_at`);
