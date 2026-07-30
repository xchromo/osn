---
"@osn/api": patch
"@osn/client": patch
"@osn/db": patch
"@osn/landing": patch
"@osn/social": patch
"@osn/ui": patch
"@pulse/api": patch
"@pulse/app": patch
"@pulse/db": patch
"@pulse/landing": patch
"@shared/crypto": patch
"@shared/db-utils": patch
"@shared/email": patch
"@shared/feature-flags": patch
"@shared/observability": patch
"@shared/osn-auth-client": patch
"@shared/rate-limit": patch
"@shared/redis": patch
"@shared/rp-auth": patch
"@shared/turnstile": patch
"@zap/api": patch
"@zap/db": patch
---

Refresh dependencies across the monorepo (routine maintenance audit).

Security-relevant: `@simplewebauthn/server` 13.3.0 → 13.3.2 closes
GHSA-6hxq-p678-4hr2 (CVSS v4 Low 2.0), where a maliciously-crafted attestation
`x5c` could present a self-signed "root certificate" rather than chaining to an
RP-specified trust anchor. Reached through `verifyRegistrationResponse()` on the
passkey registration path; exposure was limited because that call site uses
`attestationType: "none"` with no `rootCertificates`. Tracked as S-L102.

Also of note: `jose` 6.2.3 → 6.2.4 tightens JOSE/JWT validation (Base64URL
alphabet, UTF-8 in headers and claims, truncated ASN.1 key data, duplicate
`crit`), which both ARC tokens and access JWTs sit on top of.

`effect` 3.21.2 → 3.22.0 (deprecates `Graph.neighborsDirected`, unused here),
with `@effect/vitest` 0.29 → 0.30 and `@effect/opentelemetry` 0.63 → 0.64
following its `^3.22.0` peer. `@effect/platform` is now an explicit
`@shared/observability` dependency at `^0.97.0`: it was previously auto-installed
at 0.94.5 purely to satisfy `@effect/opentelemetry`'s peer and did not actually
meet it.

`oxlint` 1.70 → 1.76 makes `vitest/expect-expect` effective inside `it.effect`
bodies for the first time — the rule was already configured with
`additionalTestBlockFunctions`, but earlier versions never walked those blocks.
Ten `@osn/api` tests (of 644) were relying on "the Effect didn't fail" as their
only assertion; each now asserts the behaviour its name claims, with no change
to what is under test.

Everything else is a patch/minor bugfix bump with no migration steps.
