import { describe, expect, it } from "vitest";
import { healthRoutes } from "../src/elysia/health";

describe("healthRoutes", () => {
  it("GET /health returns 200", async () => {
    const app = healthRoutes({ serviceName: "test-svc" });
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("test-svc");
  });

  it("GET /ready without probe returns 200", async () => {
    const app = healthRoutes({ serviceName: "test-svc" });
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ready");
  });

  it("GET /ready with passing probe returns 200", async () => {
    const app = healthRoutes({
      serviceName: "test-svc",
      probe: async () => true,
    });
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(200);
  });

  it("GET /ready with failing probe returns 503", async () => {
    const app = healthRoutes({
      serviceName: "test-svc",
      probe: async () => false,
    });
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("not_ready");
  });

  it("GET /ready with throwing probe returns 503 with reason", async () => {
    const app = healthRoutes({
      serviceName: "test-svc",
      probe: () => {
        throw new Error("db unreachable");
      },
    });
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; reason: string };
    expect(body.status).toBe("not_ready");
    expect(body.reason).toBe("db unreachable");
  });
});
