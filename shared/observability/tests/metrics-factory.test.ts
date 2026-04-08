import { describe, expect, it } from "vitest";
import { createCounter, createHistogram, LATENCY_BUCKETS_SECONDS } from "../src/metrics/factory";
import type { Result } from "../src/metrics/attrs";

describe("metrics factory", () => {
  it("createCounter returns a typed counter with add/inc", () => {
    type Attrs = { route: string; result: Result };
    const counter = createCounter<Attrs>({
      name: "test.counter",
      description: "test counter",
      unit: "{count}",
    });
    // These must not throw even though no MeterProvider is set (OTel
    // defaults to a NoOp meter).
    expect(() => counter.inc({ route: "/foo", result: "ok" })).not.toThrow();
    expect(() => counter.add(5, { route: "/foo", result: "error" })).not.toThrow();
  });

  it("createHistogram accepts boundaries", () => {
    type Attrs = { op: "read" | "write" };
    const hist = createHistogram<Attrs>({
      name: "test.histogram",
      description: "test histogram",
      unit: "s",
      boundaries: LATENCY_BUCKETS_SECONDS,
    });
    expect(() => hist.record(0.123, { op: "read" })).not.toThrow();
  });

  it("LATENCY_BUCKETS_SECONDS is monotonically increasing", () => {
    const bs = LATENCY_BUCKETS_SECONDS;
    for (let i = 1; i < bs.length; i++) {
      expect(bs[i]).toBeGreaterThan(bs[i - 1] as number);
    }
  });
});
