import { describe, expect, it } from "vitest";

import { browserTimeZone, describeTimeZone, timeZoneGroups, zoneOffset } from "./timezones";

/**
 * The timezone helpers behind the events drawer's zone dropdown (and the
 * settings panel's deadline zone). The load-bearing one is {@link zoneOffset}:
 * it replaces the hand-picked "UTC offset" select, so if it gets DST wrong the
 * editor writes a timestamp an hour off with nothing to catch it.
 */

describe("zoneOffset", () => {
  it("derives a southern-hemisphere summer offset", () => {
    // Sydney is on AEDT (+11:00) in November.
    expect(zoneOffset("Australia/Sydney", "2026-11-14", "15:00")).toBe("+11:00");
  });

  it("derives the same zone's winter offset — the reason it isn't a fixed pick", () => {
    // …and on AEST (+10:00) in July. One event list can straddle both.
    expect(zoneOffset("Australia/Sydney", "2026-07-14", "15:00")).toBe("+10:00");
  });

  it("handles a zone that never shifts", () => {
    expect(zoneOffset("Australia/Brisbane", "2026-11-14", "15:00")).toBe("+10:00");
    expect(zoneOffset("Australia/Brisbane", "2026-07-14", "15:00")).toBe("+10:00");
  });

  it("handles a half-hour zone", () => {
    expect(zoneOffset("Asia/Kolkata", "2026-11-14", "15:00")).toBe("+05:30");
  });

  it("handles a negative offset", () => {
    expect(zoneOffset("America/New_York", "2026-11-14", "15:00")).toBe("-05:00");
    expect(zoneOffset("America/New_York", "2026-07-14", "15:00")).toBe("-04:00");
  });

  it("renders zero as +00:00, not Z", () => {
    expect(zoneOffset("UTC", "2026-11-14", "15:00")).toBe("+00:00");
  });

  it("resolves the offset from the WALL-CLOCK time, not the naive UTC reading", () => {
    // 2026-04-05 03:00 in Sydney is after the DST end (02:00 → 03:00 became
    // 02:00 AEST), so it is +10:00. Reading the offset at the naive UTC instant
    // alone would land before the transition and answer +11:00.
    expect(zoneOffset("Australia/Sydney", "2026-04-05", "03:00")).toBe("+10:00");
  });

  it("returns null when the date or time is incomplete", () => {
    expect(zoneOffset("Australia/Sydney", "", "15:00")).toBeNull();
    expect(zoneOffset("Australia/Sydney", "2026-11-14", "")).toBeNull();
  });

  it("returns null for a blank or unresolvable zone, so a caller keeps what it had", () => {
    expect(zoneOffset("", "2026-11-14", "15:00")).toBeNull();
    expect(zoneOffset("Not/AZone", "2026-11-14", "15:00")).toBeNull();
  });
});

describe("timeZoneGroups", () => {
  it("groups zones by region, sorted", () => {
    const groups = timeZoneGroups();
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.map((g) => g.label)).toEqual(groups.map((g) => g.label).toSorted());
    const australia = groups.find((g) => g.label === "Australia");
    expect(australia?.zones).toContain("Australia/Sydney");
  });

  it("offers no zone twice", () => {
    const all = timeZoneGroups().flatMap((g) => g.zones);
    expect(new Set(all).size).toBe(all.length);
  });

  it("leads with an unknown current value, so a <select> can't silently re-home it", () => {
    // A `<select>` whose value matches no option shows the FIRST option instead
    // — an imported zone this tz database doesn't know would look like the
    // portal had moved the wedding to another continent.
    const groups = timeZoneGroups("Mars/Olympus_Mons");
    expect(groups[0]).toEqual({ label: "Current", zones: ["Mars/Olympus_Mons"] });
  });

  it("does not duplicate a current value the database already knows", () => {
    const groups = timeZoneGroups("Australia/Sydney");
    expect(groups[0]?.label).not.toBe("Current");
    expect(groups.flatMap((g) => g.zones).filter((z) => z === "Australia/Sydney")).toHaveLength(1);
  });
});

describe("browserTimeZone / describeTimeZone", () => {
  it("names a zone the runtime resolves", () => {
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("appends the abbreviation for the day in question", () => {
    expect(describeTimeZone("Australia/Sydney", "2026-11-14")).toBe("Australia/Sydney (AEDT)");
    expect(describeTimeZone("Australia/Sydney", "2026-07-14")).toBe("Australia/Sydney (AEST)");
  });

  it("falls back to the bare zone when it can't be resolved", () => {
    expect(describeTimeZone("Not/AZone", "2026-11-14")).toBe("Not/AZone");
  });
});
