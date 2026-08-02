---
"@osn/api": patch
---

Add `GET /graph/internal/connection-search` — ARC `graph:read`, returns one
profile's own **accepted** connections (handle-prefix OR display-name substring
match, tombstoned accounts excluded, ordered by handle, capped at 10). Backs
cire's connection-aware co-host autocomplete. Unlike `/profile-search` it has no
minimum query length and treats an empty query as "first page of connections",
because the result set is bounded by one profile's graph — a list that profile
can already read via the user-facing `GET /graph/connections` — rather than by
the handle namespace.
