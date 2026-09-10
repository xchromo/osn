---
"@osn/api": patch
"@osn/ui": patch
"@pulse/api": patch
"@shared/crypto": patch
"@shared/osn-auth-client": patch
"@shared/redis": patch
"@zap/api": patch
---

Take the patch-tier dependency upgrades from the 2026-09-11 review: `jose`
6.2.10 → 6.2.12 (refactors and performance work on the JWS/JWE cores and JWKS
key-import path, no API change), `@elysiajs/openapi` 1.4.15 → 1.4.16 (additive
— OpenAPI 3.1, regex path scopes, `withHeaders` headers), `@kobalte/core`
0.13.13 → 0.13.14 (three bug fixes, including `aria-hidden` preserved during
modal handoff) and `@upstash/redis` 1.38.3 → 1.38.4 (CI-only changes upstream).

No source change. Full findings, including what was held and why, are in
`DEPS-REVIEW.md`.
