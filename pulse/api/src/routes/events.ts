import { Elysia, t } from "elysia";
import { Effect, Layer } from "effect";
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
import {
  inviteGuests,
  latestRsvps,
  listRsvps,
  rsvpCounts,
  upsertRsvp,
  type RsvpWithUser,
} from "../services/rsvps";
import { listBlasts, parseCommsChannels, sendBlast } from "../services/comms";
import { buildIcs } from "../services/calendar";
import { updateSettings } from "../services/pulseUsers";
import { OsnDb, OsnDbLayer } from "../services/graphBridge";

const visibilityEnum = t.Optional(t.Union([t.Literal("public"), t.Literal("private")]));
const guestListVisibilityEnum = t.Optional(
  t.Union([t.Literal("public"), t.Literal("connections"), t.Literal("private")]),
);
const joinPolicyEnum = t.Optional(t.Union([t.Literal("open"), t.Literal("guest_list")]));
const commsChannelsSchema = t.Optional(
  t.Array(t.Union([t.Literal("sms"), t.Literal("email")]), { minItems: 1, maxItems: 2 }),
);
const rsvpStatusEnum = t.Union([
  t.Literal("going"),
  t.Literal("interested"),
  t.Literal("not_going"),
]);
const rsvpFilterStatusEnum = t.Union([
  t.Literal("going"),
  t.Literal("interested"),
  t.Literal("not_going"),
  t.Literal("invited"),
]);

/**
 * Drops private user metadata (handle, avatar) from RSVP rows so we
 * return a stable wire format regardless of whether the viewer was
 * allowed to see the row — visibility is enforced upstream by
 * listRsvps. See rsvps.ts for the filtering logic.
 */
const serializeRsvp = (row: RsvpWithUser) => ({
  id: row.id,
  eventId: row.eventId,
  userId: row.userId,
  status: row.status,
  invitedByUserId: row.invitedByUserId,
  createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  user: row.user
    ? {
        id: row.user.id,
        handle: row.user.handle,
        displayName: row.user.displayName,
        avatarUrl: row.user.avatarUrl,
      }
    : null,
});

const statusEnum = t.Optional(
  t.Union([
    t.Literal("upcoming"),
    t.Literal("ongoing"),
    t.Literal("finished"),
    t.Literal("cancelled"),
  ]),
);

/** Extracts verified claims from a Bearer token. Returns null on any failure. */
async function extractClaims(
  authHeader: string | undefined,
  secret: Uint8Array,
): Promise<{
  userId: string;
  email: string | null;
  handle: string | null;
  displayName: string | null;
} | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authHeader.slice(7), secret);
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) return null;
    const email = typeof payload.email === "string" ? payload.email : null;
    const handle = typeof payload.handle === "string" ? payload.handle : null;
    const displayName = typeof payload.displayName === "string" ? payload.displayName : null;
    return { userId, email, handle, displayName };
  } catch {
    return null;
  }
}

const DEFAULT_JWT_SECRET = process.env.OSN_JWT_SECRET ?? "dev-secret-change-in-prod";

