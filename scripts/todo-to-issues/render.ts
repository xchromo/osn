import type { Classified, ManifestEntry } from "./types";
import { rewriteWikilinks } from "./wikilinks";

export const PUBLIC_BLOB = "https://github.com/xchromo/osn/blob/main";
const MAX_TITLE = 120;

/** Markdown down to bare words. Headings and titles both become issue titles. */
export function plainText(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*|__|\*|_/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim();
}

function truncate(text: string): string {
  if (text.length <= MAX_TITLE) return text;
  const cut = text.slice(0, MAX_TITLE);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > 0 ? boundary : MAX_TITLE).trimEnd()}…`;
}

export function renderTitle(item: Classified): string {
  return truncate(plainText(item.title));
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
