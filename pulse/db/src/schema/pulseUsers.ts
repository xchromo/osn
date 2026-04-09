import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Pulse-specific user configuration, keyed by the OSN user id.
 *
 * Kept in `pulse/db` (not `osn/db`) so that identity data (name, email, etc.)
 * stays owned by OSN and app-specific preferences live alongside the app's
 * own data. No foreign key — the `userId` references `osn_db.users.id`
 * across a cross-DB boundary.
 *
 * Rows are created lazily on first Pulse write (RSVP, event creation, or
 * explicit settings update). Readers fall back to defaults when no row exists.
 */
export const pulseUsers = sqliteTable("pulse_users", {
  userId: text("user_id").primaryKey(),
  // "connections" → visible to the user's connections (default)
  // "no_one"      → hidden from everyone on Pulse
  //
  // A "close_friends" option previously existed but was removed: close-
  // friend visibility is a one-way graph edge, so marking someone as a
  // close friend would leak your attendance to them regardless of
  // whether they considered you one. Close-friends are now used only
  // to surface friendly attendees first when rendering the guest list
  // (see `RsvpAvatar` + `listRsvps` sort), never as a gate.
  //
  // Public-guest-list events override this setting: by attending such an
  // event the user implicitly accepts their RSVP is visible to anyone who
  // can see the event. Enforcement lives in `pulse/api/src/services/rsvps.ts`.
  attendanceVisibility: text("attendance_visibility", {
    enum: ["connections", "no_one"],
  })
    .notNull()
    .default("connections"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type PulseUser = typeof pulseUsers.$inferSelect;
export type NewPulseUser = typeof pulseUsers.$inferInsert;
