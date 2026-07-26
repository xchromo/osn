---
"@osn/client": minor
"@osn/social": minor
---

OIDC consent screen. `@osn/client` gains `createAuthorizeClient` — two credentialed calls (`getContext`, `submitDecision`) against the parked authorize request, with an `AuthorizeError` that says whether the request is dead or whether signing in again fixes it. `@osn/social` gains the `/authorize` page it drives: client card, humanised scopes, profile picker when there is a real choice, and a `login_required` loop that holds the user's answer, re-authenticates and replays it against the same request id. The page runs on a bare layout with no navigation out of the flow, and ships `frame-ancestors 'none'` so a consent screen can never be framed.
