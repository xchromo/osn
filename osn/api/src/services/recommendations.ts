import {
  accounts,
  blocks,
  connections,
  organisationMembers,
  organisations,
  users,
} from "@osn/db/schema";
import { Db } from "@osn/db/service";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
// Bounds
// ---------------------------------------------------------------------------

/**
 * Caller's connection list is capped before we expand to friends-of-friends.
 * Prevents a hub user with thousands of connections from producing an
 * unbounded FOF fan-out (P-C1). Tuned for the "enough candidates to produce
 * a good top-N list" sweet spot.
 */
const MAX_MY_CONNECTIONS_FOR_FOF = 500;

/**
 * Rows read from the caller's own edge list. Sits above
 * MAX_MY_CONNECTIONS_FOR_FOF because this single read serves two purposes —
 * seeding the FOF fan-out (which takes the first MAX_MY_CONNECTIONS_FOR_FOF
 * *accepted* edges) and building the exclusion set, which wants pending edges
 * too so a request already in flight suppresses the suggestion.
 */
const MAX_MY_EDGE_ROWS = 1_000;

/** Cap on how many of the caller's organisations seed the co-member fan-out. */
const MAX_MY_ORGANISATIONS = 50;

/**
 * Hard cap on the FOF fan-out row count. Worst-case defence alongside
 * MAX_MY_CONNECTIONS_FOR_FOF — a viral cluster with very dense connections
 * would still be bounded by this limit.
 */
const MAX_FOF_FANOUT_ROWS = 10_000;

/**
 * Cap on the co-member fan-out from the caller's organisations. Same shape of
 * defence as MAX_FOF_FANOUT_ROWS: membership of one very large organisation
 * must not turn a suggestion request into an unbounded read.
 */
const MAX_ORG_COMEMBER_ROWS = 2_000;

/**
 * Minimum query length for profile search. Below this we return an empty list
 * (never an error) so a single keystroke can't walk the handle namespace —
 * mirrors `MIN_SEARCH_PREFIX` on the internal co-host autocomplete endpoint.
 */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * How many rows to over-fetch relative to the caller's requested limit. Blocked
 * profiles and the caller's own row are filtered in application code (the block
 * set is unbounded, so binding it into the SQL `NOT IN` would risk SQLite's
 * 999-variable ceiling); over-fetching keeps a page full despite that filtering.
 */
const SEARCH_OVERFETCH_FACTOR = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Why a profile was suggested. Drives the explanatory line in the UI. */
export type SuggestionReason = "mutual_connections" | "shared_organisation";

export interface Suggestion {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  mutualCount: number;
  reason: SuggestionReason;
  /**
   * One organisation the caller and the candidate both belong to, when there
   * is one. Present alongside `reason: "mutual_connections"` too — the reason
   * names the *strongest* signal, this is extra context for the card.
   */
  sharedOrganisation: { handle: string; name: string } | null;
}

/**
 * Caller-relative connection state, in the same vocabulary the graph service's
 * `getConnectionStatus` uses. Lets the search UI render the right action
 * (Connect / Pending / Connected) without an extra request per result.
 */
export type SearchConnectionState = "none" | "pending_sent" | "pending_received" | "connected";

export interface ProfileSearchResult {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  connectionStatus: SearchConnectionState;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a search query the same way handle resolution does: trims, strips
 * a leading `@` sigil, and lowercases. `users.handle` is stored lowercase, so
 * this is what makes `@Alice` and `alice` the same search.
 */
function normaliseQuery(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Escapes the LIKE wildcards (`%`, `_`) plus the escape character itself so a
 * user-typed `_` matches literally — handles may contain underscores.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Recommendation service factory
// ---------------------------------------------------------------------------

export function createRecommendationService() {
  /**
   * Suggest "people you may know" — profiles the caller is not connected to,
   * drawn from two signals the caller already has a relationship with:
   *
   * - **Mutual connections** (friends-of-friends): the stronger signal, ranked
   *   by how many of the caller's connections the candidate shares.
   * - **Shared organisations**: co-members of an organisation the caller
   *   belongs to. This is what gives a brand-new account something to act on —
   *   FOF alone returns nothing until the first connection is accepted.
   *
   * Algorithm:
   * 1. Read the caller's own edges (any status), blocks, and organisations.
   * 2. Build the exclusion set: self, anyone already connected *or* with a
   *    request in flight either way, and anyone blocked in either direction.
   * 3. Fan out to friends-of-friends (capped) and to organisation co-members
   *    (capped), tallying mutual counts and shared organisations per candidate.
   * 4. Rank by mutual count, then shared-organisation count, then handle.
   * 5. Hydrate the top N with profile data, skipping tombstoned accounts.
   */
  const suggestConnections = (
    profileId: string,
    limit = 10,
  ): Effect.Effect<Suggestion[], DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      // Defence-in-depth: the Elysia schema enforces [1, 50], but non-HTTP
      // callers might pass NaN / Infinity / negatives. Coerce any non-finite
      // input back to the default before clamping.
      const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 10, 1), 50);

