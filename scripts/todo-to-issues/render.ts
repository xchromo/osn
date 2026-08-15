import type { Classified, ManifestEntry } from "./types";
import { rewriteWikilinks } from "./wikilinks";

export const PUBLIC_BLOB = "https://github.com/xchromo/osn/blob/main";
const MAX_TITLE = 120;
const MIN_LEAD = 25;
/** A trailing "See [[page]]" points at reading, not at work. The body keeps it. */
const SEE_ALSO = /[\s.;,—-]*\bsee\s+`?\[\[[^\]]+\]\]`?[.\s]*$/i;

/** Markdown down to bare words. Headings and titles both become issue titles. */
export function plainText(text: string): string {
  return (
    text
      .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*|\*/g, "")
      // `_` only pairs as emphasis between word boundaries. A blanket strip eats
      // the underscores out of snake_case, and these lines are full of column
      // names -- `weddings.owner_osn_profile_id` must survive intact.
      .replace(/(^|[^\w`])__?([^_`]+?)__?(?=\W|$)/g, "$1$2")
      .replace(/\s+/g, " ")
      .replace(/[.,;:]+$/, "")
      .trim()
  );
}

function truncate(text: string): string {
  if (text.length <= MAX_TITLE) return text;
  const cut = text.slice(0, MAX_TITLE);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > 0 ? boundary : MAX_TITLE).trimEnd()}…`;
}

/**
 * The lead of an item — what belongs in the issue title. These lines are written
 * as `**A short claim.** then the whole argument`, sometimes running past 500
 * characters, so a blind cut at MAX_TITLE lands mid-clause and reads as noise.
 * Only an over-long line is cut down: anything that fits is its own title, whole.
 */
export function leadOf(raw: string): string {
  const plain = plainText(raw.replace(SEE_ALSO, ""));
  if (plain.length <= MAX_TITLE) return plain;

  // The author's own bold span is the title when there is one long enough to
  // stand alone. A short one ("Marketing depth") names the subject, not the
  // claim, so fall through and take the first clause instead.
  const bold = /^\s*\*\*(.+?)\*\*/.exec(raw);
  const lead = bold ? plainText(bold[1]!) : "";
  if (lead.length >= MIN_LEAD) return lead;

  // A terminator must be followed by whitespace or nothing, so `wiki/TODO.md is
  // stale` is not two sentences. `;` counts: most of these lines are one clause
  // of claim then the supporting detail, and unlike `,` it almost never falls
  // inside parentheses.
  const clause = new RegExp(String.raw`^(.{${MIN_LEAD},}?[.!?;])(\s|$)`).exec(plain);
  return clause ? plainText(clause[1]!) : plain;
}

export function renderTitle(item: Classified): string {
  return truncate(leadOf(item.title));
}

/**
 * The heading path an item came from, as it appears in the footer and epic title.
 * The cire shards head their sections at `###` with no `##` above, so the section
 * is often empty -- joining blind would leave a dangling separator.
 */
export function renderHeading(
  item: Pick<Classified, "section" | "subsection" | "sourceFile">,
  separator = " / ",
): string {
  const parts = [plainText(item.section), plainText(item.subsection ?? "")].filter((p) => p !== "");
  if (parts.length === 0) return item.sourceFile;
  return parts.join(separator);
}

export function renderBody(item: Classified, index: Map<string, string>): string {
  const parts = [
    rewriteWikilinks(item.title, index, PUBLIC_BLOB),
    item.body ? rewriteWikilinks(item.body, index, PUBLIC_BLOB) : "",
    "---",
    `Migrated from \`${item.sourceFile}:${item.sourceLine}\` — section "${renderHeading(item)}".`,
  ];
  return parts.filter((p) => p !== "").join("\n\n");
}

export function buildManifest(items: Classified[], index: Map<string, string>): ManifestEntry[] {
  return items.map((item) => ({
    ...item,
    issueTitle: renderTitle(item),
    issueBody: renderBody(item, index),
    epic: truncate(renderHeading(item, " — ")),
  }));
}
