import { serviceAccounts, users } from "@osn/db/schema";
import { Db, DbLive } from "@osn/db/service";
import { inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { Elysia, t } from "elysia";

import { requireArc } from "../lib/arc-middleware";
import { createGraphService } from "../services/graph";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIENCE = "osn-core";
const SCOPE_GRAPH_READ = "graph:read";
/** Max profile IDs per batch request — stays well under SQLite's variable limit (999). */
const MAX_BATCH_PROFILE_IDS = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts a safe, non-leaking message from a caught error. */
function safeError(e: unknown): string {
  if (e instanceof Error) {
    if ("_tag" in e && (e._tag === "GraphError" || e._tag === "NotFoundError")) {
      return (e as { message: string }).message;
    }
  }
  return "Request failed";
}

// ---------------------------------------------------------------------------
// Internal graph routes — ARC token protected
// ---------------------------------------------------------------------------

/**
 * Creates the `/graph/internal/*` route group for service-to-service calls.
 *
 * All routes require `Authorization: ARC <token>` with `graph:read` scope
 * and audience `"osn-core"`. These are read-only endpoints consumed by
 * other OSN services (e.g. Pulse API via the graphBridge).
 *
 * @param dbLayer - Effect Layer providing Db (defaults to DbLive)
 */
export function createInternalGraphRoutes(dbLayer: Layer.Layer<Db> = DbLive) {
  const graph = createGraphService();

  const run = <A, E>(eff: Effect.Effect<A, E, Db>): Promise<A> =>
    Effect.runPromise(eff.pipe(Effect.provide(dbLayer)) as Effect.Effect<A, never, never>);

  return (
    new Elysia({ prefix: "/graph/internal" })
      // -----------------------------------------------------------------------
      // Symmetric block check
      // User-facing endpoint only exposes one-directional isBlocked;
      // eitherBlocked is reserved for S2S callers (see graph.ts comment M1).
      // -----------------------------------------------------------------------
      .get(
        "/either-blocked",
        async ({ query, headers, set }) => {
          const caller = await requireArc(
            headers.authorization,
            set,
            dbLayer,
            AUDIENCE,
            SCOPE_GRAPH_READ,
          );
          if (!caller) return { error: "Unauthorized" };

          try {
            const blocked = await run(graph.eitherBlocked(query.profileA, query.profileB));
            return { blocked };
          } catch (e) {
            set.status = 500;
            return { error: safeError(e) };
          }
        },
        {
          query: t.Object({
            profileA: t.String({ minLength: 1 }),
            profileB: t.String({ minLength: 1 }),
          }),
        },
      )
      // -----------------------------------------------------------------------
      // Connection status between two profiles
      // -----------------------------------------------------------------------
      .get(
        "/connection-status",
        async ({ query, headers, set }) => {
          const caller = await requireArc(
            headers.authorization,
            set,
            dbLayer,
            AUDIENCE,
            SCOPE_GRAPH_READ,
          );
          if (!caller) return { error: "Unauthorized" };

          try {
            const status = await run(graph.getConnectionStatus(query.viewerId, query.targetId));
            return { status };
          } catch (e) {
            set.status = 500;
            return { error: safeError(e) };
          }
        },
        {
          query: t.Object({
            viewerId: t.String({ minLength: 1 }),
            targetId: t.String({ minLength: 1 }),
          }),
        },
      )
      // -----------------------------------------------------------------------
      // List connection IDs for a profile (returns IDs only for bridge efficiency)
      // -----------------------------------------------------------------------
      .get(
        "/connections",
        async ({ query, headers, set }) => {
          const caller = await requireArc(
            headers.authorization,
            set,
            dbLayer,
            AUDIENCE,
            SCOPE_GRAPH_READ,
          );
          if (!caller) return { error: "Unauthorized" };

          const limit = query.limit ? parseInt(query.limit, 10) : undefined;

          try {
            const list = await run(
              graph.listConnections(query.profileId, {
                limit: Number.isFinite(limit) ? limit : undefined,
              }),
            );
            return { connectionIds: list.map((c) => c.profile.id) };
          } catch (e) {
            set.status = 500;
            return { error: safeError(e) };
          }
        },
        {
          query: t.Object({
            profileId: t.String({ minLength: 1 }),
            limit: t.Optional(t.String()),
          }),
        },
      )
      // -----------------------------------------------------------------------
      // List close friend IDs for a profile
      // -----------------------------------------------------------------------
      .get(
        "/close-friends",
        async ({ query, headers, set }) => {
          const caller = await requireArc(
            headers.authorization,
            set,
            dbLayer,
            AUDIENCE,
            SCOPE_GRAPH_READ,
          );
          if (!caller) return { error: "Unauthorized" };

          const limit = query.limit ? parseInt(query.limit, 10) : undefined;

          try {
            const list = await run(
              graph.listCloseFriends(query.profileId, {
                limit: Number.isFinite(limit) ? limit : undefined,
              }),
            );
            return { closeFriendIds: list.map((u) => u.id) };
          } catch (e) {
            set.status = 500;
            return { error: safeError(e) };
          }
        },
        {
          query: t.Object({
            profileId: t.String({ minLength: 1 }),
            limit: t.Optional(t.String()),
          }),
        },
      )
      // -----------------------------------------------------------------------
      // Single close-friend check
      // -----------------------------------------------------------------------
      .get(
        "/is-close-friend",
        async ({ query, headers, set }) => {
          const caller = await requireArc(
            headers.authorization,
            set,
            dbLayer,
            AUDIENCE,
            SCOPE_GRAPH_READ,
          );
          if (!caller) return { error: "Unauthorized" };

          try {
            const isCloseFriend = await run(graph.isCloseFriendOf(query.profileId, query.friendId));
            return { isCloseFriend };
          } catch (e) {
            set.status = 500;
            return { error: safeError(e) };
          }
        },
        {
          query: t.Object({
            profileId: t.String({ minLength: 1 }),
            friendId: t.String({ minLength: 1 }),
          }),
        },
      )
      // -----------------------------------------------------------------------
      // Batched reverse close-friend lookup
      // -----------------------------------------------------------------------
      .post(
        "/close-friends-of",
        async ({ body, headers, set }) => {
          const caller = await requireArc(
            headers.authorization,
            set,
            dbLayer,
            AUDIENCE,
            SCOPE_GRAPH_READ,
          );
          if (!caller) return { error: "Unauthorized" };

          try {
            const result = await run(graph.getCloseFriendsOfBatch(body.viewerId, body.profileIds));
            return { closeFriendIds: [...result] };
          } catch (e) {
            set.status = 500;
            return { error: safeError(e) };
          }
        },
        {
          body: t.Object({
            viewerId: t.String({ minLength: 1 }),
            profileIds: t.Array(t.String({ minLength: 1 }), { maxItems: MAX_BATCH_PROFILE_IDS }),
          }),
        },
      )
      // -----------------------------------------------------------------------
      // Service account self-registration (ephemeral key bootstrap)
      //
      // A S2S service (e.g. pulse-api) calls this on startup to register (or
      // rotate) its public key. Protected by INTERNAL_SERVICE_SECRET — a
      // shared secret between osn/api and the registering service. This
      // eliminates the need for pre-distributed private keys in .env files.
      //
      // Omit INTERNAL_SERVICE_SECRET in the environment to disable this
      // endpoint (it returns 501 when the env var is unset).
      // -----------------------------------------------------------------------
      .post(
        "/register-service",
        async ({ body, headers, set }) => {
          const secret = process.env.INTERNAL_SERVICE_SECRET;
          if (!secret) {
            set.status = 501;
            return { error: "Service registration is disabled on this instance" };
          }
          if (headers["authorization"] !== `Bearer ${secret}`) {
            set.status = 401;
            return { error: "Unauthorized" };
          }
          try {
            const now = new Date();
            await run(
              Effect.gen(function* () {
                const { db } = yield* Db;
                yield* Effect.tryPromise({
                  try: () =>
                    db
                      .insert(serviceAccounts)
                      .values({
                        serviceId: body.serviceId,
                        publicKeyJwk: body.publicKeyJwk,
                        allowedScopes: body.allowedScopes,
                        createdAt: now,
                        updatedAt: now,
                      })
                      .onConflictDoUpdate({
                        target: serviceAccounts.serviceId,
                        set: { publicKeyJwk: body.publicKeyJwk, updatedAt: now },
                      }),
                  catch: (cause) => new Error("DB error", { cause }),
                });
              }),
            );
            return { ok: true };
          } catch (e) {
            set.status = 500;
            return { error: safeError(e) };
          }
        },
        {
          body: t.Object({
            serviceId: t.String({ minLength: 1 }),
            publicKeyJwk: t.String({ minLength: 1 }),
            allowedScopes: t.String({ minLength: 1 }),
          }),
        },
      )
      // -----------------------------------------------------------------------
      // Batch profile display metadata
      // -----------------------------------------------------------------------
      .post(
        "/profile-displays",
        async ({ body, headers, set }) => {
          const caller = await requireArc(
            headers.authorization,
            set,
            dbLayer,
            AUDIENCE,
            SCOPE_GRAPH_READ,
          );
          if (!caller) return { error: "Unauthorized" };

          try {
            if (body.profileIds.length === 0) return { profiles: [] };

            const rows = await run(
              Effect.gen(function* () {
                const { db } = yield* Db;
                return yield* Effect.tryPromise({
                  try: () =>
                    db
                      .select({
                        id: users.id,
                        handle: users.handle,
                        displayName: users.displayName,
                        avatarUrl: users.avatarUrl,
                      })
                      .from(users)
                      .where(inArray(users.id, body.profileIds)),
                  catch: (cause) => new Error("DB query failed", { cause }),
                });
              }),
            );

            return { profiles: rows };
          } catch (e) {
            set.status = 500;
            return { error: safeError(e) };
          }
        },
        {
          body: t.Object({
            profileIds: t.Array(t.String({ minLength: 1 }), { maxItems: MAX_BATCH_PROFILE_IDS }),
          }),
        },
      )
  );
}