      // Step 1: caller context. The three reads are independent — run them
      // concurrently (parallel on D1, sequential on bun:sqlite).
      const [myEdgeRows, blockRows, myOrgRows] = yield* Effect.all(
        [
          Effect.tryPromise({
            try: () =>
              db
                .select({
                  requesterId: connections.requesterId,
                  addresseeId: connections.addresseeId,
                  status: connections.status,
                })
                .from(connections)
                .where(
                  or(
                    eq(connections.requesterId, profileId),
                    eq(connections.addresseeId, profileId),
                  ),
                )
                .limit(MAX_MY_EDGE_ROWS),
            catch: (cause) => new DatabaseError({ cause }),
          }),
          Effect.tryPromise({
            try: () =>
              db
                .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
                .from(blocks)
                .where(or(eq(blocks.blockerId, profileId), eq(blocks.blockedId, profileId))),
            catch: (cause) => new DatabaseError({ cause }),
          }),
          Effect.tryPromise({
            try: () =>
              db
                .select({ organisationId: organisationMembers.organisationId })
                .from(organisationMembers)
                .where(eq(organisationMembers.profileId, profileId))
                .limit(MAX_MY_ORGANISATIONS),
            catch: (cause) => new DatabaseError({ cause }),
          }),
        ],
        { concurrency: "unbounded" },
      );

      const counterpartOf = (row: { requesterId: string; addresseeId: string }) =>
        row.requesterId === profileId ? row.addresseeId : row.requesterId;

      // Accepted edges seed the FOF fan-out; *every* edge (pending included)
      // is an exclusion, so someone with a request already in flight is never
      // re-suggested — connecting to them would fail with "already exists".
      const myConnectionIds = myEdgeRows
        .filter((r) => r.status === "accepted")
        .map(counterpartOf)
        .slice(0, MAX_MY_CONNECTIONS_FOR_FOF);

      const blockedIds = blockRows.map((r) =>
        r.blockerId === profileId ? r.blockedId : r.blockerId,
      );
      const myOrgIds = myOrgRows.map((r) => r.organisationId);

      // Set for O(1) membership lookup in the aggregation loop (P-W2).
      const myConnectionIdSet = new Set(myConnectionIds);
      const excludeIds = new Set<string>([
        profileId,
        ...myEdgeRows.map(counterpartOf),
        ...blockedIds,
      ]);

      if (myConnectionIds.length === 0 && myOrgIds.length === 0) return [];

      // Step 2: fan out. Each branch is skipped when its seed set is empty, so
      // a caller with no connections pays for the organisation query only.
      const [fofRows, coMemberRows] = yield* Effect.all(
        [
          myConnectionIds.length === 0
            ? Effect.succeed([] as { requesterId: string; addresseeId: string }[])
            : Effect.tryPromise({
                try: () =>
                  db
                    .select({
                      requesterId: connections.requesterId,
                      addresseeId: connections.addresseeId,
                    })
                    .from(connections)
                    .where(
                      and(
                        eq(connections.status, "accepted"),
                        or(
                          inArray(connections.requesterId, myConnectionIds),
                          inArray(connections.addresseeId, myConnectionIds),
                        ),
                      ),
                    )
                    .limit(MAX_FOF_FANOUT_ROWS),
                catch: (cause) => new DatabaseError({ cause }),
              }),
          myOrgIds.length === 0
            ? Effect.succeed(
                [] as { profileId: string; organisationHandle: string; organisationName: string }[],
              )
            : Effect.tryPromise({
                try: () =>
                  db
                    .select({
                      profileId: organisationMembers.profileId,
                      organisationHandle: organisations.handle,
                      organisationName: organisations.name,
                    })
                    .from(organisationMembers)
                    .innerJoin(
                      organisations,
                      eq(organisations.id, organisationMembers.organisationId),
                    )
                    .where(inArray(organisationMembers.organisationId, myOrgIds))
                    .limit(MAX_ORG_COMEMBER_ROWS),
                catch: (cause) => new DatabaseError({ cause }),
              }),
        ],
        { concurrency: "unbounded" },
      );

