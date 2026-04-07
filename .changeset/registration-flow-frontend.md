---
"@osn/core": minor
"@osn/client": minor
"@osn/pulse": minor
---

Add an email-verified registration flow end-to-end.

- **`@osn/core`:** New `POST /register/begin` and `POST /register/complete` endpoints. `/register/begin` validates the email + handle, checks they are both free, and sends a 6-digit OTP without creating any DB rows. `/register/complete` verifies the OTP, then creates the user and returns a short-lived authorization code that can be exchanged at `/token` for a session. The legacy `POST /register` endpoint (which created users without verifying email ownership) is left in place for now.
- **`@osn/client`:** New `createRegistrationClient` plain-fetch helper exposing `checkHandle`, `beginRegistration`, `completeRegistration`, `passkeyRegisterBegin`, `passkeyRegisterComplete`, and `exchangeAuthCode`. The Solid `AuthProvider` gains an `adoptSession` method for persisting a session obtained out-of-band by the registration flow.
- **`@osn/pulse`:** New `Register` component implementing the multi-step UI: email + handle + display name (with debounced live availability check against `/handle/:handle`) → 6-digit OTP entry → passkey enrolment via `@simplewebauthn/browser` → automatic sign-in. Wired into `EventList` as a "Create account" button next to "Sign in with OSN".
