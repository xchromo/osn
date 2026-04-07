import { parseTokenResponse, type Session } from "./tokens";

/**
 * Plain-fetch helpers for the email-verified registration flow + passkey
 * enrolment. Kept separate from the Effect-based OsnAuth service so consumers
 * can use these directly from UI components without dragging in the Storage
 * layer.
 *
 * Flow:
 *  1. checkHandle(handle)             — front-end "is this @ free?" check
 *  2. beginRegistration(...)          — sends a 6-digit OTP to the email
 *  3. completeRegistration(...)       — verifies the OTP, creates the user,
 *                                       returns { userId, code }
 *  4. passkeyRegisterBegin(userId)    — fetch WebAuthn creation options. The
 *                                       caller is responsible for running the
 *                                       browser ceremony with @simplewebauthn
 *  5. passkeyRegisterComplete(...)    — submit the attestation
 *  6. exchangeAuthCode(code)          — swap the auth code from step 3 for an
 *                                       access/refresh token Session
 *
 * The WebAuthn browser ceremony is intentionally not performed inside this
 * package — keeping it caller-side avoids adding @simplewebauthn/browser as a
 * dependency of @osn/client.
 */

export interface RegistrationClientConfig {
  /** OSN issuer base URL, e.g. http://localhost:4000 */
  issuerUrl: string;
  /** OAuth client id (used when exchanging the auth code for tokens) */
  clientId: string;
}

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new RegistrationError(json.error ?? `Request failed: ${res.status}`);
  }
  return json;
}

export interface RegistrationClient {
  checkHandle(handle: string): Promise<{ available: boolean }>;
  beginRegistration(input: {
    email: string;
    handle: string;
    displayName?: string;
  }): Promise<{ sent: boolean }>;
  completeRegistration(input: {
    email: string;
    code: string;
  }): Promise<{ userId: string; handle: string; email: string; code: string }>;
  passkeyRegisterBegin(userId: string): Promise<unknown>;
  passkeyRegisterComplete(input: {
    userId: string;
    attestation: unknown;
  }): Promise<{ passkeyId: string }>;
  exchangeAuthCode(code: string, redirectUri?: string): Promise<Session>;
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

  const completeRegistration = (input: { email: string; code: string }) =>
    postJson<{ userId: string; handle: string; email: string; code: string }>(
      `${base}/register/complete`,
      input,
    );

  const passkeyRegisterBegin = (userId: string) =>
    postJson<unknown>(`${base}/passkey/register/begin`, { userId });

  const passkeyRegisterComplete = (input: { userId: string; attestation: unknown }) =>
    postJson<{ passkeyId: string }>(`${base}/passkey/register/complete`, input);

  const exchangeAuthCode = async (code: string, redirectUri?: string): Promise<Session> => {
    const res = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        // The token endpoint accepts these without state — PKCE is bypassed
        // when no `state` is supplied (used by the registration flow, which
        // never went through /authorize).
        redirect_uri: redirectUri ?? `${base}/callback`,
        client_id: config.clientId,
        code_verifier: "registration",
      }).toString(),
    });
    const raw = (await res.json()) as { error?: string };
    if (!res.ok) {
      throw new RegistrationError(raw.error ?? "Token exchange failed");
    }
    return parseTokenResponse(raw);
  };

  return {
    checkHandle,
    beginRegistration,
    completeRegistration,
    passkeyRegisterBegin,
    passkeyRegisterComplete,
    exchangeAuthCode,
  };
}