      // Step 3: aggregate candidates.
      interface Candidate {
        mutualCount: number;
        organisationCount: number;
        sharedOrganisation: { handle: string; name: string } | null;
      }
      const candidates = new Map<string, Candidate>();
      const candidateFor = (id: string): Candidate => {
        const existing = candidates.get(id);
        if (existing) return existing;
        const fresh: Candidate = {
          mutualCount: 0,
          organisationCount: 0,
          sharedOrganisation: null,
        };
        candidates.set(id, fresh);
        return fresh;
      };

      for (const row of fofRows) {
        const isMutualRequester = myConnectionIdSet.has(row.requesterId);
        const isMutualAddressee = myConnectionIdSet.has(row.addresseeId);

        // Both sides are my connections — edge between two of my friends.
        if (isMutualRequester && isMutualAddressee) continue;

        const candidateId = isMutualRequester ? row.addresseeId : row.requesterId;

        if (excludeIds.has(candidateId)) continue;

        candidateFor(candidateId).mutualCount += 1;
      }

      for (const row of coMemberRows) {
        if (excludeIds.has(row.profileId)) continue;
        const candidate = candidateFor(row.profileId);
        candidate.organisationCount += 1;
        // First organisation wins as the label — one is all a card can show,
        // and `organisationCount` already carries the "how many" signal.
        candidate.sharedOrganisation ??= {
          handle: row.organisationHandle,
          name: row.organisationName,
        };
      }

      if (candidates.size === 0) return [];

      // Step 4: rank. Mutual connections outrank shared organisations; handle
      // breaks ties so the list is stable between requests.
      const sorted = [...candidates.entries()]
        .toSorted(
          ([idA, a], [idB, b]) =>
            b.mutualCount - a.mutualCount ||
            b.organisationCount - a.organisationCount ||
            (idA < idB ? -1 : idA > idB ? 1 : 0),
        )
        .slice(0, safeLimit);

      const candidateIds = sorted.map(([id]) => id);

