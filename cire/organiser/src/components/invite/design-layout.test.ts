import { DEFAULT_DESIGN_ID, DESIGNS } from "@cire/invite-designs";
import { describe, expect, it } from "vitest";

import { designLayout } from "./design-layout";

/**
 * Drift guard for the preview's design shapes. The catalog is the source of
 * truth for what packs exist; this table is the source of truth for how each
 * one previews. A new catalog entry with no row here would silently preview as
 * Classic — the exact bug the table was added to fix — so that fails a test.
 */
describe("designLayout", () => {
  it("gives every catalog design its own shape", () => {
    const shapes = DESIGNS.map((d) => JSON.stringify(designLayout(d.id)));
    expect(new Set(shapes).size).toBe(DESIGNS.length);
  });

  it("distinguishes the two shipped packs where they actually differ", () => {
    const classic = designLayout("classic");
    const gala = designLayout("gala");
    expect(classic.heroAnchor).toBe("center");
    expect(gala.heroAnchor).toBe("bottom-left");
    expect(classic.align).toBe("center");
    expect(gala.align).toBe("left");
    expect(classic.welcome).toBe("band");
    expect(gala.welcome).toBe("panel");
    expect(classic.eventsRule).toBe(false);
    expect(gala.eventsRule).toBe(true);
  });

  it("falls back to the default pack for an unknown or absent id", () => {
    const fallback = designLayout(DEFAULT_DESIGN_ID);
    expect(designLayout("not-a-design")).toEqual(fallback);
    expect(designLayout(null)).toEqual(fallback);
    expect(designLayout(undefined)).toEqual(fallback);
  });
});
