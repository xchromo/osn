---
title: Social Graph
aliases:
  - connections
  - graph service
  - relationships
tags:
  - systems
  - social
  - identity
status: current
related:
  - "[[pulse-close-friends]]"
  - "[[s2s-patterns]]"
  - "[[osn-core]]"
  - "[[event-access]]"
packages:
  - "@osn/api"
  - "@osn/db"
last-reviewed: 2026-08-02
---

# Social Graph

The social graph is OSN's core relationship system. It manages connections and blocks between users. All graph logic lives in `@osn/api` with the schema in `@osn/db`.

> **Close friends moved to Pulse.** OSN core no longer owns a close-friends list — each app that wants one owns its own table and validates membership against this graph. See [[pulse-close-friends]].

## Relationship Types

### Connections (bidirectional)

A connection is a mutual relationship between two users. It requires both parties to agree.

**Flow:** request -> accept/decline/cancel

- Either user can send a connection request
- The recipient can accept or decline
- The sender can cancel a pending request
- Either party can remove an accepted connection

### Blocks (unidirectional)

A block is a one-way action. When A blocks B:
- The block removes any existing connection between A and B (wrapped in a DB transaction after P-W17)
- B cannot send connection requests to A
- Blocks are global across all OSN apps today (per-app blocking is a deferred decision)

The `is-blocked` route only checks whether the caller has blocked the target (`isBlocked(caller, target)`) -- it does not reveal whether the target has blocked the caller (S-M15).

## Architecture

```
osn/api/src/services/graph.ts     # Graph service (Effect-based)
osn/api/src/routes/graph.ts       # Graph routes (Elysia)
osn/db/src/schema.ts               # connections, blocks tables
```

The graph service exports functions like:
- `sendConnectionRequest`, `acceptConnection`, `declineConnection`, `cancelConnection`, `removeConnection`
- `blockProfile`, `unblockProfile`, `isBlocked`, `eitherBlocked`
- `getConnections`, `getPendingRequests`, `getBlocks`

## Test Coverage

Tests covering services and routes. Test areas include:
- Connection lifecycle (request, accept, decline, cancel, remove)
- Block behaviour (directional checks)
- Rate limiting on graph write endpoints
- Error handling (not found, already exists, self-referential operations)
- Input validation (handle regex, length bounds via TypeBox `HandleParam`)

## Rate Limiting

All graph write endpoints are rate-limited at 60 requests per user per minute (S-M16). Graph routes accept injected rate-limiter instances -- part of the [[redis]] migration Phase 1 abstraction work.

## Cross-Package Access

Other packages (notably `@pulse/api`) access the social graph through `graphBridge.ts` -- see [[s2s-patterns]] for the full pattern. The bridge exports:

- `getConnectionIds(profileId)` -- accepted connections set
- `getProfileDisplays(profileIds[])` -- batched profile metadata join

Apps that own a close-friends-style list (e.g. Pulse — see [[pulse-close-friends]]) call `getConnectionIds` to validate eligibility when adding a friend.

## Error Handling

Graph routes use `safeError()` so that only `GraphError` and `NotFoundError` messages reach clients (S-M17). Raw DB/Effect errors never leave the server. Error objects logged via `Effect.logError` go through `safeErrorSummary()` which extracts only `_tag` + `message` (S-L9).

## Input Validation

The `:handle` route parameter uses TypeBox `HandleParam` with regex + length bounds (S-M18). This prevents injection and ensures handles conform to the reservation rules.

## Performance Notes

- N+1 queries in graph list functions replaced with `inArray` batch fetches (P-W6)
- `eitherBlocked` collapsed from two sequential `isBlocked` calls to a single OR query (P-W7)
- `blockProfile` replaced SELECT-then-DELETE with direct `DELETE WHERE OR` (P-W8)
- `removeConnection` and `blockProfile` wrapped in DB transactions (P-W17)

## Recommendations (contact suggestions)

`createRecommendationService().suggestConnections()` powers the "Suggested for you" surface on the `@osn/social` Discover page. Two signals feed it — mutual connections (the stronger one) and shared organisations (the one a brand-new account actually has):

1. Read the caller's own edges (**any** status, capped at 1 000 rows), blocks in both directions, and organisation memberships (capped at 50) — concurrently.
2. Build the exclusion set: self, every counterpart on an existing edge, and everyone blocked either way. Pending edges count, so a request already in flight never resurfaces as a suggestion whose Connect button would fail with "Connection already exists".
3. Fan out twice, each branch skipped when its seed set is empty:
   - **Friends-of-friends** — accepted connections of the caller's first 500 accepted connections, capped at **10 000 rows**.
   - **Organisation co-members** — members of the caller's organisations, capped at **2 000 rows**.