export const createEventsRoutes = (
  dbLayer: Layer.Layer<Db> = DbLive,
  jwtSecret: string = DEFAULT_JWT_SECRET,
  osnDbLayer: Layer.Layer<OsnDb> = OsnDbLayer,
) => {
  const secretBytes = new TextEncoder().encode(jwtSecret);
  // Routes that need both DB layers merge them once up front.
  const combinedLayer = Layer.mergeAll(dbLayer, osnDbLayer);

  return (
    new Elysia({ prefix: "/events" })
      .get(
        "/",
        async ({ query, headers }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          const result = await Effect.runPromise(
            listEvents({ ...query, viewerId: claims?.userId ?? null }).pipe(
              Effect.provide(dbLayer),
            ),
          );
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
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const creator = {
            createdByUserId: claims.userId,
            createdByName:
              claims.displayName ??
              (claims.handle ? `@${claims.handle}` : null) ??
              (claims.email ? (claims.email.split("@")[0] ?? null) : null),
            createdByAvatar: null,
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
            visibility: visibilityEnum,
            guestListVisibility: guestListVisibilityEnum,
            joinPolicy: joinPolicyEnum,
            allowInterested: t.Optional(t.Boolean()),
            commsChannels: commsChannelsSchema,
          }),
        },
      )
      .patch(
        "/:id",
        async ({ params, body, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const userId = claims.userId;
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
            visibility: visibilityEnum,
            guestListVisibility: guestListVisibilityEnum,
            joinPolicy: joinPolicyEnum,
            allowInterested: t.Optional(t.Boolean()),
            commsChannels: commsChannelsSchema,
          }),
        },
      )
      .delete(
        "/:id",
        async ({ params, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const userId = claims.userId;
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
      )
      // ── RSVPs ────────────────────────────────────────────────────────────
      .get(
        "/:id/rsvps",
        async ({ params, query, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          const result = await Effect.runPromise(
            listRsvps(params.id, claims?.userId ?? null, {
              status: query.status,
              limit: query.limit ? Number(query.limit) : undefined,
            }).pipe(
              Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
              Effect.catchAll(() =>
                Effect.sync(() => {
                  set.status = 500;
                  return { error: "Failed to list RSVPs" } as const;
                }),
              ),
              Effect.provide(combinedLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Event not found" } as const;
          }
          if (
            result != null &&
            !Array.isArray(result) &&
            typeof result === "object" &&
            "error" in result
          ) {
            return result;
          }
          return { rsvps: (result as RsvpWithUser[]).map(serializeRsvp) };
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({
            status: t.Optional(rsvpFilterStatusEnum),
            limit: t.Optional(t.String()),
          }),
        },
      )
      .get(
        "/:id/rsvps/counts",
        async ({ params, set }) => {
          const result = await Effect.runPromise(
            rsvpCounts(params.id).pipe(
              Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Event not found" } as const;
          }
          return { counts: result };
        },
        { params: t.Object({ id: t.String() }) },
      )
      .get(
        "/:id/rsvps/latest",
        async ({ params, query, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          const limit = query.limit ? Math.min(Math.max(1, Number(query.limit)), 20) : 5;
          const result = await Effect.runPromise(
            latestRsvps(params.id, claims?.userId ?? null, limit).pipe(
              Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
              Effect.catchAll(() =>
                Effect.sync(() => {
                  set.status = 500;
                  return { error: "Failed to list RSVPs" } as const;
                }),
              ),
              Effect.provide(combinedLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Event not found" } as const;
          }
          if (
            result != null &&
            !Array.isArray(result) &&
            typeof result === "object" &&
            "error" in result
          ) {
            return result;
          }
          return { rsvps: (result as RsvpWithUser[]).map(serializeRsvp) };
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({ limit: t.Optional(t.String()) }),
        },
      )
      .post(
        "/:id/rsvps",
        async ({ params, body, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            upsertRsvp(params.id, claims.userId, body).pipe(
              Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
              Effect.catchTag("NotInvited", () =>
                Effect.sync(() => {
                  set.status = 403;
                  return { message: "Invitation required" } as const;
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
            return { message: "Event not found" } as const;
          }
          if ("message" in result || "error" in result) return result;
          return { rsvp: result };
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ status: rsvpStatusEnum }),
        },
      )
      .post(
        "/:id/invite",
        async ({ params, body, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            inviteGuests(params.id, claims.userId, body).pipe(
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
            return { message: "Event not found" } as const;
          }
          return result;
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ userIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }) }),
        },
      )
      // ── Add to calendar ─────────────────────────────────────────────────
      .get(
        "/:id/ics",
        async ({ params, set }) => {
          const result = await Effect.runPromise(
            getEvent(params.id).pipe(
              Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Event not found" } as const;
          }
          const ics = buildIcs(result);
          set.headers["content-type"] = "text/calendar; charset=utf-8";
          set.headers["content-disposition"] = `attachment; filename="${result.id}.ics"`;
          return ics;
        },
        { params: t.Object({ id: t.String() }) },
      )
      // ── Comms (stubbed) ─────────────────────────────────────────────────
      .get(
        "/:id/comms",
        async ({ params, set }) => {
          const result = await Effect.runPromise(
            Effect.gen(function* () {
              const event = yield* getEvent(params.id);
              const blasts = yield* listBlasts(params.id, 10);
              return { event, blasts };
            }).pipe(
              Effect.catchTag("EventNotFound", () => Effect.succeed(null)),
              Effect.provide(dbLayer),
            ),
          );
          if (result === null) {
            set.status = 404;
            return { message: "Event not found" } as const;
          }
          return {
            channels: parseCommsChannels(result.event.commsChannels),
            blasts: result.blasts.map((b) => ({
              id: b.id,
              channel: b.channel,
              body: b.body,
              sentByUserId: b.sentByUserId,
              sentAt: b.sentAt instanceof Date ? b.sentAt.toISOString() : b.sentAt,
              createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
            })),
          };
        },
        { params: t.Object({ id: t.String() }) },
      )
      .post(
        "/:id/comms/blasts",
        async ({ params, body, headers, set }) => {
          const claims = await extractClaims(headers["authorization"], secretBytes);
          if (!claims) {
            set.status = 401;
            return { message: "Unauthorized" } as const;
          }
          const result = await Effect.runPromise(
            sendBlast(params.id, claims.userId, body).pipe(
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
            return { message: "Event not found" } as const;
          }
          if ("message" in result || "error" in result) return result;
          set.status = 201;
          return {
            blasts: result.blasts.map((b) => ({
              id: b.id,
              channel: b.channel,
              body: b.body,
              sentAt: b.sentAt instanceof Date ? b.sentAt.toISOString() : b.sentAt,
            })),
          };
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            channels: t.Array(t.Union([t.Literal("sms"), t.Literal("email")]), {
              minItems: 1,
              maxItems: 2,
            }),
            body: t.String({ minLength: 1, maxLength: 1600 }),
          }),
        },
      )
  );
};

// ---------------------------------------------------------------------------
// /me/settings (Pulse-side user settings)
// ---------------------------------------------------------------------------

export const createSettingsRoutes = (
  dbLayer: Layer.Layer<Db> = DbLive,
  jwtSecret: string = DEFAULT_JWT_SECRET,
) => {
  const secretBytes = new TextEncoder().encode(jwtSecret);
  return new Elysia({ prefix: "/me" }).patch(
    "/settings",
    async ({ body, headers, set }) => {
      const claims = await extractClaims(headers["authorization"], secretBytes);
      if (!claims) {
        set.status = 401;
        return { message: "Unauthorized" } as const;
      }
      const result = await Effect.runPromise(
        updateSettings(claims.userId, body).pipe(
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
      return {
        settings: {
          userId: result.userId,
          attendanceVisibility: result.attendanceVisibility,
        },
      };
    },
    {
      body: t.Object({
        attendanceVisibility: t.Optional(
          t.Union([t.Literal("connections"), t.Literal("close_friends"), t.Literal("no_one")]),
        ),
      }),
    },
  );
};

export const eventsRoutes = createEventsRoutes();
export const settingsRoutes = createSettingsRoutes();
