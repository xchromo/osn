# A3 notes — OSNAuth passkey clients

## Verified

- `swift build`/`swift test` clean on macOS host: full run 32 tests, 7
  suites, 0 failures, no regression to OSNKit/PulseAPI tests.
- Base64url round-trip tested at both padding lengths (`Base64URLTests`).
- `/login/passkey/complete` body encodes exactly one of
  `identifier`/`challengeId` (`PasskeyCompleteRequestBodyTests`).
- `SingleResumeContinuation` resumes exactly once; a second
  `resume(returning:)`/`resume(throwing:)` is a no-op
  (`SingleResumeContinuationTests`).
- `ASAuthorizationError.canceled` maps to `PasskeyCeremonyError.cancelled`,
  distinct from `.underlying` (`PasskeyCeremonyErrorTests`).
- Successful `PasskeyLoginClient.complete` persists the access token to
  `KeychainAccessTokenStore` with the server's `expires_in`, and the
  rotated `osn_session` cookie is confirmed present in the session's
  cookie storage afterward (`PasskeyLoginClientTests`).
- A complete response missing the rotated cookie throws
  `OSNKitError.sessionCookieNotPersisted` and does not write to Keychain.
- RP ID is read from the server's begin-response payload in
  `PasskeyLoginClient`/`PasskeyEnrollmentClient`/`StepUpPasskeyClient` —
  grepped, no hardcoded `musubi.social` in ceremony code.
- Every OSNAuth request runs through the shared `URLSession` /
  `SharedCookieJar` — no client constructs its own session or cookie
  storage.

## Not verified

- No device/simulator run of an actual passkey ceremony (`ASAuthorizationController`
  end to end) — only unit-level coverage of the surrounding plumbing
  (encoding, continuation, error mapping, token persistence). The
  ceremony call itself is exercised by test doubles, not a real
  authenticator.
- No confirmation against a live `osn-api` deployment that the request/
  response shapes match byte-for-byte in production — types were built
  from the brief's stated shapes, not from a captured live payload.
- Xcode build of the Pulse target with the new entitlements has not been
  run (would fail regardless — see BLOCKED below) — `swift build`/`swift test`
  only exercise the SPM package, not the Xcode project XcodeGen would
  generate.

## BLOCKED

- `pulse/ios/project.yml`: `com.apple.developer.associated-domains`
  (`webcredentials:musubi.social`) and App Group
  `group.social.musubi.session` are declared in the entitlements block
  but neither capability is registered in the Apple developer portal.
  Xcode codesigning of the Pulse target will fail until both are added
  there.
