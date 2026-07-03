---
"@osn/api": patch
---

Key the account-erasure rate limiter on the spoofing-safe client IP.

The `/account` erasure routes derived their per-IP limiter key with the
deprecated no-arg `getClientIp(headers)` — the client-controlled left-most
`x-forwarded-for`, letting an attacker rotate the header for a fresh bucket on
every request. They now use the same hardened `getClientIp(headers, {
...clientIpConfig, socketIp })` path (with `cf-connecting-ip` trust and
fail-closed `isUnresolvedIp` deny) as the auth and profile routes, threaded
through from `app.ts`. (Moving these limiters to the Redis backend for
cluster-safety remains a separate follow-up; `DELETE /account` is additionally
gated by a fresh step-up token + verbatim handle confirmation.)
