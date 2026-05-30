// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeOpenStatus,
  fetchAllVenues,
  parseVenueHours,
  venueMapsUrl,
  type VenueSummary,
} from "../../src/lib/venues";

// ---------------------------------------------------------------------------
// parseVenueHours
// ---------------------------------------------------------------------------

describe("parseVenueHours", () => {
  it("returns null when the input is null", () => {
    expect(parseVenueHours(null)).toBeNull();
  });

  it("parses a valid hours map", () => {
    const raw = JSON.stringify({ "5": { open: "22:00", close: "04:00" }, "1": null });
    const parsed = parseVenueHours(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!["5"]).toEqual({ open: "22:00", close: "04:00" });
    expect(parsed!["1"]).toBeNull();
  });

  it("returns null on invalid JSON instead of throwing", () => {
    expect(parseVenueHours("not-json")).toBeNull();
  });

  it("returns null when the parsed value is not an object", () => {
    expect(parseVenueHours("42")).toBeNull();
    expect(parseVenueHours("null")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// venueMapsUrl
// ---------------------------------------------------------------------------

const baseVenue: VenueSummary = {
  id: "v1",
  orgHandle: "org",
  handle: "venue",
  name: "Venue",
  kind: "club",
  description: null,
  address: null,
  city: null,
  country: null,
  latitude: null,
  longitude: null,
  capacity: null,
  hours: null,
  heroImageUrl: null,
  websiteUrl: null,
  instagramHandle: null,
  timezone: "UTC",
};

describe("venueMapsUrl", () => {
  it("prefers lat/lng coordinates when present", () => {
    const url = venueMapsUrl({ ...baseVenue, latitude: 40.7197, longitude: -73.9879 });
    expect(url).toBe("https://www.google.com/maps/search/?api=1&query=40.7197,-73.9879");
  });

  it("falls back to an encoded address when coords are missing", () => {
    const url = venueMapsUrl({
      ...baseVenue,
      address: "152 Orchard St",
      city: "New York",
      country: "USA",
    });
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=152%20Orchard%20St%2C%20New%20York%2C%20USA",
    );
  });

  it("returns null when there's no coords and no address pieces", () => {
    expect(venueMapsUrl(baseVenue)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeOpenStatus — the wall-clock-sensitive bits
// ---------------------------------------------------------------------------

describe("computeOpenStatus", () => {
  const hours = {
    "5": { open: "22:00", close: "04:00" }, // Fri opens late, into Sat
  };

  it("reports open during a slot that crosses midnight (Sat 02:00 NY)", () => {
    // 2030-06-08 06:00 UTC = Sat 02:00 EDT — inside the Fri 22:00 → Sat 04:00 slot.
    const at = new Date("2030-06-08T06:00:00.000Z");
    const s = computeOpenStatus(hours, "America/New_York", at);
    expect(s.isOpen).toBe(true);
    expect(s.label).toContain("closes");
  });

  it("reports closed and proposes the next opening when outside any slot", () => {
    // 2030-06-07 18:00 UTC = Fri 14:00 EDT — Fri slot opens at 22:00 EDT.
    const at = new Date("2030-06-07T18:00:00.000Z");
    const s = computeOpenStatus(hours, "America/New_York", at);
    expect(s.isOpen).toBe(false);
    expect(s.label.toLowerCase()).toMatch(/opens|closed/);
  });
});

// ---------------------------------------------------------------------------
// fetchAllVenues
// ---------------------------------------------------------------------------

describe("fetchAllVenues", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns the venues array on a 200 response", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ venues: [baseVenue] }),
    });
    const result = await fetchAllVenues();
    expect(result).toEqual([baseVenue]);
  });

  it("returns an empty array on a non-OK response (fail-soft)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    const result = await fetchAllVenues();
    expect(result).toEqual([]);
  });

  it("returns an empty array when the body has no venues key", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const result = await fetchAllVenues();
    expect(result).toEqual([]);
  });
});
