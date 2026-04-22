import { parseTokenResponse, type Session } from "./tokens";

/**
 * Plain-fetch helpers for the email-verified registration flow + first-
 * passkey enrollment. Kept separate from the Effect-based `OsnAuth` service
 * so UI components can use these directly without dragging in the Storage
 * layer.
 *
 * Flow:
 *  1. `checkHandle(handle)`                — front-end "is this @ free?" probe
 *  2. `beginRegistration(...)`             — sends a 6-digit OTP to the email
 *  3. `completeRegistration(...)`          — verifies the OTP, creates the
 *                                            account + profile, and returns
 *                                            `{ profileId, session }`. The
 *                                            session is ready to hand to
 *                                            `AuthProvider.adoptSession`.
 *  4. `passkeyRegisterBegin({profileId})`  — fetch WebAuthn options. The
 *                                            caller passes the access token
 *                                            returned in step 3.
 *  5. `passkeyRegisterComplete({profileId,attestation})` — submit the
 *                                            attested credential.
 *
 * The WebAuthn browser ceremony is intentionally not performed inside this
 * package — keeping it caller-side avoids pulling in @simplewebauthn/browser.
 *
 * The UI MUST complete step 5 before dismissing the registration flow.
 * Together with the last-passkey guard in `DELETE /passkeys/:id`, this
 * maintains the invariant "every live account has ≥1 WebAuthn credential".
 */

export interface RegistrationClientConfig {
  /** OSN issuer base URL, e.g. http://localhost:4000 */
  issuerUrl: string;
}

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  options: { bearer?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.bearer) headers["Authorization"] = `Bearer ${options.bearer}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new RegistrationError(json.error ?? `Request failed: ${res.status}`);
  }
  return json;
}

export interface CompleteRegistrationResult {
  profileId: string;
  handle: string;
  email: string;
  /** Ready to pass to AuthProvider.adoptSession. */
  session: Session;
}

export interface RegistrationClient {
  checkHandle(handle: string): Promise<{ available: boolean }>;
  beginRegistration(input: {
    email: string;
    handle: string;
    displayName?: string;
  }): Promise<{ sent: boolean }>;
  completeRegistration(input: { email: string; code: string }): Promise<CompleteRegistrationResult>;
  /** WebAuthn options for the first-passkey enrollment. `accessToken` is the one returned by `completeRegistration`. */
  passkeyRegisterBegin(input: { profileId: string; accessToken: string }): Promise<unknown>;
  passkeyRegisterComplete(input: {
    profileId: string;
    accessToken: string;
    attestation: unknown;
  }): Promise<{ passkeyId: string }>;
}

export function createRegistrationClient(config: RegistrationClientConfig): RegistrationClient {
  const base = config.issuerUrl.replace(/\/$/, "");

  const checkHandle = async (handle: string) => {
    const res = await fetch(`${base}/handle/${encodeURIComponent(handle)}`);
    const json = (await res.json()) as { available?: boolean; error?: string };
    if (!res.ok || typeof json.available !== "boolean") {
      throw new RegistrationError(json.error ?? "Invalid handle");
    }
    return { available: json.available };
  };

  const beginRegistration = (input: { email: string; handle: string; displayName?: string }) =>
    postJson<{ sent: boolean }>(`${base}/register/begin`, input);

  const completeRegistration = async (input: {
    email: string;
    code: string;
  }): Promise<CompleteRegistrationResult> => {
    const raw = await postJson<{
      profileId: string;
      handle: string;
      email: string;
      session: unknown;
    }>(`${base}/register/complete`, input);
    const session = parseTokenResponse(raw.session);
    return {
      profileId: raw.profileId,
      handle: raw.handle,
      email: raw.email,
      session,
    };
  };

  const passkeyRegisterBegin = (input: { profileId: string; accessToken: string }) =>
    postJson<unknown>(
      `${base}/passkey/register/begin`,
      { profileId: input.profileId },
      { bearer: input.accessToken },
    );

  const passkeyRegisterComplete = (input: {
    profileId: string;
    accessToken: string;
    attestation: unknown;
  }) =>
    postJson<{ passkeyId: string }>(
      `${base}/passkey/register/complete`,
      { profileId: input.profileId, attestation: input.attestation },
      { bearer: input.accessToken },
    );

  return {
    checkHandle,
    beginRegistration,
    completeRegistration,
    passkeyRegisterBegin,
    passkeyRegisterComplete,
  };
}
