import type { Item } from "./types";

const HEADING = /^(#{1,6})\s+(.*)$/;
const TOP_ITEM = /^- \[( |x)\]\s+(.*)$/;
const RULE = /^---\s*$/;

export function parseTodo(markdown: string, sourceFile: string): Item[] {
  const lines = markdown.split("\n");
  const items: Item[] = [];
  let section = "";
  let subsection: string | null = null;
  let open: (Item & { bodyLines: string[] }) | null = null;

  const flush = () => {
    if (!open) return;
    while (open.bodyLines.length > 0 && open.bodyLines.at(-1)!.trim() === "") {
      open.bodyLines.pop();
    }
    const { bodyLines, ...rest } = open;
    items.push({ ...rest, body: bodyLines.join("\n") });
    open = null;
  };

  for (const [index, line] of lines.entries()) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      // The cire shards head their only section at `#` (`# cire/api`), so a rule
      // that reads `##` alone leaves those items sectionless and the epic falls
      // back to a file path. A `#` in wiki/TODO.md is the document title, which
      // the first `##` overwrites before any item is reached.
      if (heading[1].length <= 2) {
        section = heading[2].trim();
        subsection = null;
      } else if (heading[1].length === 3) {
        subsection = heading[2].trim();
      }
      continue;
    }

    if (RULE.test(line)) {
      flush();
      continue;
    }

    const item = TOP_ITEM.exec(line);
    if (item) {
      flush();
      if (item[1] === " ") {
        open = {
          sourceFile,
          sourceLine: index + 1,
          section,
          subsection,
          title: item[2].trim(),
          body: "",
          bodyLines: [],
        };
      }
      continue;
    }

    open?.bodyLines.push(line);
  }

  flush();
  return items;
}
