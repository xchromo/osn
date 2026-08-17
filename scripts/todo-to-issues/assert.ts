import { phasesOf } from "./phases";
import { PRIVATE_OVERRIDES } from "./private-overrides";
import type { ManifestEntry } from "./types";

export type Violation = { rule: string; where: string; detail: string };

const BUSINESS = [/\bABN\b/, /English Street Ventures/i, /Lemon Squeezy/i, /\bMoR\b/];
const PRIVATE_AREAS = new Set(["area:security", "area:performance", "area:compliance"]);

// Locked against the parser's own count of indent-0 open items, checked in at the
// time of the migration. A mismatch means the source files moved under us -- stop
// and reconcile before creating anything.
export const EXPECTED = { public: 185, private: 356 };

export function checkManifest(manifest: ManifestEntry[]): Violation[] {
  const violations: Violation[] = [];
  const at = (e: ManifestEntry) => `${e.sourceFile}:${e.sourceLine}`;

  for (const entry of manifest) {
    if (
      entry.repo === "public" &&
      (entry.labels.some((l) => l.startsWith("severity:")) ||
        entry.labels.some((l) => PRIVATE_AREAS.has(l)))
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

    // Zero is the ordinary case for product work: there is no `area:feature`,
    // because the issue type already says Feature. Two would mean a finding
    // filed under a second area, which is a routing question, so it fails.
    const areas = entry.labels.filter((l) => l.startsWith("area:"));
    if (areas.length > 1) {
      violations.push({
        rule: "at-most-one-area-label",
        where: at(entry),
        detail: areas.join(", "),
      });
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

  // An override names a file and a line. Edit the source above that line and it slides,
  // the override stops matching, and the item routes public with no error -- the exact
  // silence this whole gate exists to break.
  for (const override of PRIVATE_OVERRIDES) {
    const fromFile = manifest.filter((e) => e.sourceFile === override.file);
    // A manifest that never touched the file cannot say anything about the override.
    // Once the file is in, though, a missing line is a shifted line and must fail.
    if (fromFile.length === 0) continue;
    const matched = fromFile.filter((e) => e.sourceLine === override.line);
    if (matched.length !== 1) {
      violations.push({
        rule: "overrides-matched",
        where: `${override.file}:${override.line}`,
        detail: `matched ${matched.length} items, expected 1 -- has the source moved?`,
      });
      continue;
    }
    const entry = matched[0]!;
    // The title check is the one that catches a shifted line: the override still finds
    // *an* item there, just not the one it was written for.
    if (!entry.title.includes(override.titleIncludes)) {
      violations.push({
        rule: "overrides-matched",
        where: `${override.file}:${override.line}`,
        detail: `line now holds "${entry.issueTitle}", not "${override.titleIncludes}"`,
      });
    } else if (entry.repo !== "private") {
      violations.push({
        rule: "overrides-matched",
        where: `${override.file}:${override.line}`,
        detail: `override did not take: routed ${entry.repo}`,
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
