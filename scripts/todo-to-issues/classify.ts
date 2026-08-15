import { overrideFor } from "./private-overrides";
import type { Classified, Item, Severity } from "./types";

// Leading `**` is stripped first. Most backlog items bold their ID, and an ID that
// fails to match here routes a finding to the public repo -- the one unrecoverable
// mistake in this migration.
// The tail is `(?![0-9A-Za-z-])` rather than `\b` so a trailing `_` from italics ends the
// ID. `\b` treats `_` as a word character, so `_C-M19_` matched nothing at all.
const FINDING = /^(S|P|C|T)-(C|H|M|L|W|I)(\d*)(?![0-9A-Za-z-])/;
const EMPHASIS = /^[*_\s]+/;

/** The area a finding ID implies, which outranks whatever section it was filed under. */
const FINDING_AREA: Record<string, string> = { S: "security", P: "performance", C: "compliance" };

const SEVERITY: Record<string, Severity> = {
  C: "critical",
  H: "high",
  W: "high",
  M: "medium",
  L: "low",
  I: "info",
};

// "dashboard" is deliberately absent -- it names a product surface, not ops work.
const OPS = /\b(deploy|deployment|secrets?|wrangler|cron|DNS|WAF|Cloudflare|CI)\b/i;

export function findingId(title: string): string | null {
  const match = FINDING.exec(title.trim().replace(EMPHASIS, ""));
  return match ? `${match[1]}-${match[2]}${match[3]}` : null;
}

export function severityOf(id: string): Severity | null {
  const match = FINDING.exec(id);
  return match ? SEVERITY[match[2]] : null;
}

function areaOf(item: Item, id: string | null): string {
  const { section, sourceFile } = item;
  // A finding carries its area in its ID wherever it was filed. Several live in
  // Up Next and Platform rather than a backlog section.
  const byId = id ? FINDING_AREA[id[0]!] : undefined;
  if (byId) return byId;
  if (section.startsWith("Security Backlog") || sourceFile.endsWith("todo/security.md")) {
    return "security";
  }
  if (section.startsWith("Performance Backlog") || sourceFile.endsWith("todo/perf.md")) {
    return "performance";
  }
  if (section.startsWith("Compliance Backlog")) return "compliance";
  if (sourceFile.endsWith("todo/db.md")) return "schema";
  if (OPS.test(item.title)) return "ops";
  return "feature";
}

function productOf(item: Item): string {
  const { section, sourceFile, title } = item;
  if (sourceFile.startsWith("cire/") || section.startsWith("Cire")) return "cire";
  if (section.startsWith("Pulse")) return "pulse";
  if (section.startsWith("Zap")) return "zap";
  if (section.startsWith("Landing")) return "landing";
  if (section === "Platform") return "shared";
  if (
    section.startsWith("OSN Core") ||
    section.startsWith("Verified Identity") ||
    section.startsWith("Auth Improvements")
  ) {
    return "osn-core";
  }
  const slug = /^[SPCT]-[CHMLWI]\d*\s*\(([a-z-]+)/.exec(title.trim().replace(EMPHASIS, ""))?.[1];
  const haystack = `${slug ?? ""} ${title}`;
  if (/\bcire\b/i.test(haystack)) return "cire";
  if (/\bpulse\b/i.test(haystack)) return "pulse";
  if (/\bzap\b/i.test(haystack)) return "zap";
  return "osn-core";
}

export function classify(item: Item): Classified {
  const id = findingId(item.title);
  const override = overrideFor(item);
  const area = override?.area ?? areaOf(item, id);
  const severity = id ? severityOf(id) : null;
  const labels = [`product:${override?.product ?? productOf(item)}`, `area:${area}`];
  if (severity) labels.push(`severity:${severity}`);
  const repo =
    area === "security" || area === "performance" || area === "compliance" ? "private" : "public";
  return { ...item, repo, labels, findingId: id, severity };
}
