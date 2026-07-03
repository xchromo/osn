import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import worker from "../src/index";

/**
 * Top-level app smoke tests. The route-level tests in
 * tests/routes/events.test.ts build a fresh `createEventsRoutes` per
 * test and bypass the plugin wiring, so they don't cover the
 * entry-point wiring. These tests exist to catch plugin-mount
 * regressions (e.g. a refactor that forgets to `.use(healthRoutes(...))`
 * in src/app.ts).
 */
const app = createApp();

describe("pulse API app", () => {
  describe("GET /", () => {
    it("returns service identifier", async () => {
      const res = await app.handle(new Request("http://localhost/"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; service: string };
      expect(body.status).toBe("ok");
      expect(body.service).toBe("pulse-api");
    });
  });

  describe("GET /health", () => {
    it("returns ok from the shared observability health route", async () => {
      const res = await app.handle(new Request("http://localhost/health"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; service: string };
      expect(body.status).toBe("ok");
      expect(body.service).toBe("pulse-api");
    });
  });

  describe("GET /ready", () => {
    it("returns ready (no probe supplied)", async () => {
      const res = await app.handle(new Request("http://localhost/ready"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; service: string };
      expect(body.status).toBe("ready");
      expect(body.service).toBe("pulse-api");
    });
  });

  it("emits x-request-id on every response (plugin mounted)", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  // T-U1: the Worker entry must fail closed on a missing/plaintext JWKS URL in a
  // deployed env — a forged key set served over http:// would otherwise let an
  // attacker mint acceptable access tokens. `buildApp` throws (fail-closed at
  // the edge), so the fetch handler rejects. DB is a truthy stub only to get
  // past the missing-DB guard; the JWKS check fires first.
  describe("JWKS scheme guard (deployed env)", () => {
    const req = () => new Request("http://localhost/health");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal Env stub
    const envWith = (jwksUrl: string | undefined): any => ({
      OSN_ENV: "production",
      DB: {},
      OSN_JWKS_URL: jwksUrl,
      PULSE_CORS_ORIGIN: "https://app.example.com",
    });

    it("rejects when OSN_JWKS_URL is unset", async () => {
      await expect(worker.fetch!(req(), envWith(undefined))).rejects.toThrow(/HTTPS/);
    });

    it("rejects when OSN_JWKS_URL is plaintext http://", async () => {
      await expect(
        worker.fetch!(req(), envWith("http://id.example.com/.well-known/jwks.json")),
      ).rejects.toThrow(/HTTPS/);
    });
  });
});
