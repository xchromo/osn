import { Effect } from "effect";
import { DbLive, Db } from "./service";
import { events } from "./schema";

const seed = Effect.gen(function* () {
  const { db } = yield* Db;
  const now = new Date();

  const h = (n: number) => new Date(now.getTime() + n * 3_600_000);
  const d = (n: number) => new Date(now.getTime() + n * 86_400_000);

  yield* Effect.tryPromise(() =>
    db
      .insert(events)
      .values([
        // ── Finished ──────────────────────────────────────────────────────────
        {
          id: "evt_seed_finished1",
          title: "Jazz Night at the Cellar",
          description: "An intimate evening of live jazz across three sets.",
          location: "Lower East Side, New York",
          venue: "The Cellar Bar",
          category: "music",
          startTime: d(-3),
          endTime: new Date(d(-3).getTime() + 3 * 3_600_000),
          status: "finished",
          createdAt: now,
          updatedAt: now,
        },

        // ── Ongoing ───────────────────────────────────────────────────────────
        {
          id: "evt_seed_ongoing1",
          title: "Farmers Market – Spring Edition",
          description: "Local produce, street food, and live acoustic sets.",
          location: "Brooklyn, New York",
          venue: "Grand Army Plaza",
          category: "food",
          startTime: h(-2),
          endTime: h(4),
          status: "ongoing",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "evt_seed_ongoing2",
          title: "Open Source Hack Day",
          description: "All-day hacking session. Bring a laptop and a project idea.",
          location: "SOMA, San Francisco",
          venue: "Cloudflare HQ",
          category: "tech",
          startTime: h(-5),
          endTime: h(7),
          status: "ongoing",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "evt_seed_ongoing3",
          title: "Sunset Rooftop Yoga",
          description: "Vinyasa flow with panoramic city views as the sun goes down.",
          location: "Midtown, New York",
          venue: "The High Line Hotel",
          category: "wellness",
          startTime: new Date(now.getTime() - 45 * 60_000),
          endTime: new Date(now.getTime() + 75 * 60_000),
          status: "ongoing",
          createdAt: now,
          updatedAt: now,
        },

        // ── Upcoming ──────────────────────────────────────────────────────────
        {
          id: "evt_seed_upcoming1",
          title: "Bun + Effect.ts Workshop",
          description: "Hands-on workshop covering Bun internals and Effect service patterns.",
          location: "Tech District, San Francisco",
          venue: "Innovation Hub",
          category: "tech",
          startTime: d(2),
          endTime: new Date(d(2).getTime() + 3 * 3_600_000),
          status: "upcoming",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "evt_seed_upcoming2",
          title: "Community 5K Run",
          description: "A flat, friendly 5K through the park. All paces welcome.",
          location: "Golden Gate Park, San Francisco",
          venue: "Main Meadow",
          category: "fitness",
          startTime: d(5),
          endTime: new Date(d(5).getTime() + 2 * 3_600_000),
          status: "upcoming",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "evt_seed_upcoming3",
          title: "Rooftop Cocktail Mixer",
          description: "Meet founders, designers, and engineers over craft cocktails.",
          location: "Downtown, Los Angeles",
          venue: "Sky Lounge",
          category: "social",
          startTime: d(8),
          endTime: new Date(d(8).getTime() + 4 * 3_600_000),
          status: "upcoming",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "evt_seed_upcoming4",
          title: "Photography Walk – Street Portraits",
          description: "Guided street photography session with portfolio critique at the end.",
          location: "Williamsburg, Brooklyn",
          venue: "Starts at Bedford Ave L",
          category: "art",
          startTime: d(12),
          endTime: new Date(d(12).getTime() + 3 * 3_600_000),
          status: "upcoming",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "evt_seed_upcoming5",
          title: "Indie Film Screening: Short Cuts",
          description:
            "Curated selection of short films from emerging directors, followed by a Q&A.",
          location: "SoHo, New York",
          venue: "IFC Center",
          category: "film",
          startTime: d(18),
          endTime: new Date(d(18).getTime() + 2.5 * 3_600_000),
          status: "upcoming",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .onConflictDoNothing(),
  );

  console.log("Seed complete — 9 events inserted (existing seed rows skipped).");
}).pipe(Effect.provide(DbLive));

Effect.runPromise(seed).catch(console.error);
