import { DbLive, type Db } from "@pulse/db/service";
import { Effect, Layer } from "effect";
import { Elysia, t } from "elysia";

import { getVenue, listEventLineup, listVenueEvents } from "../services/venues";

/**
 * Venue surface routes.
 *
 * `GET /venues/:id` — venue metadata (public).
 * `GET /venues/:id/events` — programme list (public events at this venue).
 * `GET /events/:id/lineup` is intentionally NOT mounted here; we add the
 * lineup endpoint as a sub-route of the venue programme so the venue
 * page only needs one origin for its data, and sibling features (e.g.
 * the Explore card) don't accidentally couple to the lineup surface yet.
 */
export const createVenuesRoutes = (
  dbLayer: Layer.Layer<Db> = DbLive,
  // Auth params kept for symmetry with sibling route factories — venue
  // surfaces are public so we don't currently extract claims.
  _jwksUrl: string = "",
  _testKey?: CryptoKey,
) => {
  return new Elysia({ prefix: "/venues" })
    .get(
      "/:id",
      async ({ params, set }) => {
        const venue = await Effect.runPromise(
          getVenue(params.id).pipe(
            Effect.catchTag("VenueNotFound", () => Effect.succeed(null)),
            Effect.provide(dbLayer),
          ),
        );
        if (venue === null) {
          set.status = 404;
          return { message: "Venue not found" } as const;
        }
        return { venue };
      },
      { params: t.Object({ id: t.String() }) },
    )
    .get(
      "/:id/events",
      async ({ params, query, set }) => {
        const result = await Effect.runPromise(
          listVenueEvents(params.id, {
            scope: query.scope ?? "upcoming",
            limit: query.limit ? Number(query.limit) : undefined,
          }).pipe(
            Effect.catchTag("VenueNotFound", () => Effect.succeed(null)),
            Effect.provide(dbLayer),
          ),
        );
        if (result === null) {
          set.status = 404;
          return { message: "Venue not found" } as const;
        }
        return { events: result };
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({
          scope: t.Optional(t.Union([t.Literal("upcoming"), t.Literal("past"), t.Literal("all")])),
          limit: t.Optional(t.String()),
        }),
      },
    )
    .get(
      "/:id/events/:eventId/lineup",
      async ({ params, set }) => {
        // Confirm the venue exists first so a wrong slug returns 404
        // even when an attacker guesses a real eventId.
        const venue = await Effect.runPromise(
          getVenue(params.id).pipe(
            Effect.catchTag("VenueNotFound", () => Effect.succeed(null)),
            Effect.provide(dbLayer),
          ),
        );
        if (venue === null) {
          set.status = 404;
          return { message: "Venue not found" } as const;
        }
        const slots = await Effect.runPromise(
          listEventLineup(params.eventId).pipe(Effect.provide(dbLayer)),
        );
        return { slots };
      },
      { params: t.Object({ id: t.String(), eventId: t.String() }) },
    );
};

export const venuesRoutes = createVenuesRoutes();
