import type { ManifestEntry } from "./types";

/**
 * Which migration phase an item belongs to. In-flight work goes first (phase 1),
 * then planned work (phase 2), then the review backlogs into the private repo
 * (phase 3). Every item must match exactly one -- `checkManifest` enforces it, so
 * renaming a heading in the source fails the gate instead of dropping the item.
 */
export const PHASES: Record<string, (e: ManifestEntry) => boolean> = {
  "1": (e) =>
    e.repo === "public" &&
    (e.sourceFile.startsWith("cire/") ||
      ["Up Next", "Landing", "OSN Core", "Pulse", "Cire"].some((s) => e.section.startsWith(s))),
  "2": (e) =>
    e.repo === "public" &&
    ["Zap", "Verified Identity", "Platform", "Auth Improvements", "Future"].some((s) =>
      e.section.startsWith(s),
    ),
  "3": (e) => e.repo === "private",
};

export function phasesOf(entry: ManifestEntry): string[] {
  return Object.entries(PHASES)
    .filter(([, select]) => select(entry))
    .map(([phase]) => phase);
}
