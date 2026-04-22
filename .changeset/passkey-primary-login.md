---
"@osn/api": major
"@osn/client": major
"@osn/ui": major
"@shared/observability": minor
"@pulse/app": patch
"@osn/social": patch
---

Passkey-primary login (M-PK). WebAuthn (passkey or security key) is the only primary login factor. OTP and magic-link primary login, and the `enrollmentToken` JWT machinery, have been removed. Registration is WebAuthn-gated and first-credential enrollment is mandatory; `deletePasskey` refuses unconditionally if it would leave zero credentials. The "Lost your passkey?" path (recovery codes) is the single escape hatch.

**Breaking — @osn/api**

- Removed routes: `POST /login/otp/begin`, `POST /login/otp/complete`, `POST /login/magic/begin`, `POST /login/magic/verify`.
- Removed service methods: `beginOtp`, `completeOtpDirect`, `beginMagic`, `verifyMagicDirect`, `issueEnrollmentToken`, `verifyEnrollmentToken`.
- `/passkey/register/{begin,complete}` now authenticates via the normal access token; enrollment tokens are gone.
- `/register/complete` response drops `enrollment_token`.
- `AuthConfig` drops `magicLinkBaseUrl` and `magicTtl`. `AuthRateLimiters` drops `otpBegin`, `otpComplete`, `magicBegin`.
- `deletePasskey` refuses to drop below 1 passkey regardless of recovery-code state (previously allowed if recovery codes existed).
- WebAuthn registration options use `residentKey: "preferred"` + `userVerification: "preferred"` to accept FIDO2 security keys.

**Breaking — @osn/client**

- `LoginClient` now only exposes `passkeyBegin` / `passkeyComplete`. `otpBegin`, `otpComplete`, `magicBegin`, `magicVerify` removed.
- `CompleteRegistrationResult` no longer contains `enrollmentToken`.
- `RegistrationClient.passkeyRegisterBegin` / `passkeyRegisterComplete` now take `accessToken` instead of `enrollmentToken`.

**Breaking — @osn/ui**

- `<SignIn>` now requires a `recoveryClient: RecoveryClient` prop. The component is WebAuthn-only; it renders an informational screen when WebAuthn is unsupported, and exposes a "Lost your passkey?" link into `<RecoveryLoginForm>`.
- `<Register>` is WebAuthn-gated. No flow path exists without WebAuthn support, and the "Skip for now" button is gone.
- `<MagicLinkHandler>` deleted.

**@shared/observability (minor)**

- `AuthMethod` narrowed to `"passkey" | "recovery_code" | "refresh"`.
- `AuthRateLimitedEndpoint` dropped `otp_begin`, `otp_complete`, `magic_begin`.

**@pulse/app / @osn/social (patch)**

- Pass a `recoveryClient` into `<SignIn>`; `<MagicLinkHandler>` removed from the root layout.
