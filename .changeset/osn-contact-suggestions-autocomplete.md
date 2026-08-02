---
"@osn/api": minor
"@osn/client": minor
"@osn/social": minor
---

Contact suggestions and search autocomplete in OSN Social. The Discover page
gains a people-search box that suggests as you type, and its suggestion cards
now say why each person is being suggested.

- `@osn/api`: new `GET /recommendations/search?q=&limit=` — autocomplete over
  handle and display name. Two-phase by design: the left-anchored
  `handle LIKE 'q%'` pass rides `users_handle_idx` and answers the common
  keystroke, and the unanchored `%q%` pass over handle + display name runs only
  when that under-fills the page, so the table scan is the exception rather
  than every keystroke. Queries are normalised (trim, strip `@`, lowercase) and
  LIKE-escaped so an underscore in a handle matches literally; anything under
  two characters returns an empty list rather than a 4xx. Self, tombstoned
  accounts and profiles blocked in either direction are excluded. Each result
  carries the caller's own connection state (`none` / `pending_sent` /
  `pending_received` / `connected`), batched in one query for the whole page —
  the same fact `GET /graph/connections/:handle` already reports per handle, so
  no new disclosure. Deliberately no mutual counts: search takes an arbitrary
  handle, and answering "how many mutuals" for arbitrary handles is a
  graph-inference oracle.
- `@osn/api`: `suggestConnections` gains organisation co-members as a second
  signal, so an account with no connections yet has something to act on — FOF
  alone returns nothing until the first connection is accepted. Suggestions now
  carry a `reason` (`mutual_connections` | `shared_organisation`) naming the
  strongest signal plus the shared organisation as card context, and rank by
  mutual count, then shared-organisation count, then profile id for stable
  ties. Two fixes fell out of the rework: an edge in *any* state now excludes a
  candidate (a pending request used to keep the person in Discover behind a
  Connect button that could only fail with "Connection already exists"), and
  the hydrate step joins `accounts` so a profile mid-erasure is never
  suggested.
- `@osn/api`: the recommendations route factory now takes a
  `RecommendationRateLimiters` pair instead of a single backend —
  `createRedisRecommendationRateLimiters` supplies `recs:read` at 20/user/min
  for the fan-out and `recs:search` at 60/user/min for typeahead, which fires
  once per debounced keystroke and would otherwise 429 a user mid-word. Both
  stay per-user and fail-closed.
- `@osn/client`: `createRecommendationClient` gains `searchProfiles`, which
  takes an `AbortSignal` so a caller can cancel a superseded keystroke;
  `Suggestion` gains `reason` and `sharedOrganisation`.
- `@osn/social`: new `PeopleSearch` component on the Discover page, built as an
  ARIA combobox — arrow keys move `aria-activedescendant` without leaving the
  field, Enter acts on the active row (Connect, or Accept when they asked
  first), Escape closes. Input is debounced 250 ms, superseded requests are
  aborted, and a row's status flips locally on success rather than refetching
  and reordering the list under the cursor. Suggestion cards render the reason
  line ("3 mutual connections" / "Also in Acme Inc").
