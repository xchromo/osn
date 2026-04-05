import { Data, Effect } from "effect";
import { and, eq, or } from "drizzle-orm";
import { users, connections, closeFriends, blocks } from "@osn/db/schema";
import { Db } from "@osn/db/service";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GraphError extends Data.TaggedError("GraphError")<{
  readonly message: string;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown;
}> {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genId(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function now(): Date {
  return new Date();
}

// ---------------------------------------------------------------------------
// Graph service factory
// ---------------------------------------------------------------------------

export function createGraphService() {
  // -------------------------------------------------------------------------
  // Block checks
  // -------------------------------------------------------------------------

  const isBlocked = (
    blockerId: string,
    blockedId: string,
  ): Effect.Effect<boolean, DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const result = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(blocks)
            .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });
      return result.length > 0;
    });

  /** Returns true if either party has blocked the other. */
  const eitherBlocked = (userA: string, userB: string): Effect.Effect<boolean, DatabaseError, Db> =>
    Effect.gen(function* () {
      const [aBlocksB, bBlocksA] = yield* Effect.all(
        [isBlocked(userA, userB), isBlocked(userB, userA)],
        {
          concurrency: "unbounded",
        },
      );
      return aBlocksB || bBlocksA;
    });

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------

  /**
   * Returns the connection status from the perspective of `viewerId` toward `targetId`.
   * "pending_sent"     — viewer sent a request that is still pending
   * "pending_received" — target sent a request to viewer that is still pending
   * "connected"        — accepted connection exists in either direction
   * "none"             — no relationship
   */
  const getConnectionStatus = (
    viewerId: string,
    targetId: string,
  ): Effect.Effect<"none" | "pending_sent" | "pending_received" | "connected", DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      // Check both directions in one query
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(
              or(
                and(eq(connections.requesterId, viewerId), eq(connections.addresseeId, targetId)),
                and(eq(connections.requesterId, targetId), eq(connections.addresseeId, viewerId)),
              ),
            ),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) return "none";

      for (const row of rows) {
        if (row.status === "accepted") return "connected";
        if (row.requesterId === viewerId) return "pending_sent";
        return "pending_received";
      }
      return "none";
    });

  const sendConnectionRequest = (
    requesterId: string,
    addresseeId: string,
  ): Effect.Effect<void, GraphError | DatabaseError, Db> =>
    Effect.gen(function* () {
      if (requesterId === addresseeId) {
        return yield* Effect.fail(new GraphError({ message: "Cannot connect to yourself" }));
      }

      const blocked = yield* eitherBlocked(requesterId, addresseeId);
      if (blocked) {
        return yield* Effect.fail(new GraphError({ message: "Cannot send connection request" }));
      }

      const status = yield* getConnectionStatus(requesterId, addresseeId);
      if (status !== "none") {
        return yield* Effect.fail(new GraphError({ message: "Connection already exists" }));
      }

      const { db } = yield* Db;
      const ts = now();
      yield* Effect.tryPromise({
        try: () =>
          db.insert(connections).values({
            id: genId("conn_"),
            requesterId,
            addresseeId,
            status: "pending",
            createdAt: ts,
            updatedAt: ts,
          }),
        catch: (cause) => new DatabaseError({ cause }),
      });
    });

  const acceptConnection = (
    addresseeId: string,
    requesterId: string,
  ): Effect.Effect<void, GraphError | NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.requesterId, requesterId),
                eq(connections.addresseeId, addresseeId),
                eq(connections.status, "pending"),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Pending request not found" }));
      }

      yield* Effect.tryPromise({
        try: () =>
          db
            .update(connections)
            .set({ status: "accepted", updatedAt: now() })
            .where(eq(connections.id, rows[0].id)),
        catch: (cause) => new DatabaseError({ cause }),
      });
    });

  /**
   * Rejects a pending request by deleting the row (keeps schema clean).
   */
  const rejectConnection = (
    addresseeId: string,
    requesterId: string,
  ): Effect.Effect<void, NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.requesterId, requesterId),
                eq(connections.addresseeId, addresseeId),
                eq(connections.status, "pending"),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Pending request not found" }));
      }

      yield* Effect.tryPromise({
        try: () => db.delete(connections).where(eq(connections.id, rows[0].id)),
        catch: (cause) => new DatabaseError({ cause }),
      });
    });

  /**
   * Removes an accepted connection or cancels a pending request in either direction.
   */
  const removeConnection = (
    userId: string,
    otherId: string,
  ): Effect.Effect<void, NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(
              or(
                and(eq(connections.requesterId, userId), eq(connections.addresseeId, otherId)),
                and(eq(connections.requesterId, otherId), eq(connections.addresseeId, userId)),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Connection not found" }));
      }

      yield* Effect.tryPromise({
        try: () => db.delete(connections).where(eq(connections.id, rows[0].id)),
        catch: (cause) => new DatabaseError({ cause }),
      });
    });

  const listConnections = (
    userId: string,
  ): Effect.Effect<{ user: typeof users.$inferSelect; connectedAt: Date }[], DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;

      // Fetch accepted rows where user is either party
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(
              and(
                or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId)),
                eq(connections.status, "accepted"),
              ),
            ),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) return [];

      // Collect peer IDs
      const peerIds = rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
      const updatedAtMap = new Map(
        rows.map((r) => [r.requesterId === userId ? r.addresseeId : r.requesterId, r.updatedAt]),
      );

      // Fetch all peers concurrently
      const peers = yield* Effect.all(
        peerIds.map((peerId) =>
          Effect.tryPromise({
            try: () => db.select().from(users).where(eq(users.id, peerId)).limit(1),
            catch: (cause) => new DatabaseError({ cause }),
          }).pipe(Effect.map((r) => r[0] ?? null)),
        ),
        { concurrency: "unbounded" },
      );

      return peers
        .filter((u): u is typeof users.$inferSelect => u !== null)
        .map((u) => ({ user: u, connectedAt: updatedAtMap.get(u.id) ?? new Date() }));
    });

  const listPendingRequests = (
    userId: string,
  ): Effect.Effect<{ user: typeof users.$inferSelect; requestedAt: Date }[], DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(and(eq(connections.addresseeId, userId), eq(connections.status, "pending"))),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) return [];

      const requesters = yield* Effect.all(
        rows.map((row) =>
          Effect.tryPromise({
            try: () => db.select().from(users).where(eq(users.id, row.requesterId)).limit(1),
            catch: (cause) => new DatabaseError({ cause }),
          }).pipe(Effect.map((r) => ({ user: r[0] ?? null, requestedAt: row.createdAt }))),
        ),
        { concurrency: "unbounded" },
      );

      return requesters.filter(
        (r): r is { user: typeof users.$inferSelect; requestedAt: Date } => r.user !== null,
      );
    });

  // -------------------------------------------------------------------------
  // Close friends
  // -------------------------------------------------------------------------

  const addCloseFriend = (
    userId: string,
    friendId: string,
  ): Effect.Effect<void, GraphError | DatabaseError, Db> =>
    Effect.gen(function* () {
      if (userId === friendId) {
        return yield* Effect.fail(
          new GraphError({ message: "Cannot add yourself as a close friend" }),
        );
      }

      // Must be connected first
      const status = yield* getConnectionStatus(userId, friendId);
      if (status !== "connected") {
        return yield* Effect.fail(
          new GraphError({ message: "Must be connected before adding as a close friend" }),
        );
      }

      const { db } = yield* Db;
      yield* Effect.tryPromise({
        try: () =>
          db
            .insert(closeFriends)
            .values({ id: genId("clf_"), userId, friendId, createdAt: now() })
            .onConflictDoNothing(),
        catch: (cause) => new DatabaseError({ cause }),
      });
    });

  const removeCloseFriend = (
    userId: string,
    friendId: string,
  ): Effect.Effect<void, NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(closeFriends)
            .where(and(eq(closeFriends.userId, userId), eq(closeFriends.friendId, friendId)))
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Close friend not found" }));
      }

      yield* Effect.tryPromise({
        try: () => db.delete(closeFriends).where(eq(closeFriends.id, rows[0].id)),
        catch: (cause) => new DatabaseError({ cause }),
      });
    });

  const listCloseFriends = (
    userId: string,
  ): Effect.Effect<(typeof users.$inferSelect)[], DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () => db.select().from(closeFriends).where(eq(closeFriends.userId, userId)),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) return [];

      const friends = yield* Effect.all(
        rows.map((row) =>
          Effect.tryPromise({
            try: () => db.select().from(users).where(eq(users.id, row.friendId)).limit(1),
            catch: (cause) => new DatabaseError({ cause }),
          }).pipe(Effect.map((r) => r[0] ?? null)),
        ),
        { concurrency: "unbounded" },
      );

      return friends.filter((u): u is typeof users.$inferSelect => u !== null);
    });

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  const blockUser = (
    blockerId: string,
    blockedId: string,
  ): Effect.Effect<void, GraphError | DatabaseError, Db> =>
    Effect.gen(function* () {
      if (blockerId === blockedId) {
        return yield* Effect.fail(new GraphError({ message: "Cannot block yourself" }));
      }

      const { db } = yield* Db;

      // Remove any existing connection silently
      const connRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(
              or(
                and(eq(connections.requesterId, blockerId), eq(connections.addresseeId, blockedId)),
                and(eq(connections.requesterId, blockedId), eq(connections.addresseeId, blockerId)),
              ),
            )
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (connRows.length > 0) {
        yield* Effect.tryPromise({
          try: () => db.delete(connections).where(eq(connections.id, connRows[0].id)),
          catch: (cause) => new DatabaseError({ cause }),
        });
      }

      // Also remove from close friends in both directions
      yield* Effect.all(
        [
          Effect.tryPromise({
            try: () =>
              db
                .delete(closeFriends)
                .where(
                  or(
                    and(eq(closeFriends.userId, blockerId), eq(closeFriends.friendId, blockedId)),
                    and(eq(closeFriends.userId, blockedId), eq(closeFriends.friendId, blockerId)),
                  ),
                ),
            catch: (cause) => new DatabaseError({ cause }),
          }),
        ],
        { concurrency: "unbounded" },
      );

      yield* Effect.tryPromise({
        try: () =>
          db
            .insert(blocks)
            .values({ id: genId("blk_"), blockerId, blockedId, createdAt: now() })
            .onConflictDoNothing(),
        catch: (cause) => new DatabaseError({ cause }),
      });
    });

  const unblockUser = (
    blockerId: string,
    blockedId: string,
  ): Effect.Effect<void, NotFoundError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(blocks)
            .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
            .limit(1),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) {
        return yield* Effect.fail(new NotFoundError({ message: "Block not found" }));
      }

      yield* Effect.tryPromise({
        try: () => db.delete(blocks).where(eq(blocks.id, rows[0].id)),
        catch: (cause) => new DatabaseError({ cause }),
      });
    });

  const listBlocks = (
    userId: string,
  ): Effect.Effect<(typeof users.$inferSelect)[], DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () => db.select().from(blocks).where(eq(blocks.blockerId, userId)),
        catch: (cause) => new DatabaseError({ cause }),
      });

      if (rows.length === 0) return [];

      const blocked = yield* Effect.all(
        rows.map((row) =>
          Effect.tryPromise({
            try: () => db.select().from(users).where(eq(users.id, row.blockedId)).limit(1),
            catch: (cause) => new DatabaseError({ cause }),
          }).pipe(Effect.map((r) => r[0] ?? null)),
        ),
        { concurrency: "unbounded" },
      );

      return blocked.filter((u): u is typeof users.$inferSelect => u !== null);
    });

  return {
    isBlocked,
    eitherBlocked,
    getConnectionStatus,
    sendConnectionRequest,
    acceptConnection,
    rejectConnection,
    removeConnection,
    listConnections,
    listPendingRequests,
    addCloseFriend,
    removeCloseFriend,
    listCloseFriends,
    blockUser,
    unblockUser,
    listBlocks,
  };
}

export type GraphService = ReturnType<typeof createGraphService>;
