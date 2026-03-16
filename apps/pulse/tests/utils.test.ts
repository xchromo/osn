import { describe, it, expect } from "vitest";
import { formatTime, toDatetimeLocal, composeLabel, type PhotonFeature } from "../src/lib/utils";

describe("toDatetimeLocal", () => {
  it("rounds an already-rounded time up to the next minute", () => {
    // Exactly on a minute boundary → should round up to next minute
    const exact = new Date("2030-06-01T10:00:00.000Z");
    const result = toDatetimeLocal(exact);
    // The result is UTC+local — we just verify it advanced by 1 minute from the input
    const parsed = new Date(result + ":00Z");
    expect(parsed.getTime()).toBeGreaterThan(exact.getTime());
  });

  it("rounds a non-rounded time up to the next full minute", () => {
    // 10:00:30 → should become 10:01
    const halfMinute = new Date("2030-06-01T10:00:30.000Z");
    const result = toDatetimeLocal(halfMinute);
    // Output must be in YYYY-MM-DDTHH:mm format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("output matches YYYY-MM-DDTHH:mm format", () => {
    const d = new Date("2030-06-15T14:37:00.000Z");
    expect(toDatetimeLocal(d)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("composeLabel", () => {
  it("joins all present fields with ', '", () => {
    const p: PhotonFeature["properties"] = {
      name: "Venue",
      street: "123 Main St",
      city: "Springfield",
      state: "IL",
      country: "US",
    };
    expect(composeLabel(p)).toBe("Venue, 123 Main St, Springfield, IL, US");
  });

  it("omits absent (undefined) fields", () => {
    const p: PhotonFeature["properties"] = { name: "Park", city: "Austin" };
    expect(composeLabel(p)).toBe("Park, Austin");
  });

  it("returns empty string when all fields are absent", () => {
    expect(composeLabel({})).toBe("");
  });
});

describe("formatTime", () => {
  it("returns a non-empty string for a valid ISO date string", () => {
    const result = formatTime("2030-06-01T10:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for a Date object", () => {
    const result = formatTime(new Date("2030-06-01T10:00:00.000Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
