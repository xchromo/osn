---
"@osn/api": patch
---

Refactor the auth service monolith (`services/auth.ts`, ~4,500 lines) into a `services/auth/` module directory: domain factories (profiles, registration, tokens, passkeys, passkey management, profile switch, sessions, recovery, security events, step-up, email change, cross-device) composed over a shared `AuthContext` by `index.ts`. Public surface, import paths, and behaviour are unchanged; the three duplicated security-notification mailers collapse into one shared helper.
