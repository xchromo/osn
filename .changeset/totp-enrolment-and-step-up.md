---
"@shared/crypto": minor
"@shared/observability": minor
"@shared/redis": minor
"@shared/email": minor
"@osn/db": minor
"@osn/api": minor
"@osn/client": minor
---

TOTP enrolment, verification and disable on osn-api

An account can now enrol an authenticator app, use it to satisfy a step-up
ceremony, and remove it. TOTP is a step-up factor only — it is not a login
factor, and passkeys remain the sole primary one.

The shared secret is the one credential in the schema that cannot be hashed,
because RFC 6238 verification needs the raw HMAC key back. It is AES-256-GCM
encrypted under a new `OSN_TOTP_ENCRYPTION_KEY` Worker secret, with the account
id as additional authenticated data. **osn-api refuses to boot in a deployed
tier without that secret**, so it has to be provisioned before this ships;
local dev generates an ephemeral key, exactly as the JWT signing pair does.

`verifyTotpCode` in `@shared/crypto/totp` now returns the step it matched
(`{ step } | null`) rather than a boolean. RFC 6238 §5.2 single use is not
enforceable without it, and the alternative — refusing every code for the rest
of the drift window after a success — would fail a legitimate second ceremony
ninety seconds later. Breaking, and free: nothing outside its own test consumed
it.

Also: a `totp` AMR value, `totp_enroll` and `totp_disable` step-up purposes,
`totp_enrolled` / `totp_disabled` security events and notification emails, five
new rate-limiter slots, a `TotpClient` in `@osn/client`, and a `totp` section in
the DSAR export. `passkeyDeleteAllowedAmr` stays WebAuthn-only and the
email-change gate keeps its own allow-list, so neither admits TOTP.
