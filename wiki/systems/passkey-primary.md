---
title: Passkey-Primary Login (M-PK)
tags: [auth, passkey, webauthn, security-key, login]
related:
  - "[[identity-model]]"
  - "[[sessions]]"
  - "[[recovery-codes]]"
  - "[[step-up]]"
packages:
  - "@osn/api"
  - "@osn/client"
  - "@osn/ui"
last-reviewed: 2026-04-22
---

# Passkey-Primary Login

OSN accepts exactly one primary login factor: a WebAuthn credential — either a
platform passkey (Face ID / Touch ID / Windows Hello / Android screen lock)
or a roaming security key (FIDO2 Yubikey etc.). OTP and magic-link primary
login have been removed; OTP survives as the step-up and email-change
verification factor.

## Account-level invariant

**Every live account has ≥1 WebAuthn credential at all times.** The invariant
holds cradle-to-grave:

- **Registration.** `/register/complete` returns a session, but the UI
  refuses to dismiss the registration flow until `/passkey/register/complete`
  succeeds. There is no "skip for now" button.
- **Deletion.** `deletePasskey` refuses unconditionally if the delete would
  drop the account below 1 passkey (`osn/api/src/services/auth.ts`). Recovery
  codes are NOT a substitute credential — they are the "my device is gone"
  escape hatch only.
- **Rotation.** Users who want to remove a compromised passkey enroll the
  replacement first, then delete the old one. No transitional states.

## Login surface

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /login/passkey/begin` | — | Issue WebAuthn options. Identifier-bound or identifier-less (discoverable). |
| `POST /login/passkey/complete` | — | Verify the assertion and issue a session. |
| `POST /login/recovery/complete` | — | Exchange identifier + recovery code for a session. Escape hatch. |

Client SDK surface (`@osn/client`):

- `LoginClient.passkeyBegin` / `passkeyComplete` — the only primary methods.
- `RecoveryClient.loginWithRecoveryCode` — the escape hatch.

UI surface (`@osn/ui/auth`):

- `<SignIn>` — WebAuthn-only. Renders a "Lost your passkey?" link that routes
  to `<RecoveryLoginForm>`. Feature-detects `browserSupportsWebAuthn()`; when
  false, shows a "passkey or security key required" screen that still lets
  the user enter a recovery code.
- `<Register>` — WebAuthn-gated. Registration is blocked at the start if the
  environment lacks WebAuthn support; completion is blocked until first-
  credential enrollment succeeds.

## Accepting security keys

`generateRegistrationOptions` uses `residentKey: "preferred"` +
`userVerification: "preferred"`:

- Modern platform passkeys still register as discoverable credentials with UV
  (the Copenhagen Book path).
- FIDO2 security keys without a resident-key slot register as non-
  discoverable — they work for identified login but not for the identifier-
  less (`/login/passkey/begin` with no identifier) flow.
- UP-only keys register without user verification.

The identifier-less login path keeps `userVerification: "required"` so the
ceremony's correctness does not depend on what happened at registration:
users who registered a UP-only key simply can't use the identifier-less
flow; the identified flow still works.

## WebAuthn-unsupported environments

`browserSupportsWebAuthn()` is checked on mount in both `SignIn.tsx` and
`Register.tsx`. When false:

- **Register** — shows an informational screen, blocks the flow.
  Registration on a WebAuthn-incapable device would produce an account with
  no credentials and is never allowed.
- **SignIn** — shows an informational screen with these escape paths:
  - Sign in on a WebAuthn-capable device.
  - Use the password-manager cross-device / QR (CaBLE / hybrid) flow.
  - Plug in a FIDO2 security key and reload.
  - Use a recovery code.

## Recovery flow

Unchanged contract: `POST /login/recovery/complete` returns a session
directly. The user can immediately add a new passkey from the authenticated
state. This is the one place the account-level invariant sees a "temporary"
relaxation: a recovery-login session whose user deleted their old passkey
on a different device before the recovery would technically have access
via only recovery codes — but because `deletePasskey` itself refuses to
leave 0, that state is unreachable in normal operation.

## What was removed

- **Routes**: `POST /login/otp/{begin,complete}`, `POST /login/magic/{begin,verify}`.
- **Service methods**: `beginOtp`, `completeOtpDirect`, `beginMagic`,
  `verifyMagicDirect`, `issueEnrollmentToken`, `verifyEnrollmentToken`.
- **In-memory state**: `otpStore`, `magicStore`, `consumedEnrollmentTokens`.
- **Config fields**: `magicLinkBaseUrl`, `magicTtl`.
- **Client SDK methods**: `LoginClient.otpBegin/otpComplete/magicBegin/magicVerify`;
  `CompleteRegistrationResult.enrollmentToken`; `passkeyRegisterBegin/Complete`
  now take `accessToken` instead of `enrollmentToken`.
- **UI components**: `@osn/ui/auth/MagicLinkHandler` (deleted).
- **Rate-limiter slots**: `otpBegin`, `otpComplete`, `magicBegin`.
- **Metrics**: `osn.auth.magic_link.sent`; `AuthMethod` union narrowed to
  `"passkey" | "recovery_code" | "refresh"`; `AuthRateLimitedEndpoint`
  dropped `otp_begin`, `otp_complete`, `magic_begin`.
