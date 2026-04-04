import { Elysia, t } from "elysia";
import { Effect, type Layer } from "effect";
import { jwtVerify } from "jose";
import { DbLive, type Db } from "@pulse/db/service";
import {
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  listTodayEvents,
  updateEvent,
} from "../services/events";

const statusEnum = t.Optional(
  t.Union([
    t.Literal("upcoming"),
    t.Literal("ongoing"),
    t.Literal("finished"),
    t.Literal("cancelled"),
  ]),
);

/** Extracts the JWT sub claim from a Bearer token. Returns null on any failure. */
async function extractUserId(
  authHeader: string | undefined,
  secret: Uint8Array,
): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authHeader.slice(7), secret);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const DEFAULT_JWT_SECRET = process.env.OSN_JWT_SECRET ?? "dev-secret-change-in-prod";

export const createEventsRoutes = (
  dbLayer: Layer.Layer<Db> = DbLive,
  jwtSecret: string = DEFAULT_JWT_SECRET,
) => {
  const secretBytes = new TextEncoder().encode(jwtSecret);

  return new Elysia({ prefix: "/events" })
    .get(
      "/",
      async ({ query }) => {
        const result = await Effect.runPromise(listEvents(query).pipe(Effect.provide(dbLayer)));
        return { events: result };
      },
      {
        query: t.Object({
          status: statusEnum,
          category: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      },
    )
    .get("/today", async () => {
      const result = await Effect.runPromise(listTodayEvents.pipe(Effect.provide(dbLayer)));
      return { events: result };
    })
    .get(
      "/:id",
      async ({ params, set }) => {
        const result = await Effect.runPromise(
          getEvent(params.id).pipe(
            Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
            Effect.provide(dbLayer),
          ),
        );
        if (result === null) {
          set.status = 404;
          return { message: "Event not found" };
        }
        return { event: result };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      },
    )
    .post(
      "/",
      async ({ body, headers, set }) => {
        const userId = await extractUserId(headers["authorization"], secretBytes);
        if (!userId) {
          set.status = 401;
          return { message: "Unauthorized" } as const;
        }
        const creator = {
          createdByUserId: userId,
          createdByName: body.createdByName ?? null,
          createdByAvatar: body.createdByAvatar ?? null,
        };
        const result = await Effect.runPromise(
          createEvent(body, creator).pipe(
            Effect.catchTag("ValidationError", (e) =>
              Effect.sync(() => {
                set.status = 422;
                return { error: String(e.cause) } as const;
              }),
            ),
            Effect.provide(dbLayer),
          ),
        );
        if ("error" in result) return result;
        set.status = 201;
        return { event: result };
      },
      {
        body: t.Object({
          title: t.String(),
          description: t.Optional(t.String()),
          location: t.Optional(t.String()),
          venue: t.Optional(t.String()),
          latitude: t.Optional(t.Number({ minimum: -90, maximum: 90 })),
          longitude: t.Optional(t.Number({ minimum: -180, maximum: 180 })),
          category: t.Optional(t.String()),
          startTime: t.String({ format: "date-time" }),
          endTime: t.Optional(t.String({ format: "date-time" })),
          status: statusEnum,
          imageUrl: t.Optional(t.String()),
          createdByName: t.Optional(t.String()),
          createdByAvatar: t.Optional(t.String()),
        }),
      },
    )
    .patch(
      "/:id",
      async ({ params, body, headers, set }) => {
        const userId = await extractUserId(headers["authorization"], secretBytes);
        const result = await Effect.runPromise(
          updateEvent(params.id, body, userId).pipe(
            Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
            Effect.catchTag("NotEventOwner", () =>
              Effect.sync(() => {
                set.status = 403;
                return { message: "Forbidden" } as const;
              }),
            ),
            Effect.catchTag("ValidationError", (e) =>
              Effect.sync(() => {
                set.status = 422;
                return { error: String(e.cause) } as const;
              }),
            ),
            Effect.provide(dbLayer),
          ),
        );
        if (result === null) {
          set.status = 404;
          return { message: "Event not found" };
        }
        if ("error" in result) return result;
        if ("message" in result) return result;
        return { event: result };
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          title: t.Optional(t.String()),
          description: t.Optional(t.String()),
          location: t.Optional(t.String()),
          venue: t.Optional(t.String()),
          latitude: t.Optional(t.Number({ minimum: -90, maximum: 90 })),
          longitude: t.Optional(t.Number({ minimum: -180, maximum: 180 })),
          category: t.Optional(t.String()),
          startTime: t.Optional(t.String({ format: "date-time" })),
          endTime: t.Optional(t.String({ format: "date-time" })),
          status: statusEnum,
          imageUrl: t.Optional(t.String()),
        }),
      },
    )
    .delete(
      "/:id",
      async ({ params, headers, set }) => {
        const userId = await extractUserId(headers["authorization"], secretBytes);
        const result = await Effect.runPromise(
          deleteEvent(params.id, userId).pipe(
            Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
            Effect.catchTag("NotEventOwner", () =>
              Effect.sync(() => {
                set.status = 403;
                return { message: "Forbidden" } as const;
              }),
            ),
            Effect.provide(dbLayer),
          ),
        );
        if (result === null) {
          set.status = 404;
          return { message: "Event not found" };
        }
        if (result != null && "message" in result) return result;
        set.status = 204;
        return null;
      },
      {
        params: t.Object({ id: t.String() }),
      },
    );
};

export const eventsRoutes = createEventsRoutes();
