import { Elysia, t } from "elysia";
import { Effect, type Layer } from "effect";
import { DbLive, type Db } from "@osn/db/service";
import { createAuthService, type AuthConfig } from "../services/auth";
import { createGraphService } from "../services/graph";

function extractToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function createGraphRoutes(authConfig: AuthConfig, dbLayer: Layer.Layer<Db> = DbLive) {
  const auth = createAuthService(authConfig);
  const graph = createGraphService();

  const run = <A, E>(eff: Effect.Effect<A, E, Db>): Promise<A> =>
    Effect.runPromise(eff.pipe(Effect.provide(dbLayer)) as Effect.Effect<A, never, never>);

  // Verify token and return userId, or throw with 401 set
  async function requireAuth(
    authorization: string | undefined,
    set: { status?: number | string },
  ): Promise<{ userId: string; handle: string } | null> {
    const token = extractToken(authorization);
    if (!token) {
      set.status = 401;
      return null;
    }
    try {
      const claims = await Effect.runPromise(Effect.orDie(auth.verifyAccessToken(token)));
      return claims;
    } catch {
      set.status = 401;
      return null;
    }
  }

  // Resolve a handle to a userId
  async function resolveHandle(
    handle: string,
    set: { status?: number | string },
  ): Promise<string | null> {
    try {
      const user = await run(auth.findUserByHandle(handle));
      if (!user) {
        set.status = 404;
        return null;
      }
      return user.id;
    } catch {
      set.status = 500;
      return null;
    }
  }

  return (
    new Elysia({ prefix: "/graph" })
      // -------------------------------------------------------------------------
      // Connections
      // -------------------------------------------------------------------------
      .post(
        "/connections/:handle",
        async ({ params, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const targetId = await resolveHandle(params.handle, set);
          if (!targetId) return { error: "User not found" };

          try {
            await run(graph.sendConnectionRequest(caller.userId, targetId));
            set.status = 201;
            return { ok: true };
          } catch (e) {
            set.status = 400;
            return { error: String(e) };
          }
        },
        { params: t.Object({ handle: t.String() }) },
      )
      .patch(
        "/connections/:handle",
        async ({ params, body, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const requesterId = await resolveHandle(params.handle, set);
          if (!requesterId) return { error: "User not found" };

          try {
            if (body.action === "accept") {
              await run(graph.acceptConnection(caller.userId, requesterId));
            } else {
              await run(graph.rejectConnection(caller.userId, requesterId));
            }
            return { ok: true };
          } catch (e) {
            set.status = 400;
            return { error: String(e) };
          }
        },
        {
          params: t.Object({ handle: t.String() }),
          body: t.Object({ action: t.Union([t.Literal("accept"), t.Literal("reject")]) }),
        },
      )
      .delete(
        "/connections/:handle",
        async ({ params, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const otherId = await resolveHandle(params.handle, set);
          if (!otherId) return { error: "User not found" };

          try {
            await run(graph.removeConnection(caller.userId, otherId));
            return { ok: true };
          } catch (e) {
            set.status = 400;
            return { error: String(e) };
          }
        },
        { params: t.Object({ handle: t.String() }) },
      )
      .get("/connections", async ({ headers, set }) => {
        const caller = await requireAuth(headers.authorization, set);
        if (!caller) return { error: "Unauthorized" };

        const list = await run(graph.listConnections(caller.userId));
        return {
          connections: list.map((c) => ({
            handle: c.user.handle,
            displayName: c.user.displayName,
            connectedAt: c.connectedAt.toISOString(),
          })),
        };
      })
      .get("/connections/pending", async ({ headers, set }) => {
        const caller = await requireAuth(headers.authorization, set);
        if (!caller) return { error: "Unauthorized" };

        const list = await run(graph.listPendingRequests(caller.userId));
        return {
          pending: list.map((r) => ({
            handle: r.user.handle,
            displayName: r.user.displayName,
            requestedAt: r.requestedAt.toISOString(),
          })),
        };
      })
      .get(
        "/connections/:handle",
        async ({ params, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const targetId = await resolveHandle(params.handle, set);
          if (!targetId) return { error: "User not found" };

          const status = await run(graph.getConnectionStatus(caller.userId, targetId));
          return { status };
        },
        { params: t.Object({ handle: t.String() }) },
      )
      // -------------------------------------------------------------------------
      // Close friends
      // -------------------------------------------------------------------------
      .post(
        "/close-friends/:handle",
        async ({ params, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const friendId = await resolveHandle(params.handle, set);
          if (!friendId) return { error: "User not found" };

          try {
            await run(graph.addCloseFriend(caller.userId, friendId));
            set.status = 201;
            return { ok: true };
          } catch (e) {
            set.status = 400;
            return { error: String(e) };
          }
        },
        { params: t.Object({ handle: t.String() }) },
      )
      .delete(
        "/close-friends/:handle",
        async ({ params, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const friendId = await resolveHandle(params.handle, set);
          if (!friendId) return { error: "User not found" };

          try {
            await run(graph.removeCloseFriend(caller.userId, friendId));
            return { ok: true };
          } catch (e) {
            set.status = 400;
            return { error: String(e) };
          }
        },
        { params: t.Object({ handle: t.String() }) },
      )
      .get("/close-friends", async ({ headers, set }) => {
        const caller = await requireAuth(headers.authorization, set);
        if (!caller) return { error: "Unauthorized" };

        const list = await run(graph.listCloseFriends(caller.userId));
        return {
          closeFriends: list.map((u) => ({
            handle: u.handle,
            displayName: u.displayName,
          })),
        };
      })
      // -------------------------------------------------------------------------
      // Blocks
      // -------------------------------------------------------------------------
      .post(
        "/blocks/:handle",
        async ({ params, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const blockedId = await resolveHandle(params.handle, set);
          if (!blockedId) return { error: "User not found" };

          try {
            await run(graph.blockUser(caller.userId, blockedId));
            set.status = 201;
            return { ok: true };
          } catch (e) {
            set.status = 400;
            return { error: String(e) };
          }
        },
        { params: t.Object({ handle: t.String() }) },
      )
      .delete(
        "/blocks/:handle",
        async ({ params, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const blockedId = await resolveHandle(params.handle, set);
          if (!blockedId) return { error: "User not found" };

          try {
            await run(graph.unblockUser(caller.userId, blockedId));
            return { ok: true };
          } catch (e) {
            set.status = 400;
            return { error: String(e) };
          }
        },
        { params: t.Object({ handle: t.String() }) },
      )
      .get("/blocks", async ({ headers, set }) => {
        const caller = await requireAuth(headers.authorization, set);
        if (!caller) return { error: "Unauthorized" };

        const list = await run(graph.listBlocks(caller.userId));
        return {
          blocks: list.map((u) => ({
            handle: u.handle,
            displayName: u.displayName,
          })),
        };
      })
      // -----------------------------------------------------------------------
      // Block status check (used by Messaging and other services)
      // -----------------------------------------------------------------------
      .get(
        "/is-blocked/:handle",
        async ({ params, headers, set }) => {
          const caller = await requireAuth(headers.authorization, set);
          if (!caller) return { error: "Unauthorized" };

          const targetId = await resolveHandle(params.handle, set);
          if (!targetId) return { error: "User not found" };

          // Returns true if caller blocked target OR target blocked caller
          const blocked = await run(graph.eitherBlocked(caller.userId, targetId));
          return { blocked };
        },
        { params: t.Object({ handle: t.String() }) },
      )
  );
}
