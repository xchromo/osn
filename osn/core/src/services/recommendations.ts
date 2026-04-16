import { blocks, connections, users } from "@osn/db/schema";
import { Db } from "@osn/db/service";
import { and, eq, inArray, or } from "drizzle-orm";
import { Data, Effect } from "effect";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RecommendationError extends Data.TaggedError("RecommendationError")<{
  readonly message: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown;
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Suggestion {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  mutualCount: number;
}

// ---------------------------------------------------------------------------
// Recommendation service factory
// ---------------------------------------------------------------------------

export function createRecommendationService() {
  /**
   * Suggest "people you may know" based on mutual connections (friends-of-friends).
   *
   * Algorithm:
   * 1. Get all profile IDs the caller is connected to (accepted only).
   * 2. Get all blocked profile IDs (both directions).
   * 3. For each of the caller's connections, find *their* connections.
   * 4. Exclude self, existing connections, and blocked profiles.
   * 5. Count mutual connections per candidate and sort descending.
   * 6. Hydrate top results with profile data.
   */
  const suggestConnections = (
    profileId: string,
    limit = 10,
  ): Effect.Effect<Suggestion[], DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const safeLimit = Math.min(Math.max(limit, 1), 50);

      // Step 1: Get my accepted connection IDs
      const myConnectionRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.status, "accepted"),
                or(eq(connections.requesterId, profileId), eq(connections.addresseeId, profileId)),
              ),
            ),
        catch: (cause) => new DatabaseError({ cause }),
      });

      const myConnectionIds = myConnectionRows.map((r) =>
        r.requesterId === profileId ? r.addresseeId : r.requesterId,
      );

      if (myConnectionIds.length === 0) return [];

      // Step 2: Get blocks (both directions)
      const blockRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(blocks)
            .where(or(eq(blocks.blockerId, profileId), eq(blocks.blockedId, profileId))),
        catch: (cause) => new DatabaseError({ cause }),
      });

      const blockedIds = blockRows.map((r) =>
        r.blockerId === profileId ? r.blockedId : r.blockerId,
      );

      const excludeIds = new Set([profileId, ...myConnectionIds, ...blockedIds]);

      // Step 3: For each of my connections, find THEIR accepted connections
      const fofRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.status, "accepted"),
                or(
                  inArray(connections.requesterId, myConnectionIds),
                  inArray(connections.addresseeId, myConnectionIds),
                ),
              ),
            ),
        catch: (cause) => new DatabaseError({ cause }),
      });

      // Step 4: Aggregate candidates, counting mutual connections
      const mutualCounts = new Map<string, number>();

      for (const row of fofRows) {
        // Determine which side is the mutual friend and which is the candidate
        const isMutualRequester = myConnectionIds.includes(row.requesterId);
        const isMutualAddressee = myConnectionIds.includes(row.addresseeId);

        // Both sides could be my connections — skip (that's just a connection between two of my friends)
        if (isMutualRequester && isMutualAddressee) continue;

        const candidateId = isMutualRequester ? row.addresseeId : row.requesterId;

        if (excludeIds.has(candidateId)) continue;

        mutualCounts.set(candidateId, (mutualCounts.get(candidateId) ?? 0) + 1);
      }

      if (mutualCounts.size === 0) return [];

      // Step 5: Sort by mutual count descending and take top N
      const sorted = [...mutualCounts.entries()]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, safeLimit);

      const candidateIds = sorted.map(([id]) => id);

      // Step 6: Hydrate with profile info
      const profiles = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              id: users.id,
              handle: users.handle,
              displayName: users.displayName,
              avatarUrl: users.avatarUrl,
            })
            .from(users)
            .where(inArray(users.id, candidateIds)),
        catch: (cause) => new DatabaseError({ cause }),
      });

      const profileMap = new Map(profiles.map((p) => [p.id, p]));

      return sorted
        .map(([id, mutualCount]) => {
          const p = profileMap.get(id);
          if (!p) return null;
          return {
            handle: p.handle,
            displayName: p.displayName,
            avatarUrl: p.avatarUrl,
            mutualCount,
          };
        })
        .filter((s): s is Suggestion => s !== null);
    }).pipe(Effect.withSpan("recommendations.suggest_connections"));

  return { suggestConnections };
}

export type RecommendationService = ReturnType<typeof createRecommendationService>;
