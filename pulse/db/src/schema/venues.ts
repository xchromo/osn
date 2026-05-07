import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

/**
 * Venue — a physical place that hosts events. Currently scoped to clubs
 * (the first surface to use this), but the shape is generic enough to
 * extend to other venue types.
 *
 * Slug-keyed because the venue page is a public, shareable URL
 * (`/venues/:slug`) — opaque ids would surface in every link. The slug
 * is also the primary key to avoid a second index for slug lookups.
 *
 * Hours are stored as JSON keyed by ISO weekday number ("1".."7", Mon=1)
 * for compactness. The frontend parses + renders. Free-form null when
 * the venue has irregular / event-driven hours.
 */
export const venues = sqliteTable(
  "venues",
  {
    /** URL-safe slug, e.g. "the-pickle-factory". Doubles as the route param. */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** "club" | "bar" | "warehouse" | …. Free-form for now; bucket at metric time. */
    kind: text("kind").notNull().default("club"),
    description: text("description"),
    address: text("address"),
    city: text("city"),
    country: text("country"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    /** Standing capacity (null = unknown / variable). */
    capacity: integer("capacity"),
    /**
     * JSON-encoded hours map keyed by ISO weekday ("1".."7", Mon=1).
     * Each value is `{ open: "HH:MM", close: "HH:MM" }` in the venue's
     * local time, or `null` for "closed". Null on the column means the
     * venue has no fixed schedule (event-driven).
     */
    hours: text("hours"),
    heroImageUrl: text("hero_image_url"),
    websiteUrl: text("website_url"),
    instagramHandle: text("instagram_handle"),
    /** IANA timezone (e.g. "Europe/London"). Lineup slot times render in this zone. */
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("venues_kind_idx").on(t.kind),
    // Reuse the events bbox pattern — same JS-haversine prefilter when we
    // surface "venues near me".
    index("venues_lat_lng_idx").on(t.latitude, t.longitude),
  ],
);

export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
