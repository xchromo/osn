---
"@osn/api": patch
---

Refactor (no behaviour change): begin splitting the ~4,500-line `auth.ts`.

First slice — extract the pure, state-free helpers (ID/token/OTP generation,
JWT sign/verify, and the boundary schemas) into `services/auth-helpers.ts`.
`auth.ts` imports them and re-exports the externally-consumed ones (`genId`,
`hashSessionToken`, `HandleSchema`) so `../services/auth` stays the stable
barrel. Byte-identical behaviour; all 714 `@osn/api` tests unchanged and green.
See `[[auth-service-refactor]]`.
