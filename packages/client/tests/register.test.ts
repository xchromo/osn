import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRegistrationClient, RegistrationError } from "../src/register";

const config = { issuerUrl: "https://osn.example.com", clientId: "test-client" };

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call: FetchCall = { url, init };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("createRegistrationClient", () => {
  let client: ReturnType<typeof createRegistrationClient>;

  beforeEach(() => {
    client = createRegistrationClient(config);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("checkHandle", () => {
    it("GETs /handle/:handle and returns availability", async () => {
      const { calls } = stubFetch(() => jsonResponse({ available: true }));
      const result = await client.checkHandle("alice");
      expect(result).toEqual({ available: true });
      expect(calls[0].url).toBe("https://osn.example.com/handle/alice");
      expect(calls[0].init).toBeUndefined();
    });

    it("URL-encodes the handle path segment", async () => {
      const { calls } = stubFetch(() => jsonResponse({ available: false }));
      await client.checkHandle("weird name");
      expect(calls[0].url).toBe("https://osn.example.com/handle/weird%20name");
    });

    it("throws RegistrationError when the server replies with an error", async () => {
      stubFetch(() => jsonResponse({ error: "Invalid handle" }, { status: 400 }));
      await expect(client.checkHandle("Bad!")).rejects.toBeInstanceOf(RegistrationError);
      await expect(client.checkHandle("Bad!")).rejects.toThrow("Invalid handle");
    });

    it("throws RegistrationError when the response shape is unexpected", async () => {
      stubFetch(() => jsonResponse({ something: "else" }));
      await expect(client.checkHandle("alice")).rejects.toBeInstanceOf(RegistrationError);
    });
  });

  describe("beginRegistration", () => {
    it("POSTs JSON to /register/begin with the right body", async () => {
      const { calls } = stubFetch(() => jsonResponse({ sent: true }));
      const result = await client.beginRegistration({
        email: "alice@example.com",
        handle: "alice",
        displayName: "Alice",
      });
      expect(result).toEqual({ sent: true });
      expect(calls[0].url).toBe("https://osn.example.com/register/begin");
      expect(calls[0].init?.method).toBe("POST");
      expect(JSON.parse(calls[0].init?.body as string)).toEqual({
        email: "alice@example.com",
        handle: "alice",
        displayName: "Alice",
      });
    });

    it("propagates the server error message", async () => {
      stubFetch(() => jsonResponse({ error: "Email already registered" }, { status: 400 }));
      await expect(
        client.beginRegistration({ email: "taken@example.com", handle: "taken" }),
      ).rejects.toThrow("Email already registered");
    });
  });

  describe("completeRegistration", () => {
    it("POSTs JSON to /register/complete and returns the new user + auth code", async () => {
      const { calls } = stubFetch(() =>
        jsonResponse(
          {
            userId: "usr_abc",
            handle: "alice",
            email: "alice@example.com",
            code: "auth_code_xyz",
          },
          { status: 201 },
        ),
      );
      const result = await client.completeRegistration({
        email: "alice@example.com",
        code: "123456",
      });
      expect(result.userId).toBe("usr_abc");
      expect(result.code).toBe("auth_code_xyz");
      expect(calls[0].url).toBe("https://osn.example.com/register/complete");
      expect(JSON.parse(calls[0].init?.body as string)).toEqual({
        email: "alice@example.com",
        code: "123456",
      });
    });

    it("throws RegistrationError on wrong OTP", async () => {
      stubFetch(() => jsonResponse({ error: "Invalid or expired code" }, { status: 400 }));
      await expect(
        client.completeRegistration({ email: "alice@example.com", code: "000000" }),
      ).rejects.toThrow("Invalid or expired code");
    });
  });

  describe("passkeyRegisterBegin / passkeyRegisterComplete", () => {
    it("passkeyRegisterBegin POSTs userId and returns the options blob verbatim", async () => {
      const options = { challenge: "ch_123", rp: { name: "OSN" } };
      const { calls } = stubFetch(() => jsonResponse(options));
      const result = await client.passkeyRegisterBegin("usr_abc");
      expect(result).toEqual(options);
      expect(calls[0].url).toBe("https://osn.example.com/passkey/register/begin");
      expect(JSON.parse(calls[0].init?.body as string)).toEqual({ userId: "usr_abc" });
    });

    it("passkeyRegisterComplete POSTs userId + attestation and returns the passkey id", async () => {
      const { calls } = stubFetch(() => jsonResponse({ passkeyId: "pk_xyz" }));
      const attestation = { id: "cred_id", rawId: "raw" };
      const result = await client.passkeyRegisterComplete({
        userId: "usr_abc",
        attestation,
      });
      expect(result).toEqual({ passkeyId: "pk_xyz" });
      expect(calls[0].url).toBe("https://osn.example.com/passkey/register/complete");
      expect(JSON.parse(calls[0].init?.body as string)).toEqual({
        userId: "usr_abc",
        attestation,
      });
    });
  });

  describe("exchangeAuthCode", () => {
    it("POSTs form-urlencoded to /token with the registration verifier", async () => {
      const { calls } = stubFetch(() =>
        jsonResponse({
          access_token: "acc_999",
          refresh_token: "ref_999",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile",
        }),
      );

      const session = await client.exchangeAuthCode("auth_code_xyz");
      expect(session.accessToken).toBe("acc_999");
      expect(session.refreshToken).toBe("ref_999");
      expect(session.scopes).toEqual(["openid", "profile"]);
      expect(session.expiresAt).toBeGreaterThan(Date.now());

      expect(calls[0].url).toBe("https://osn.example.com/token");
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");

      const params = new URLSearchParams(calls[0].init?.body as string);
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("code")).toBe("auth_code_xyz");
      expect(params.get("client_id")).toBe("test-client");
      expect(params.get("code_verifier")).toBe("registration");
      expect(params.get("redirect_uri")).toBe("https://osn.example.com/callback");
      // No state — registration flow bypasses PKCE on the server side.
      expect(params.has("state")).toBe(false);
    });

    it("uses a custom redirect_uri when provided", async () => {
      const { calls } = stubFetch(() =>
        jsonResponse({
          access_token: "acc_x",
          token_type: "Bearer",
          expires_in: 60,
        }),
      );
      await client.exchangeAuthCode("code", "http://app.local/cb");
      const params = new URLSearchParams(calls[0].init?.body as string);
      expect(params.get("redirect_uri")).toBe("http://app.local/cb");
    });

    it("throws RegistrationError on token exchange failure", async () => {
      stubFetch(() => jsonResponse({ error: "invalid_grant" }, { status: 400 }));
      await expect(client.exchangeAuthCode("bad_code")).rejects.toThrow("invalid_grant");
    });
  });

  it("strips a trailing slash from issuerUrl", async () => {
    const c = createRegistrationClient({
      issuerUrl: "https://osn.example.com/",
      clientId: "test-client",
    });
    const { calls } = stubFetch(() => jsonResponse({ available: true }));
    await c.checkHandle("alice");
    expect(calls[0].url).toBe("https://osn.example.com/handle/alice");
  });
});
