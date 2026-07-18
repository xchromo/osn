import { describe, it, expect } from "bun:test";

import { createPaymentWebhookSkeleton } from "./payment-webhook";

// Elysia 1.4.x requires app.fetch (absolute URL) rather than app.handle —
// app.handle delegates to fetch but the Bun adapter only wires up the
// compiled handler on fetch, so handle always 404s on an uncompiled instance.
// All other route tests in this package use app.fetch for the same reason.

describe("payment webhook skeleton (Phase 1 — inert)", () => {
  it("returns 501 not_implemented and never processes", async () => {
    const app = createPaymentWebhookSkeleton();
    const res = await app.fetch(
      new Request("http://localhost/api/payments/webhook", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "not_implemented" });
  });
});
