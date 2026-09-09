import type { JWK } from "jose";

import type { RecoveryLockoutStore } from "../../lib/recovery-lockout-store";
import type { RotatedSessionStore } from "../../lib/rotated-session-store";
import type { AccountCapLimiter, CeremonyStores, StepUpJtiStore } from "./stores";

export interface AuthConfig {
  /** RP ID for WebAuthn (e.g. "localhost" or "example.com") */
  rpId: string;
  /** Human-readable RP name */
  rpName: string;
  /**
   * Accepted WebAuthn origin(s) — a single origin or several (e.g. one per dev
   * frontend). Passed straight to @simplewebauthn's `expectedOrigin`, which
   * matches the ceremony's origin against the string or any member of the array.
   */
  origin: string | string[];
  /** Issuer URL (JWT issuer) */
  issuerUrl: string;
  /** ES256 private key for signing access and refresh tokens */
  jwtPrivateKey: CryptoKey;
  /** ES256 public key for verifying the above */
  jwtPublicKey: CryptoKey;
  /** Key ID (RFC 7638 thumbprint) — included in JWT headers and JWKS */
  jwtKid: string;
  /**
   * Public key as JWK object — served at /.well-known/jwks.json. Typed as
   * jose's `JWK` rather than `Record<string, unknown>` so the JWKS route can
   * declare a response schema: an `unknown` value satisfies no TypeBox type.
   */
  jwtPublicKeyJwk: JWK;
  /**
   * Access token TTL in seconds. Default: 300 (5 minutes).
   *
   * Short TTL caps the XSS blast radius on the access token — the one
   * auth secret that still lives in localStorage after C3. The refresh
   * token is in an HttpOnly cookie so transparent silent-refresh works
   * without the user noticing the rotation.
   */
  accessTokenTtl?: number;
  /** Refresh token TTL in seconds (default: 2592000 = 30 days) */
  refreshTokenTtl?: number;
  /** OTP TTL in seconds (default: 600 = 10 min). Applies to registration, email change, and step-up OTP. */
  otpTtl?: number;
  /**
   * Step-up (sudo) token TTL in seconds. Default: 300 (5 min). Short enough
   * that a stolen step-up JWT grants only a narrow window for sensitive
   * actions — same ceiling as an access token, same threat model.
   */
  stepUpTokenTtl?: number;
  /**
   * HMAC pepper used to hash session-issuing IP addresses into
   * `sessions.ip_hash`. Must be at least 32 bytes of unguessable material
   * in non-local envs — rotating it invalidates the display "same-subnet"
   * signal, but has no effect on session validity. When unset, IP hashes
   * are not recorded (dev mode).
   */
  sessionIpPepper?: string;
  /**
   * Permitted AMR ("authentication method reference") values for the
   * `/recovery/generate` step-up gate.
   *
   * The name understates its reach: this one set is read by FIVE verifiers —
   * `verifyStepUpForRecoveryGenerate`, `verifyStepUpForAccountDelete`
   * (`DELETE /account`), `verifyStepUpForAccountExport` (the DSAR export),
   * `verifyStepUpForExternalPurpose` (Pulse / Zap app deletion over
   * `/internal/step-up/verify`) and both security-event acknowledge paths.
   * Widening it widens all five. Defaults to passkey, OTP or TOTP.
   */
  recoveryGenerateAllowedAmr?: readonly ("webauthn" | "otp" | "totp")[];
  /**
   * Permitted AMR values for `DELETE /passkeys/:id` step-up. Defaults to
   * passkey-only (`["webauthn"]`) — by construction the caller already
   * has at least one passkey (the last-passkey guard fires otherwise),
   * so accepting OTP would weaken the gate without UX gain (S-L4).
   *
   * TOTP is deliberately NOT admitted here, and the type permits it only so
   * this array is assignable from the same literals as its two siblings. A
   * stolen access token plus a cloud-synced authenticator seed must not be
   * enough to delete the victim's real passkeys.
   */
  passkeyDeleteAllowedAmr?: readonly ("webauthn" | "otp" | "totp")[];
  /**
   * Permitted AMR values for `/passkey/register/{begin,complete}` step-up
   * when the account already has ≥1 passkey (S-H1). First-passkey
   * enrollment bypasses the gate entirely — no step-up ceremony is
   * reachable before the account has any credentials. Defaults to
   * `["webauthn", "otp"]` because a user who legitimately wants to add a
   * second device may be doing so precisely because the original is hard
   * to reach; forcing passkey-only step-up would create a chicken-and-
   * egg. TOTP is admitted for the same reason, and this set also gates TOTP's
   * own enrol / disable ceremonies.
   */
  passkeyRegisterAllowedAmr?: readonly ("webauthn" | "otp" | "totp")[];
  /**
   * Cluster-wide single-use guard for step-up token jtis (S-H1). Inject a
   * Redis-backed store in multi-pod deployments; otherwise the default
   * in-memory map means a captured token replays successfully once per pod.
   */
  stepUpJtiStore?: StepUpJtiStore;
  /**
   * Cluster-safe record of rotated-out session hashes for C2 reuse detection
   * (S-H1 session). Single-process deployments get the in-memory default;
   * multi-pod deployments inject a Redis-backed store so a rotation recorded
   * on one pod is visible to every other pod on subsequent /token calls.
   */
  rotatedSessionStore?: RotatedSessionStore;
  /**
   * O2: per-account recovery-code lockout counter. Defaults to in-memory;
   * inject the Redis-backed store in multi-pod deployments so the threshold
   * is enforced across pods. Keyed on the resolved accountId — see
   * `recovery-lockout-store.ts`.
   */
  recoveryLockoutStore?: RecoveryLockoutStore;
  /**
   * Per-account TOTP failed-code lockout. Same shape as the recovery counter
   * and the OPPOSITE outage posture — it fails closed. See
   * `lib/recovery-lockout-store.ts`.
   */
  totpLockoutStore?: RecoveryLockoutStore;
  /**
   * AES-GCM key that TOTP shared secrets are encrypted under at rest, imported
   * once at boot from `OSN_TOTP_ENCRYPTION_KEY`. `buildAppDeps` always supplies
   * one — the real secret in a deployed tier, an ephemeral key in local dev.
   *
   * Optional here so every existing `AuthConfig` literal still type-checks.
   * Absent does NOT mean "store the secret in plain text": the TOTP service has
   * no plaintext path and fails closed when this is unset.
   */
  totpEncryptionKey?: CryptoKey;
  /**
   * O3: injectable Redis-backed ceremony / pending-state stores. When omitted
   * each falls back to an in-memory `Map` (single-process only). Multi-pod
   * deployments MUST inject the Redis-backed variants so a ceremony `begin`
   * served by one pod can be `complete`d by another, and so per-account caps
   * are enforced cluster-wide rather than per-pod. The factory builds these
   * from a single `RedisClient` in `index.ts`.
   */
  ceremonyStores?: CeremonyStores;
  /**
   * O3: per-account caps, routed through the redis-rate-limiter family rather
   * than bespoke stores. `check(accountId)` returns `true` while under the cap,
   * `false` once exceeded (fixed window). Defaults to in-memory fixed-window
   * limiters with the historical bounds (profile-switch 20/hr, email-change
   * begin 3/24h). Injected from `index.ts` as Redis-backed limiters in
   * multi-pod deployments so the window is shared across pods.
   */
  profileSwitchCap?: AccountCapLimiter;
  emailChangeBeginCap?: AccountCapLimiter;
  /**
   * HMAC key for pairwise subject identifiers. Every relying party sees a
   * different `sub` for the same profile, derived from this key plus the
   * client's sector — so two relying parties comparing notes cannot tell they
   * are looking at the same person. Must be at least 32 bytes of unguessable
   * material outside local dev.
   *
   * Rotating it changes every `sub` we have ever issued, which every relying
   * party reads as "all my users are new people". Treat it as permanent.
   */
  pairwiseSalt?: string;
  /**
   * Where to send the browser when a `/authorize` request needs the user —
   * sign-in, profile choice, or consent. The UI is handed an opaque request
   * id and reads the request back over `/authorize/context`; it never sees or
   * echoes the raw OAuth parameters. Defaults to the first configured origin.
   */
  authorizeUiUrl?: string;
}
