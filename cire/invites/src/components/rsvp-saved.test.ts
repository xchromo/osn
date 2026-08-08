import { describe, expect, it } from "vitest";

import { SAVED_DWELL_MIN_MS, SAVED_DWELL_MS, savedDwellMs } from "./rsvp-saved";

/**
 * The RSVP sheet's own confirmation is just a held "Saved" label now — the
 * animated half (the sweep, the tick, the tick keyframe in `global.css`) moved
 * to the Respond button and is pinned in `rsvp-responded.test.ts`. What is
 * left to guard here is the dwell itself, and the budget arithmetic that keeps
 * a slow round-trip from stacking on top of it.
 */
describe("RSVP sheet dwell", () => {
  it("holds long enough to read, not just a frame", () => {
    expect(SAVED_DWELL_MIN_MS).toBeGreaterThanOrEqual(250);
  });

  it("stays short enough that the sheet never feels stuck", () => {
    // Budget, not a fixed hold — this is the WHOLE wait after the click on a
    // fast reply, and the ceiling on it for any reply.
    expect(SAVED_DWELL_MS).toBeLessThanOrEqual(700);
  });

  it("keeps the floor under the budget, so the budget is genuinely the maximum", () => {
    // Every test in this package advances fake timers by `SAVED_DWELL_MS` to
    // land the close. That only works while no input can make `savedDwellMs`
    // return more than it.
    expect(SAVED_DWELL_MIN_MS).toBeLessThanOrEqual(SAVED_DWELL_MS);
  });
});

describe("savedDwellMs", () => {
  it("spends the whole budget when the reply was instant", () => {
    expect(savedDwellMs(0)).toBe(SAVED_DWELL_MS);
  });

  it("deducts the wait already spent rather than adding to it", () => {
    // The bug this exists to fix: a guest used to wait `round-trip + dwell`.
    // Now the round-trip comes OUT of the dwell, so click-to-close stays put.
    const requestMs = 200;
    expect(savedDwellMs(requestMs)).toBe(SAVED_DWELL_MS - requestMs);
    expect(requestMs + savedDwellMs(requestMs)).toBe(SAVED_DWELL_MS);
  });

  it("never drops below the floor, however slow the reply was", () => {
    // "Saving…" is not a confirmation — only the dwell shows "Saved" — so a
    // request that outran the entire budget must not collapse the one state
    // that tells the guest their reply landed.
    expect(savedDwellMs(SAVED_DWELL_MS)).toBe(SAVED_DWELL_MIN_MS);
    expect(savedDwellMs(10_000)).toBe(SAVED_DWELL_MIN_MS);
  });

  it("never exceeds the budget, so the fake-timer advance in every other test still lands the close", () => {
    for (const requestMs of [-5000, -1, 0, 1, 50, 599, 600, 601, 5000]) {
      expect(savedDwellMs(requestMs)).toBeLessThanOrEqual(SAVED_DWELL_MS);
      expect(savedDwellMs(requestMs)).toBeGreaterThanOrEqual(SAVED_DWELL_MIN_MS);
    }
  });

  it("falls back to the floor on a non-finite measurement", () => {
    // `Math.max` loses to NaN, which would hand `setTimeout` a NaN delay — and
    // a NaN delay fires immediately, i.e. the sheet vanishes with no
    // confirmation at all. Guarded explicitly rather than left to arithmetic.
    expect(savedDwellMs(Number.NaN)).toBe(SAVED_DWELL_MIN_MS);
  });
});
