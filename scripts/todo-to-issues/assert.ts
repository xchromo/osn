import { phasesOf } from "./phases";
import type { ManifestEntry } from "./types";

export type Violation = { rule: string; where: string; detail: string };

const BUSINESS = [/\bABN\b/, /English Street Ventures/i, /Lemon Squeezy/i, /\bMoR\b/];
const PRIVATE_AREAS = ["area:security", "area:performance", "area:compliance"];

// Locked against the parser's own count of indent-0 open items, checked in at the
// time of the migration. A mismatch means the source files moved under us -- stop
// and reconcile before creating anything.
export const EXPECTED = { public: 197, private: 344 };

export function checkManifest(manifest: ManifestEntry[]): Violation[] {
  const violations: Violation[] = [];
  const at = (e: ManifestEntry) => `${e.sourceFile}:${e.sourceLine}`;

  for (const entry of manifest) {
    if (
      entry.repo === "public" &&
      (entry.labels.some((l) => l.startsWith("severity:")) ||
        entry.labels.some((l) => PRIVATE_AREAS.includes(l)))
    ) {
      violations.push({
        rule: "no-findings-in-public",
        where: at(entry),
        detail: entry.labels.join(", "),
      });
    }

    const business = BUSINESS.find((p) => p.test(entry.issueBody));
    if (business) {
      violations.push({ rule: "no-business-content", where: at(entry), detail: String(business) });
    }

    // Titles and epic names are rendered from headings, which carry wikilinks too.
    for (const field of [entry.issueBody, entry.issueTitle, entry.epic]) {
      if (field.includes("[[")) {
        violations.push({ rule: "no-raw-wikilinks", where: at(entry), detail: entry.issueTitle });
        break;
      }
    }

    const products = entry.labels.filter((l) => l.startsWith("product:"));
    if (products.length !== 1) {
      violations.push({ rule: "one-product-label", where: at(entry), detail: products.join(", ") });
    }

    const areas = entry.labels.filter((l) => l.startsWith("area:"));
    if (areas.length !== 1) {
      violations.push({ rule: "one-area-label", where: at(entry), detail: areas.join(", ") });
    }

    const phases = phasesOf(entry);
    if (phases.length !== 1) {
      violations.push({
        rule: "one-phase",
        where: at(entry),
        detail: phases.length === 0 ? `no phase claims section "${entry.section}"` : phases.join(),
      });
    }
  }

  for (const repo of ["public", "private"] as const) {
    const actual = manifest.filter((e) => e.repo === repo).length;
    if (actual !== EXPECTED[repo]) {
      violations.push({
        rule: "expected-counts",
        where: repo,
        detail: `expected ${EXPECTED[repo]}, got ${actual}`,
      });
    }
  }

  return violations;
}