4. Tally `mutualCount` and shared organisations per candidate in JS with an O(1) `Set` on the caller's direct connections.
5. Rank by mutual count desc, then shared-organisation count desc, then profile ID (stable ties). Slice to `limit` (bounded `[1, 50]` at the HTTP boundary).
6. Hydrate the top N via `users ⋈ accounts WHERE deleted_at IS NULL`, so a tombstoned account is never suggested.

Each suggestion carries a `reason` (`mutual_connections` | `shared_organisation`) naming the strongest signal, plus `sharedOrganisation` as card context when there is one. `reason` is what the Discover card turns into "3 mutual connections" or "Also in Acme Inc".

Current shape prioritises correctness + bounded cost over peak throughput. Next steps tracked in `wiki/TODO.md`:

- **P-W6** — short-lived per-caller cache (5-15 min) so a Discover-page visit doesn't re-run the pipeline.
- **P-W7** — push aggregation to SQL (`GROUP BY … ORDER BY … LIMIT`) and add compound indexes `connections(status, requester_id)` / `connections(status, addressee_id)`.

Privacy: the endpoint returns `mutualCount` alongside each suggestion. This leaks graph-inference signal — see `wiki/TODO.md` → S-L4 for the bucketing follow-up.

Rate-limited at 20 req/user/min via `createRedisRecommendationRateLimiters().suggest` — see [[rate-limiting]].

## People search (autocomplete)

`searchProfiles()` backs `GET /recommendations/search?q=&limit=`, the typeahead behind the Discover search box. It is the **user-facing** sibling of the ARC-gated `/graph/internal/profile-search` (co-host autocomplete); the two share the same guardrails but not the same auth.

- **Normalisation** — trim, strip a leading `@`, lowercase. `users.handle` is stored lowercase, so `@Alice` and `alice` are the same search. LIKE wildcards (`%`, `_`) in the typed query are escaped so an underscore in a handle matches literally.
- **Minimum length 2** — shorter queries return an empty list, never a 4xx. Same friction social apps put on @-mention autocomplete: it stops one keystroke walking the handle namespace.
- **Two phases** — the left-anchored `handle LIKE 'q%'` pass rides the `users_handle_idx` B-tree and answers the common case. Only when it under-fills the page does the unanchored `%q%` pass over handle + display name run, so the table scan is the exception rather than every keystroke.
- **Ranking** — exact handle, handle prefix, display-name prefix, handle infix, then display-name infix; handle breaks ties.
- **Exclusions** — self, tombstoned accounts (`accounts.deleted_at IS NULL` join), and anyone blocked in either direction. Blocks are filtered in application code over an over-fetched candidate set rather than bound into a SQL `NOT IN`, which would risk SQLite's 999-variable ceiling.
- **Connection state** — each result carries the caller's own state with it (`none` / `pending_sent` / `pending_received` / `connected`), batched in one query for the whole page, so the UI renders Connect / Accept / Requested / Connected without a request per row. This is the same fact `GET /graph/connections/:handle` already reports per handle — no new disclosure, just fewer round trips.
- **No mutual counts.** Deliberate: suggestions describe profiles already adjacent to the caller's graph, but search takes an *arbitrary* handle, and answering "how many mutuals" for arbitrary handles is a graph-inference oracle (cf. S-L4).

Rate-limited at 60 req/user/min via `createRedisRecommendationRateLimiters().search` — looser than the suggestion budget because typeahead fires once per debounced keystroke, and a 20/min budget would 429 a user mid-word. The client debounces 250 ms and aborts superseded requests.

## Source Files

- [osn/api/src/services/graph.ts](../../osn/api/src/services/graph.ts) -- graph service
- [osn/api/src/services/recommendations.ts](../../osn/api/src/services/recommendations.ts) -- contact suggestions + people search
- [osn/api/src/routes/graph.ts](../../osn/api/src/routes/graph.ts) -- graph routes
- [osn/api/src/routes/recommendations.ts](../../osn/api/src/routes/recommendations.ts) -- `/recommendations/connections` + `/recommendations/search`
- [osn/social/src/components/PeopleSearch.tsx](../../osn/social/src/components/PeopleSearch.tsx) -- search combobox (debounce, abort, keyboard nav)
- [osn/db/src/schema.ts](../../osn/db/src/schema.ts) -- schema (connections, blocks)
- [osn/api/tests/services/graph.test.ts](../../osn/api/tests/services/graph.test.ts) -- service tests
- [osn/api/tests/services/recommendations.test.ts](../../osn/api/tests/services/recommendations.test.ts) -- recommendations tests
- [osn/api/tests/routes/graph.test.ts](../../osn/api/tests/routes/graph.test.ts) -- route tests
