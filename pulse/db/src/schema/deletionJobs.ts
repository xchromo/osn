import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Per-profile soft-delete tombstones for "leave Pulse" (Flow B of C-H2).
 *
 * Independent from osn-api's `deletion_jobs` table (which tracks full-account
 * OSN-level erasure). A user can be in this table without being deleted from
 * OSN — they're just leaving Pulse — and a full OSN-level delete will create
 * a row here only via the cross-service ARC fan-out (treated as a Pulse
 * leave-app event under the hood).
 *
 * Lifecycle:
 *   1. Soft-delete: insert row, set Pulse data to scheduled-deletion state
 *      (rsvps + close-friends + comms hard-deleted; hosted events flipped
 *      to `cancelled_at` with a 14-day public-cancellation window;
 *      `pulse_users` deleted).
 *   2. After `hard_delete_at`, the sweeper purges any residual rows tied
 *      to this profile and removes the deletion_jobs row.
 *
 * `enrollment_notify_done_at` tracks the ARC callback to osn-api flipping
 * `app_enrollments.left_at`. NULL = retry pending (sweeper handles).
 */
export const pulseDeletionJobs = sqliteTable(
  "pulse_deletion_jobs",
  {
    /** PK = profileId — one in-flight Pulse deletion per profile. */
    profileId: text("profile_id").primaryKey(),
    /** Cross-DB ref to osn-db accounts.id (no FK). Used to call back to osn-api. */
    accountId: text("account_id").notNull(),
    /** Unix seconds. */
    softDeletedAt: integer("soft_deleted_at").notNull(),
    /** Unix seconds. softDeletedAt + 7 days. */
    hardDeleteAt: integer("hard_delete_at").notNull(),
    /** Unix seconds. Set when osn-api confirms `app_enrollments.left_at` flip. */
    enrollmentNotifyDoneAt: integer("enrollment_notify_done_at"),
    /** "user_request" | "osn_account_delete" | "admin". */
    reason: text("reason").notNull().default("user_request"),
  },
  (t) => [
    index("pulse_deletion_jobs_hard_delete_idx").on(t.hardDeleteAt),
    index("pulse_deletion_jobs_account_idx").on(t.accountId),
  ],
);

export type PulseDeletionJob = typeof pulseDeletionJobs.$inferSelect;
export type NewPulseDeletionJob = typeof pulseDeletionJobs.$inferInsert;
