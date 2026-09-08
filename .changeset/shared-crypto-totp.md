---
"@shared/crypto": minor
---

RFC 6238 TOTP primitives on a new `@shared/crypto/totp` subpath: secret
generation, RFC 4648 base32 both ways, the `otpauth://` URI an authenticator
app scans, code derivation and verification. No new dependency — base32 is
forty lines and HMAC-SHA-1 is in WebCrypto, which Bun, Node and workerd all
carry.

The subpath is the point. `src/index.ts` does not re-export any of it, because
the barrel reaches `@osn/db` and `drizzle-orm` through the ARC helpers, and a
caller deriving six digits should not load a database driver to do it. The
module imports `./timing-safe` and nothing else, and a test resolves
`@shared/crypto/totp` through the package's own `exports` map so a typo in that
map fails the suite rather than the first consumer.

Correctness rests on published vectors rather than on ones we chose: RFC 4226
Appendix D counters 0 to 9, all six SHA-1 rows of RFC 6238 Appendix B, and the
RFC 4648 §10 base32 strings in both directions. The base32 vectors earn their
place — a codec that is self-consistent but wrong, bits regrouped the wrong way
or the alphabet permuted, passes every round-trip test and is first noticed by
an authenticator app at enrolment.

`verifyTotpCode` derives every candidate in the drift window and compares all
of them with `timingSafeEqualString`, with no early return, so a valid and an
invalid six-digit code do the same work. It never throws: a malformed code, a
secret under RFC 4226's 128-bit floor, and an unusable date are all `false`,
and the drift window is clamped at both ends so a caller cannot choose how much
CPU one verification spends. `base32Decode` validates before it case-folds —
uppercasing maps `ß` to `SS` and `ſ` to `S`, so the other order would admit
characters that are not in the alphabet — and its error message names no part
of its input, which is a secret.