      // Step 5: hydrate. The accounts join drops candidates whose account is
      // tombstoned (Art. 17 erasure pending) so a mid-deletion profile is
      // never suggested.
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
            .innerJoin(accounts, eq(users.accountId, accounts.id))
            .where(and(inArray(users.id, candidateIds), isNull(accounts.deletedAt))),
        catch: (cause) => new DatabaseError({ cause }),
      });

      const profileMap = new Map(profiles.map((p) => [p.id, p]));

      return sorted
        .map(([id, candidate]) => {
          const p = profileMap.get(id);
          if (!p) return null;
          return {
            handle: p.handle,
            displayName: p.displayName,
            avatarUrl: p.avatarUrl,
            mutualCount: candidate.mutualCount,
            reason:
              candidate.mutualCount > 0
                ? ("mutual_connections" as const)
                : ("shared_organisation" as const),
            sharedOrganisation: candidate.sharedOrganisation,
          };
        })
        .filter((s): s is Suggestion => s !== null);
    }).pipe(Effect.withSpan("recommendations.suggest_connections"));

  /**
   * Autocomplete-oriented people search over handle and display name.
   *
   * Two-phase by design. The left-anchored handle prefix match is the common
   * typeahead case and rides the `users_handle_idx` B-tree; the unanchored
   * `%q%` scan over handle + display name only runs when the anchored pass
   * couldn't fill the page, so the table scan is the exception rather than
   * every keystroke.
   *
   * Privacy: results carry nothing beyond the public profile fields plus the
   * caller's *own* connection state with each result — the same thing
   * `GET /graph/connections/:handle` already reports per handle, batched. No
   * mutual counts here: unlike suggestions (where the candidate is already
   * adjacent in the caller's graph), search takes an arbitrary handle, and
   * answering "how many mutuals" for arbitrary handles is a graph-inference
   * oracle (cf. `wiki/TODO.md` S-L4).
   */
  const searchProfiles = (
    profileId: string,
    rawQuery: string,
    limit = 8,
  ): Effect.Effect<ProfileSearchResult[], DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 8, 1), 20);

      const query = normaliseQuery(rawQuery);
      // Below the minimum we return an empty list rather than an error — a
      // single keystroke shouldn't be a 4xx, and the empty result is what keeps
      // the enumeration surface small.
      if (query.length < MIN_SEARCH_QUERY_LENGTH) return [];

      const escaped = escapeLike(query);
      const prefixPattern = `${escaped}%`;
      const containsPattern = `%${escaped}%`;
      const overfetch = safeLimit * SEARCH_OVERFETCH_FACTOR;

      const selectMatching = (where: ReturnType<typeof and>, rows: number) =>
        Effect.tryPromise({
          try: () =>
            db
              .select({
                id: users.id,
                handle: users.handle,
                displayName: users.displayName,
                avatarUrl: users.avatarUrl,
              })
              .from(users)
              .innerJoin(accounts, eq(users.accountId, accounts.id))
              .where(and(isNull(accounts.deletedAt), ne(users.id, profileId), where))
              .orderBy(asc(users.handle))
              .limit(rows),
          catch: (cause) => new DatabaseError({ cause }),
        });

      // Blocks are excluded in application code: the block set is unbounded, so
      // binding it into a SQL `NOT IN` risks SQLite's 999-variable ceiling.
      const [prefixRows, blockRows] = yield* Effect.all(
        [
          selectMatching(and(sql`${users.handle} LIKE ${prefixPattern} ESCAPE '\\'`), overfetch),
          Effect.tryPromise({
            try: () =>
              db
                .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
                .from(blocks)
                .where(or(eq(blocks.blockerId, profileId), eq(blocks.blockedId, profileId))),
            catch: (cause) => new DatabaseError({ cause }),
          }),
        ],
        { concurrency: "unbounded" },
      );

      const blockedIds = new Set(
        blockRows.map((r) => (r.blockerId === profileId ? r.blockedId : r.blockerId)),
      );

      const matches = new Map<string, (typeof prefixRows)[number]>();
      for (const row of prefixRows) {
        if (!blockedIds.has(row.id)) matches.set(row.id, row);
      }

      // Second pass only when the cheap anchored match under-filled the page.
      if (matches.size < safeLimit) {
        const containsRows = yield* selectMatching(
          and(
            or(
              sql`${users.handle} LIKE ${containsPattern} ESCAPE '\\'`,
              sql`${users.displayName} LIKE ${containsPattern} ESCAPE '\\'`,
            ),
          ),
          overfetch,
        );
        for (const row of containsRows) {
          if (!blockedIds.has(row.id)) matches.set(row.id, row);
        }
      }

      if (matches.size === 0) return [];

      // Rank: exact handle, then handle prefix, then display-name prefix, then
      // anything else that merely contains the query. Handle breaks ties.
      const rankOf = (row: { handle: string; displayName: string | null }): number => {
        const display = row.displayName?.toLowerCase() ?? "";
        if (row.handle === query) return 0;
        if (row.handle.startsWith(query)) return 1;
        if (display.startsWith(query)) return 2;
        if (row.handle.includes(query)) return 3;
        return 4;
      };

      const ranked = [...matches.values()]
        .toSorted((a, b) => rankOf(a) - rankOf(b) || (a.handle < b.handle ? -1 : 1))
        .slice(0, safeLimit);

      // Batch the caller's connection state across the page — one query for the
      // whole result set rather than one per row.
      const edgeRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              requesterId: connections.requesterId,
              addresseeId: connections.addresseeId,
              status: connections.status,
            })
            .from(connections)
            .where(
              or(
                and(
                  eq(connections.requesterId, profileId),
                  inArray(
                    connections.addresseeId,
                    ranked.map((r) => r.id),
                  ),
                ),
                and(
                  eq(connections.addresseeId, profileId),
                  inArray(
                    connections.requesterId,
                    ranked.map((r) => r.id),
                  ),
                ),
              ),
            ),
        catch: (cause) => new DatabaseError({ cause }),
      });

      const stateById = new Map<string, SearchConnectionState>();
      for (const row of edgeRows) {
        const otherId = row.requesterId === profileId ? row.addresseeId : row.requesterId;
        stateById.set(
          otherId,
          row.status === "accepted"
            ? "connected"
            : row.requesterId === profileId
              ? "pending_sent"
              : "pending_received",
        );
      }

      return ranked.map((row) => ({
        handle: row.handle,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        connectionStatus: stateById.get(row.id) ?? "none",
      }));
    }).pipe(Effect.withSpan("recommendations.search_profiles"));

  return { suggestConnections, searchProfiles };
}

export type RecommendationService = ReturnType<typeof createRecommendationService>;
