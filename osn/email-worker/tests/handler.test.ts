import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

type EmailSend = Parameters<Env["EMAIL"]["send"]>[0];

/**
 * Build a test `Env` with a stubbed `EMAIL` binding. Returns the env
 * alongside the array of captured `send()` calls so tests can assert the
 * payload, and a mode flag for the failing-provider branch.
 */
function makeEnv(opts: { sendFails?: boolean } = {}): {
  env: Env;
  sends: EmailSend[];
} {
  const sends: EmailSend[] = [];
  const env: Env = {
    EMAIL: {
      send: async (message: EmailSend) => {
        if (opts.sendFails) throw new Error("cloudflare email pipeline unavailable");
        sends.push(message);
        return { messageId: "cf_msg_123" };
      },
    },
    // Fresh JWKS URL per env so the arc-verify module's URL-keyed cache
    // doesn't serve stale key material from an earlier test.
    OSN_API_ISSUER_JWKS: `https://jwks.osn.test/${crypto.randomUUID()}.json`,
    OSN_API_ISSUER_ID: "osn-api",
    FROM_ADDRESS_DEFAULT: "noreply@osn.test",
  };
  return { env, sends };
}

const validBody = {
  to: "alice@example.com",
  subject: "Verify your OSN email",
  text: "Your OSN verification code is: 000000",
  html: "<p>Your OSN verification code is: 000000</p>",
};

let key: KeyFixture;

beforeEach(async () => {
  key = await makeKey();
});

/**
 * The arc-verify module fetches the JWKS via `jose.createRemoteJWKSet`.
 * We stub `globalThis.fetch` so the JWKS URL resolves to the current
 * test's public key — the Cloudflare Email Service is NOT called via
 * fetch (it's a binding), so this stub only needs to serve JWKS.
 */
