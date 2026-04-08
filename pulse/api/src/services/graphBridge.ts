import { Data, Effect } from "effect";
import type { Layer } from "effect";
import { inArray } from "drizzle-orm";
import { createGraphService } from "@osn/core";
import { users } from "@osn/db/schema";
import { Db as OsnDb, DbLive as OsnDbLive } from "@osn/db/service";

/**
 * Single error type used by all graph-bridge functions. Wraps any failure
 * from the underlying OSN graph service (`DatabaseError`, `GraphError`,
 * `NotFoundError`) so callers have one tag to catch instead of a union
 * of errors they don't own.
 */
export class GraphBridgeError extends Data.TaggedError("GraphBridgeError")<{
  readonly cause: unknown;
}> {}

/**
 * Isolated bridge to the OSN social graph.
 *
 * This is the only file in `pulse/api` that imports from `@osn/core` or
 * `@osn/db`. Other services call through here so that when S2S migrates
 * from direct package imports to ARC-token HTTP (per TODO.md line 91),
 * the change is local to this file — no touching of `rsvps.ts` or routes.
 *
 * Graph calls require the OSN db layer (`@osn/db/Db`), which is *different*
 * from `@pulse/db/Db`. The two Tags use different identifiers
 * (`@pulse/db/Db` vs `@osn/db/Db`) so they don't collide when both layers
 * are provided to the same Effect.
 */

const graph = createGraphService();

/**
 * The set of user IDs `userId` is connected to (accepted connections only).
 * Returns a `Set` for O(1) membership checks in the RSVP visibility filter.
 */
export const getConnectionIds = (
  userId: string,
): Effect.Effect<Set<string>, GraphBridgeError, OsnDb> =>
  graph.listConnections(userId, { limit: 100 }).pipe(
    Effect.map((rows) => new Set(rows.map((r) => r.user.id))),
    Effect.mapError((cause) => new GraphBridgeError({ cause })),
  );

/** The set of user IDs `userId` has marked as close friends. */
export const getCloseFriendIds = (
  userId: string,
): Effect.Effect<Set<string>, GraphBridgeError, OsnDb> =>
  graph.listCloseFriends(userId, { limit: 100 }).pipe(
    Effect.map((rows) => new Set(rows.map((u) => u.id))),
    Effect.mapError((cause) => new GraphBridgeError({ cause })),
  );

export interface UserDisplay {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Fetches display metadata for a batch of OSN user IDs. Used by the RSVP
 * service to join names/avatars onto RSVP rows before returning them to
 * the client (names NEVER come from the JWT — always fresh from DB).
 *
 * Returns a Map keyed by user ID for efficient lookup during join.
 */
export const getUserDisplays = (
  userIds: string[],
): Effect.Effect<Map<string, UserDisplay>, GraphBridgeError, OsnDb> =>
  Effect.gen(function* () {
    if (userIds.length === 0) return new Map();
    const { db } = yield* OsnDb;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            id: users.id,
            handle: users.handle,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
          })
          .from(users)
          .where(inArray(users.id, userIds)),
      catch: (cause) => new GraphBridgeError({ cause }),
    });
    return new Map(rows.map((r) => [r.id, r]));
  });

/**
 * The OSN DB layer that graph-bridge functions require. Re-exported so
 * callers (routes, services) don't need to import from `@osn/db/service`
 * directly — keeps the `@osn/*` import surface contained.
 */
export const OsnDbLayer: Layer.Layer<OsnDb> = OsnDbLive;
export { OsnDb };
