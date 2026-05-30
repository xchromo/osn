import { DbLive, type Db } from "@pulse/db/service";
import { Effect, Layer } from "effect";
import { Elysia, t } from "elysia";

import { getVenue, listAllVenues, listEventLineup, listVenueEvents } from "../services/venues";

/**
 * Venue surface routes.
 *
 * `GET /venues/:orgHandle/:venueHandle` — venue metadata (public).
 * `GET /venues/:orgHandle/:venueHandle/events` — programme list.
 * `GET /venues/:orgHandle/:venueHandle/events/:eventId/lineup` —
 *   programmed lineup for one of this venue's events.
 *
 * Sub-routing the lineup under the venue (rather than `/events/:id/lineup`)
 * keeps the venue page on a single origin and gives us venue-existence
 * gating on the lineup surface for free.
 */
export const createVenuesRoutes = (
  dbLayer: Layer.Layer<Db> = DbLive,
  // Auth params kept for symmetry with sibling route factories — venue
  // surfaces are public so we don't currently extract claims.
  _jwksUrl: string = "",
  _testKey?: CryptoKey,
) => {
  return new Elysia({ prefix: "/venues" })
    .get("/", async () => {
      // TODO(venue-bbox-search): swap for bbox-filtered query — see
      // wiki/TODO.md → Performance Backlog P-W6 (explore).
      const venues = await Effect.runPromise(listAllVenues().pipe(Effect.provide(dbLayer)));
      return { venues };
    })
    .get(
      "/:orgHandle/:venueHandle",
      async ({ params, set }) => {
        const venue = await Effect.runPromise(
          getVenue(params.orgHandle, params.venueHandle).pipe(
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
      { params: t.Object({ orgHandle: t.String(), venueHandle: t.String() }) },
    )
    .get(
      "/:orgHandle/:venueHandle/events",
      async ({ params, query, set }) => {
        const result = await Effect.runPromise(
          listVenueEvents(params.orgHandle, params.venueHandle, {
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
        params: t.Object({ orgHandle: t.String(), venueHandle: t.String() }),
        query: t.Object({
          scope: t.Optional(t.Union([t.Literal("upcoming"), t.Literal("past"), t.Literal("all")])),
          limit: t.Optional(t.String()),
        }),
      },
    )
    .get(
      "/:orgHandle/:venueHandle/events/:eventId/lineup",
      async ({ params, set }) => {
        // Confirm the venue exists first so a wrong handle returns 404
        // even when an attacker guesses a real eventId.
        const venue = await Effect.runPromise(
          getVenue(params.orgHandle, params.venueHandle).pipe(
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
      {
        params: t.Object({
          orgHandle: t.String(),
          venueHandle: t.String(),
          eventId: t.String(),
        }),
      },
    );
};

export const venuesRoutes = createVenuesRoutes();