function stubJwksFetch(jwks?: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const urlStr =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes("jwks.osn.test")) {
        return new Response(JSON.stringify(jwks ?? { keys: [key.publicJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch to ${urlStr}`);
    }),
  );
}

describe("email-worker /send", () => {
  it("accepts a valid ARC-authed send and calls env.EMAIL.send with the payload", async () => {
    stubJwksFetch();
    const { env, sends } = makeEnv();
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
    expect(sends).toHaveLength(1);
    expect(sends[0]).toEqual({
      to: "alice@example.com",
      from: "noreply@osn.test",
      subject: "Verify your OSN email",
      text: "Your OSN verification code is: 000000",
      html: "<p>Your OSN verification code is: 000000</p>",
    });
  });

  it("falls back to FROM_ADDRESS_DEFAULT when the body omits `from`", async () => {
    stubJwksFetch();
    const { env, sends } = makeEnv();
    const token = await signArc(key.privateKey, key.kid, {
      iss: "osn-api",
      aud: "osn-email-worker",
      scope: "email:send",
    });
    await worker.fetch(
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
    expect(sends[0].from).toBe("noreply@osn.test");
  });

  it("returns 502 when env.EMAIL.send rejects", async () => {
    stubJwksFetch();
    const { env } = makeEnv({ sendFails: true });
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
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe("provider_error");
  });

  it("does not echo the binding's error message into the response", async () => {
    // The binding rejects with a message that mentions the verified-
    // domain configuration. OSN must NOT propagate that string back to
    // the caller — the response body carries only the bounded
    // `provider_error` reason.
    stubJwksFetch();
    const env: Env = {
      ...makeEnv().env,
      EMAIL: {
        send: async () => {
          throw new Error("internal-only: alice@example.com not onboarded");
        },
      },
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
    const text = await res.text();
    expect(text).not.toContain("alice@example.com");
    expect(text).not.toContain("not onboarded");
  });

  it("rejects a missing Authorization header with 401", async () => {
    stubJwksFetch();
    const { env, sends } = makeEnv();
    const res = await worker.fetch(
      new Request("https://worker.local/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      env,
    );
    expect(res.status).toBe(401);
    expect(sends).toHaveLength(0);
  });

  it("rejects the wrong scope with 403", async () => {
    stubJwksFetch();
    const { env, sends } = makeEnv();
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
    expect(sends).toHaveLength(0);
  });

  it("rejects a malformed `to` with 400", async () => {
    stubJwksFetch();
    const { env } = makeEnv();
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

  // T-S1: the validator returns a distinct `reason` string per branch.
  // Clients (including OSN's own retry / log pipeline) may depend on the
  // exact value, so we lock every branch individually.
  describe("body validation branches", () => {
    interface BadCase {
      name: string;
      patch: Record<string, unknown>;
      reason: string;
    }
    const cases: BadCase[] = [
      { name: "invalid_to (malformed)", patch: { to: "not-an-email" }, reason: "invalid_to" },
      { name: "invalid_to (missing)", patch: { to: undefined }, reason: "invalid_to" },
      { name: "invalid_from (malformed)", patch: { from: "bogus" }, reason: "invalid_from" },
      { name: "invalid_subject (empty)", patch: { subject: "" }, reason: "invalid_subject" },
      {
        name: "invalid_subject (>200 chars)",
        patch: { subject: "x".repeat(201) },
        reason: "invalid_subject",
      },
      { name: "invalid_text (empty)", patch: { text: "" }, reason: "invalid_text" },
      {
        name: "invalid_text (>20k chars)",
        patch: { text: "x".repeat(20_001) },
        reason: "invalid_text",
      },
      {
        name: "invalid_html (>50k chars)",
        patch: { html: "x".repeat(50_001) },
        reason: "invalid_html",
      },
    ];

    for (const c of cases) {
      it(`rejects ${c.name} with reason=${c.reason}`, async () => {
        stubJwksFetch();
        const { env } = makeEnv();
        const token = await signArc(key.privateKey, key.kid, {
          iss: "osn-api",
          aud: "osn-email-worker",
          scope: "email:send",
        });
        const body: Record<string, unknown> = { ...validBody, ...c.patch };
        const res = await worker.fetch(
          new Request("https://worker.local/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `ARC ${token}`,
            },
            body: JSON.stringify(body),
          }),
          env,
        );
        expect(res.status).toBe(400);
        const err = (await res.json()) as { error: string };
        expect(err.error).toBe(c.reason);
      });
    }

    it("rejects a non-JSON body with invalid_json", async () => {
      stubJwksFetch();
      const { env } = makeEnv();
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
          body: "not-json",
        }),
        env,
      );
      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: string };
      expect(err.error).toBe("invalid_json");
    });
  });

  it("404s on any non-POST /send path", async () => {
    stubJwksFetch();
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request("https://worker.local/other", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(404);
  });

  // T-U1: primary ARC-forgery defence. A token signed by a key the JWKS
  // does not publish must fail verification, otherwise a compromised peer
  // could reach the email path.
  it("rejects a token signed by a key not in the JWKS with 401 (verify_failed)", async () => {
    // JWKS serves `key.publicJwk`; we sign with a DIFFERENT keypair whose
    // public half is never published.
    const attacker = await makeKey();
    stubJwksFetch();
    const { env } = makeEnv();
    const forgedToken = await signArc(attacker.privateKey, attacker.kid, {
      iss: "osn-api",
      aud: "osn-email-worker",
      scope: "email:send",
    });
    const res = await worker.fetch(
      new Request("https://worker.local/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ARC ${forgedToken}`,
        },
        body: JSON.stringify(validBody),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  // T-U1: a token with the wrong `iss` must be rejected. jose enforces
  // this via the `issuer` verify option; the Worker also defence-in-depth
  // re-checks the claim so a future jose change doesn't silently soften
  // the gate.
  it("rejects a token with a mismatched issuer with 401", async () => {
    stubJwksFetch();
    const { env } = makeEnv();
    const token = await signArc(key.privateKey, key.kid, {
      iss: "pulse-api", // not the configured expectedIssuer
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
    expect(res.status).toBe(401);
  });

  // T-U1: rejects tokens whose Authorization header uses the wrong scheme
  // (e.g. `Bearer`). Documents the `bad_scheme` branch explicitly.
  it("rejects a Bearer-scheme Authorization header with 401 (bad_scheme)", async () => {
    stubJwksFetch();
    const { env } = makeEnv();
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
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBody),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });
});
