import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Worker handler uses jose.createRemoteJWKSet under the hood, which
// fetches the JWKS URL. We intercept the fetch for the JWKS + provider
// calls in each test.
import worker, { type Env } from "../src/index";

interface KeyFixture {
  readonly privateKey: CryptoKey;
  readonly publicJwk: Record<string, unknown>;
  readonly kid: string;
}

async function makeKey(): Promise<KeyFixture> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = (await exportJWK(publicKey)) as Record<string, unknown>;
  // Simple deterministic kid — we don't need RFC 7638 thumbprint here.
  const kid = "test-kid";
  publicJwk.kid = kid;
  return { privateKey, publicJwk, kid };
}

async function signArc(
  privateKey: CryptoKey,
  kid: string,
  claims: { iss: string; aud: string; scope: string },
): Promise<string> {
  return new SignJWT({ scope: claims.scope })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

const BASE_ENV: Env = {
  RESEND_API_KEY: "test-resend-key",
  OSN_API_ISSUER_JWKS: "https://jwks.osn.test/jwks.json",
  OSN_API_ISSUER_ID: "osn-api",
  FROM_ADDRESS_DEFAULT: "noreply@osn.test",
};

const validBody = {
  to: "alice@example.com",
  subject: "Verify your OSN email",
  text: "Your OSN verification code is: 000000",
  html: "<p>Your OSN verification code is: 000000</p>",
};

let key: KeyFixture;

beforeEach(async () => {
  key = await makeKey();
  // The arc-verify module caches JWKS by URL in Worker-global scope; to
  // avoid hits from previous tests we use a unique JWKS URL per test
  // (handed to the Worker via `env`). No global reset is necessary.
});

function buildFetchMock(opts: {
  jwks?: Record<string, unknown>;
  provider?: (body: unknown) => { status: number; body?: unknown };
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes("jwks.osn.test")) {
      return new Response(JSON.stringify(opts.jwks ?? { keys: [key.publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("resend.com/emails")) {
      const parsed = init?.body ? JSON.parse(init.body as string) : null;
      const res = opts.provider?.(parsed) ?? { status: 202, body: { id: "resend_123" } };
      return new Response(JSON.stringify(res.body ?? {}), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${urlStr}`);
  });
}

describe("email-worker /send", () => {
  it("accepts a valid ARC-authed send and returns 202", async () => {
    vi.stubGlobal("fetch", buildFetchMock({}));
    // Use a fresh JWKS URL so the in-module cache doesn't collide with
    // previous tests' key material.
    const env: Env = {
      ...BASE_ENV,
      OSN_API_ISSUER_JWKS: `https://jwks.osn.test/${crypto.randomUUID()}.json`,
    };
    const token = await signArc(key.privateKey, key.kid, {
      iss: "osn-api",
      aud: "osn-email-worker",
      scope: "email:send",
    });

    const res = await worker.fetch(
      new Request("https://worker.local/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ARC ${token}`,
        },
        body: JSON.stringify(validBody),
      }),
      env,
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects a missing Authorization header with 401", async () => {
    vi.stubGlobal("fetch", buildFetchMock({}));
    const env: Env = {
      ...BASE_ENV,
      OSN_API_ISSUER_JWKS: `https://jwks.osn.test/${crypto.randomUUID()}.json`,
    };
    const res = await worker.fetch(
      new Request("https://worker.local/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects the wrong scope with 403", async () => {
    vi.stubGlobal("fetch", buildFetchMock({}));
    const env: Env = {
      ...BASE_ENV,
      OSN_API_ISSUER_JWKS: `https://jwks.osn.test/${crypto.randomUUID()}.json`,
    };
    const token = await signArc(key.privateKey, key.kid, {
      iss: "osn-api",
      aud: "osn-email-worker",
      scope: "graph:read",
    });
    const res = await worker.fetch(
      new Request("https://worker.local/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ARC ${token}`,
        },
        body: JSON.stringify(validBody),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a malformed `to` with 400", async () => {
    vi.stubGlobal("fetch", buildFetchMock({}));
    const env: Env = {
      ...BASE_ENV,
      OSN_API_ISSUER_JWKS: `https://jwks.osn.test/${crypto.randomUUID()}.json`,
    };
    const token = await signArc(key.privateKey, key.kid, {
      iss: "osn-api",
      aud: "osn-email-worker",
      scope: "email:send",
    });
    const res = await worker.fetch(
      new Request("https://worker.local/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ARC ${token}`,
        },
        body: JSON.stringify({ ...validBody, to: "not-an-email" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 502 when the provider returns 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchMock({
        provider: () => ({ status: 503 }),
      }),
    );
    const env: Env = {
      ...BASE_ENV,
      OSN_API_ISSUER_JWKS: `https://jwks.osn.test/${crypto.randomUUID()}.json`,
    };
    const token = await signArc(key.privateKey, key.kid, {
      iss: "osn-api",
      aud: "osn-email-worker",
      scope: "email:send",
    });
    const res = await worker.fetch(
      new Request("https://worker.local/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ARC ${token}`,
        },
        body: JSON.stringify(validBody),
      }),
      env,
    );
    expect(res.status).toBe(502);
  });

  it("404s on any non-POST /send path", async () => {
    vi.stubGlobal("fetch", buildFetchMock({}));
    const env: Env = {
      ...BASE_ENV,
      OSN_API_ISSUER_JWKS: `https://jwks.osn.test/${crypto.randomUUID()}.json`,
    };
    const res = await worker.fetch(
      new Request("https://worker.local/other", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});
