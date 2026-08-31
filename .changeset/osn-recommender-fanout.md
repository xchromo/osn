---
"@osn/api": patch
"@osn/client": patch
---

Connection recommendations (`GET /recommendations/connections`):

- **Fixed** (osn-tracker#574): the organisation co-member fan-out was one query
  bounded by a single global row cap, ordered by organisation id — so whichever
  organisation the caller happened to belong to sorted first absorbed the whole
  budget, and every other organisation contributed nothing, permanently (50
  organisations of 250 members each, only ~8 ever won). The fan-out is now one
  statement, a `UNION ALL` of a per-organisation subselect each bounded by its
  own share of the budget, so every organisation the caller belongs to
  contributes candidates.
- Added `generatedAt` (ISO 8601) to the response, alongside `suggestions`, so a
  client can tell how fresh a list is (osn-tracker#311, timestamp half only —
  the cache half is a separate, undecided change). `@osn/client`'s
  `suggestConnections` return type carries the new field.
