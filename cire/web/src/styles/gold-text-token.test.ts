import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Drift guard for the split between the two golds.
 *
 * `--color-gold` is the METAL — rules, borders, fills, icons, large display
 * text — and `derivePalette` deliberately holds it to the 3:1 WCAG UI floor so
 * a genuinely gold gold survives instead of being bleached into a cream.
 * `--color-gold-ink` is the same hue walked to the 4.5:1 TEXT minimum against
 * all three surfaces. Painting normal-size text in the metal is therefore a
 * WCAG 1.4.3 failure by construction, and it is the failure that shipped: a
 * live invite's RSVP-by line measured 3.35:1.
 *
 * Nothing else catches it. happy-dom computes no colour, so no component test
 * can observe a ratio; the palette tests prove each TOKEN clears its bar but
 * cannot know which one a given element uses; and a build succeeds either way.
 * The usage rule is plain source text, so this class of breakage is
 * mechanically checkable even though the rendering is not.
 *
 * Deliberately an explicit allow-list rather than a size heuristic: parsing
 * `text-[calc(clamp(2.5rem,8vw,5.5rem)*var(--invite-heading-scale,1))]` to
 * decide whether it clears 24px is exactly the kind of cleverness that fails
 * open. A new `text-gold` has to be justified here, in one line, by a human.
 */

const SRC = join(import.meta.dirname, "..");

/** Every `text-gold` that is NOT `text-gold-ink` / `text-gold-dim`. */
const METAL = /text-gold(?![-/\w])/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(tsx|astro)$/.test(entry) && !entry.includes(".test.")) out.push(path);
  }
  return out;
}

/**
 * The only elements allowed to paint text in the metal, and why each clears
 * WCAG's large-text bar (24px normal / 18.66px bold) or is exempt from it.
 *
 * The heading sizes below are `clamp()` minimums multiplied by the organiser's
 * heading scale, whose smallest value is `0.85` (`HEADING_SIZE_SCALES` in
 * `@cire/theme`) — so the figure quoted is the smallest each can actually
 * render at, not the value read off the class.
 */
const ALLOWED: { file: string; reason: string }[] = [
  {
    file: "components/LoginSection.tsx",
    reason: "the claim heading — clamp(2rem,…) × 0.85 = 27.2px, large text",
  },
  {
    file: "components/MapPreview.tsx",
    reason: "the map pin — an SVG icon, a graphical object at the 3:1 bar, not text",
  },
  {
    file: "components/NotFoundDocument.astro",
    reason: "the 404 numeral — clamp(3rem,…) = 48px, large text",
  },
  {
    file: "designs/classic/InviteHeader.tsx",
    reason: "the hero couple names — clamp(2.5rem,…) × 0.85 = 34px, large text",
  },
  {
    file: "designs/gala/InviteHeader.tsx",
    reason: "the hero couple names — clamp(2.75rem,…) × 0.85 = 37.4px, large text",
  },
];

describe("gold token usage", () => {
  it("paints no normal-size text in the metal gold", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => METAL.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(SRC.length + 1).replaceAll("\\", "/"))
      .toSorted();

    expect(offenders).toEqual(ALLOWED.map((a) => a.file).toSorted());
  });

  it("keeps the raw-CSS layouts on the prose token too", () => {
    // `SiteFooter.astro` and `LegalLayout.astro` style text with
    // `var(--color-gold…)` directly rather than a Tailwind utility, so the scan
    // above (which matches the utility) cannot see them. Their text colours must
    // be the prose token; `--color-gold-dim` borders and chip backgrounds are UI
    // and stay the metal.
    // Reported as {file, metal} pairs rather than asserted per declaration, so
    // a failure names the file and the offending declaration in one diff.
    const found = ["components/SiteFooter.astro", "layouts/LegalLayout.astro"].map((file) => {
      const declarations =
        readFileSync(join(SRC, file), "utf8").match(/color:\s*var\(--color-gold[^)]*\)/g) ?? [];
      return {
        file,
        // Guards the scan itself: zero matches would make the check below pass
        // vacuously if the selector or the variable name is ever renamed.
        count: declarations.length > 0,
        metal: declarations.filter((d) => !d.includes("--color-gold-ink")),
      };
    });

    expect(found).toEqual([
      { file: "components/SiteFooter.astro", count: true, metal: [] },
      { file: "layouts/LegalLayout.astro", count: true, metal: [] },
    ]);
  });

  it("declares the prose token so every swapped utility resolves", () => {
    // A `text-gold-ink` with no `--color-gold-ink` in `@theme` emits no CSS at
    // all — Tailwind silently drops an unknown utility — so the sweep would
    // leave the text unstyled rather than dark. Pin the pair.
    const css = readFileSync(join(SRC, "styles/global.css"), "utf8");
    expect(css).toMatch(/--color-gold-ink:/);
  });
});
