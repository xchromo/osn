---
"@shared/db-utils": minor
"@osn/api": minor
"@osn/client": patch
"@osn/social": minor
---

Rank OSN search on social proximity and name tokens, not text alone

`GET /recommendations/search` now follows the tiering Facebook's typeahead
describes — retrieve the caller's own graph first, then the global index, then
score the whole candidate set before slicing.

- **New retrieval pass over the caller's own edges.** An index seek on the
  connection indexes joined to `users`, capped at 50 rows. It is a recall
  guarantee, not a duplicate: every global pass is `ORDER BY handle LIMIT
  overfetch`, so a common prefix filled the window with whoever sorted
  alphabetically first and a connection could be missed entirely regardless of
  ranking. Organisation search gained the same pass over the caller's own
  memberships.
- **Ranking is text score + proximity score**, summed, computed before the page
  is sliced rather than after. Connections, then pending requests, then
  co-members of an organisation the caller belongs to, outrank strangers on the
  same text tier. Friends-of-friends is deliberately excluded: nothing exposes
  another profile's connection list, so ordering by mutuals would be the same
  graph-inference oracle that keeps `mutualCount` out of the payload.
- **Name-token prefix is now its own tier**, above handle infix. `"smith"` used
  to score `"Roberta Smith"` as a name infix — indistinguishable from
  `"Blacksmith Ltd"` and ranked below `@blacksmith`.
- **Multi-word queries work.** Tokens are matched independently, so
  `"Smith, John"` and `"smi joh"` both find `John Smith`, and the tokens are
  rejoined to spell the handle they imply, so `"john smith"` seeks `@johnsmith`
  on the index instead of skipping the seek on account of the space.
- **The minimum query length is 1**, down from 2. What a character reaches still
  widens in steps: 1 searches only the caller's own connections and
  organisations, 2 unlocks the global handle seek, 3 unlocks name matching.
- The three post-retrieval probes (blocks, connection state, shared
  organisations) now run concurrently, so the request has one fewer sequential
  database step than before despite the added signal.

`@shared/db-utils/search` gains `tokeniseQuery`, `joinTokens` and
`tokensPrefixName`. The tokeniser deliberately does not split on `_`, which is a
legal handle character — splitting there would match `@joxsmith` for a typed
`@jo_smith` and undo the literal-underscore matching `escapeLike` provides.

No change to the response shape of either search surface.
