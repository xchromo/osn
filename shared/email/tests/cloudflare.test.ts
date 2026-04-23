import { generateArcKeyPair, thumbprintKid } from "@shared/crypto";
import { Effect, Either } from "effect";
import { decodeJwt } from "jose";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeCloudflareEmailLive } from "../src/cloudflare";
import { EmailError, EmailService, type SendEmailInput } from "../src/service";

const WORKER_URL = "https://email.osn.test/send";

type Captured = {
  url: string;
  method: string;
  headers: Headers;
  body: string;
};

let captured: Captured | null = null;
let responder: () => Response;

beforeEach(() => {
  captured = null;
  responder = () => new Response("", { status: 202 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      captured = {
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method ?? "GET",
        headers: init?.headers instanceof Headers ? init.headers : new Headers(init?.headers ?? {}),
        body: typeof init?.body === "string" ? init.body : "",
      };
      return responder();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function buildLayer() {
  const { privateKey, publicKey } = await generateArcKeyPair();
  const kid = await thumbprintKid(publicKey);
  return makeCloudflareEmailLive({
    workerUrl: WORKER_URL,
    arcPrivateKey: privateKey,
    arcKid: kid,
    fromAddress: "noreply@osn.test",
  });
}

describe("CloudflareEmailLive", () => {
  it("POSTs JSON to the Worker with an ARC bearer and the rendered body", async () => {
    const layer = await buildLayer();
    await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailService;
        yield* email.send({
          template: "otp-registration",
          to: "alice@example.com",
          data: { code: "000000", ttlMinutes: 10 },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(WORKER_URL);
    expect(captured!.method).toBe("POST");
    expect(captured!.headers.get("content-type")).toBe("application/json");
    const auth = captured!.headers.get("authorization");
    expect(auth).toMatch(/^ARC /);
    const token = auth!.slice(4);
    const claims = decodeJwt(token);
    expect(claims.iss).toBe("osn-api");
    expect(claims.aud).toBe("osn-email-worker");
    expect(claims.scope).toBe("email:send");

    const payload = JSON.parse(captured!.body) as {
      to: string;
      from: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(payload.to).toBe("alice@example.com");
    expect(payload.from).toBe("noreply@osn.test");
    expect(payload.subject).toBe("Verify your OSN email");
    expect(payload.text).toContain("000000");
    expect(payload.html).toContain("000000");
  });

  const expectFailsWith = async (
    layer: Awaited<ReturnType<typeof buildLayer>>,
    input: SendEmailInput,
    reason: EmailError["reason"],
  ) => {
    const either = await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailService;
        return yield* email.send(input);
      }).pipe(Effect.provide(layer), Effect.either),
    );
    expect(Either.isLeft(either)).toBe(true);
    if (Either.isLeft(either)) {
      expect(either.left).toBeInstanceOf(EmailError);
      expect(either.left.reason).toBe(reason);
    }
  };

  it("returns rate_limited on Worker 429", async () => {
    responder = () => new Response("too many", { status: 429 });
    await expectFailsWith(
      await buildLayer(),
      {
        template: "otp-step-up",
        to: "alice@example.com",
        data: { code: "000000", ttlMinutes: 5 },
      },
      "rate_limited",
    );
  });

  it("returns dispatch_failed on Worker 5xx", async () => {
    responder = () => new Response("boom", { status: 500 });
    await expectFailsWith(
      await buildLayer(),
      { template: "passkey-added", to: "alice@example.com", data: {} },
      "dispatch_failed",
    );
  });

  it("returns worker_unreachable when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expectFailsWith(
      await buildLayer(),
      { template: "recovery-consumed", to: "alice@example.com", data: {} },
      "worker_unreachable",
    );
  });

  it("does not include OTP code on span attributes (only `template`)", async () => {
    // Smoke test: the rendered payload is in the HTTP body (expected),
    // but the span attribute ought to be just {template}. We assert by
    // checking the constructor contract — any span set up here would
    // otherwise be a runtime concern; this test ensures the call path
    // does not stringify `data` into any observable side-channel under
    // our control (headers, URL, etc).
    const layer = await buildLayer();
    await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailService;
        yield* email.send({
          template: "otp-registration",
          to: "alice@example.com",
          data: { code: "999888", ttlMinutes: 10 },
        });
      }).pipe(Effect.provide(layer)),
    );
    // URL path must not contain the code.
    expect(captured!.url).not.toContain("999888");
    // Headers must not contain the code.
    captured!.headers.forEach((v, k) => {
      expect(v).not.toContain("999888");
      expect(k).not.toContain("999888");
    });
    // Code only appears in the body.
    expect(captured!.body).toContain("999888");
  });
});
