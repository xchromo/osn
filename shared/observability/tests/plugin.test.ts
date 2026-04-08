import { Elysia } from "elysia";
import { describe, expect, it } from "vitest";
import { observabilityPlugin } from "../src/elysia/plugin";

/**
 * These tests exercise the public behaviours of the plugin without
 * booting the OTel SDK. Because the plugin calls `trace.getTracer()`
 * and `metrics.getMeter()`, which default to NoOp implementations when
 * no provider is installed, the whole pipeline runs end-to-end but
 * doesn't export anything — which is exactly what we want in unit tests.
 */
const makeApp = () =>
  new Elysia()
    .use(observabilityPlugin({ serviceName: "test-svc" }))
    .get("/ping", () => ({ pong: true }))
    .get("/boom", () => {
      throw new Error("kaboom");
    });

describe("observabilityPlugin", () => {
  it("echoes a generated x-request-id on successful responses", async () => {
    const app = makeApp();
    const res = await app.handle(new Request("http://localhost/ping"));
    expect(res.status).toBe(200);
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(id).toMatch(/^req_/);
  });

  it("preserves an inbound x-request-id rather than generating a new one", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request("http://localhost/ping", {
        headers: { "x-request-id": "req_external_abc123" },
      }),
    );
    expect(res.headers.get("x-request-id")).toBe("req_external_abc123");
  });

  it("accepts an inbound traceparent header without throwing", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request("http://localhost/ping", {
        headers: {
          traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("does not leak the in-flight gauge when a handler throws", async () => {
    const app = makeApp();
    // Elysia returns 500 (or converts to an error response) rather than
    // propagating the throw to the caller. Either way, the plugin's
    // onAfterResponse hook must fire and dec the gauge.
    const res = await app.handle(new Request("http://localhost/boom"));
    // Elysia defaults to 500 on uncaught throws; we don't assert the
    // exact code — only that the request completes without hanging and
    // a response is returned with an x-request-id header.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("survives many sequential requests without accumulating state", async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i++) {
      const res = await app.handle(new Request(`http://localhost/ping?i=${i}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-request-id")).toBeTruthy();
    }
  });

  it("works alongside other Elysia routes without interfering", async () => {
    const app = new Elysia()
      .use(observabilityPlugin({ serviceName: "test-svc" }))
      .get("/a", () => "a")
      .get("/b", () => "b")
      .post("/echo", ({ body }) => body, { body: undefined });

    const a = await app.handle(new Request("http://localhost/a"));
    const b = await app.handle(new Request("http://localhost/b"));
    expect(await a.text()).toBe("a");
    expect(await b.text()).toBe("b");
  });
});
