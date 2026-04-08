import { describe, expect, it } from "vitest";
import { extractTraceContext, injectTraceContext } from "../src/tracing/propagation";

describe("trace context propagation", () => {
  it("extract returns a context even when no traceparent header is present", () => {
    const headers = new Headers();
    const ctx = extractTraceContext(headers);
    expect(ctx).toBeDefined();
  });

  it("injects nothing into headers when there is no active span", () => {
    const headers = new Headers();
    injectTraceContext(headers);
    // With no active span + no SDK initialised, nothing should be injected.
    // This is intentional: tests don't require the OTel SDK to be running.
    expect(headers.get("traceparent")).toBeNull();
  });

  it("extracts from a plain record", () => {
    const ctx = extractTraceContext({
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    });
    expect(ctx).toBeDefined();
  });
});
