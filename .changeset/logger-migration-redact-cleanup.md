---
"@osn/core": patch
"@shared/observability": patch
---

Migrate dev-mode `console.log` of registration OTP, login OTP, and magic-link
URL in `osn/core/src/services/auth.ts` to `Effect.logDebug` (S-H21). The values
stay interpolated into the message string so the redacting logger doesn't scrub
them — the whole point of these dev branches is to expose the code/URL to the
developer.

Trim the redaction deny-list in `@shared/observability` to only the keys that
correspond to real object properties in the codebase today (`authorization`,
the OAuth token fields, the WebAuthn `assertion` body, ARC `privateKey`, and
the user PII fields `email` / `handle` / `displayName`). Removes ~30
speculative entries (Signal/E2E keys, password fields, address/SSN/etc.) that
were never reached. Adds a documented criteria block at the top of `redact.ts`
explaining when to add or remove keys, and a lock-step assertion in
`redact.test.ts` so any future change has to update both files together.
