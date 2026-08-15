/**
 * Move the completed checklist items into the changelog.
 *
 * Phase 4 turns the TODO files into pointer pages, so every `- [x]` item in
 * them is about to lose its only home. There are 663 of them across eleven
 * files -- too many to move by hand, and the prose is the record, so it is
 * copied verbatim rather than summarised.
 *
 * An item is not one line. A completed item owns every line indented under it:
 * sub-items, wrapped prose, code fences. The block is taken whole.
 */
const SOURCES = ["wiki/TODO.md"];
const CIRE = "cire/wiki/todo/*.md";

const CHANGELOG = {
  security: "wiki/changelog/security-fixes.md",
  performance: "wiki/changelog/performance-fixes.md",
  compliance: "wiki/changelog/compliance-fixes.md",
  features: "wiki/changelog/completed-features.md",
} as const;

export type Kind = keyof typeof CHANGELOG;

export type Block = {
  /** The item and everything indented under it, verbatim. */
  lines: string[];
  /** The nearest `##`/`###` heading above it, for context in the changelog. */
  section: string;
  sourceFile: string;
  kind: Kind;
};

const DONE = /^(\s*)- \[x\]/i;
const HEADING = /^(#{2,4})\s+(.*)$/;

/** How far a line is indented, in spaces. A tab counts as two. */
export function indentOf(line: string): number {
  const lead = /^[\t ]*/.exec(line)?.[0] ?? "";
  return lead.replace(/\t/g, "  ").length;
}

/**
 * Which changelog an item belongs in. The finding ID is the strongest signal
 * and it wins outright -- a `S-` item filed under a "Cire" heading is still a
 * security fix. Only when there is no ID does the heading, and then the file,
 * decide.
 */
export function kindOf(text: string, section: string, sourceFile: string): Kind {
  // The tiers are the ones in wiki/conventions/review-findings.md: security is
  // C/H/M/L, performance is C/W/I, compliance is H/M/L. The trailing digit is
  // optional -- plenty of findings are written `S-H (some-slug)`.
  if (/\bS-[CHML]\d*\b/.test(text)) return "security";
  if (/\bP-[CWI]\d*\b/.test(text)) return "performance";
  if (/\bC-[HML]\d*\b/.test(text)) return "compliance";

  const where = `${section} ${sourceFile}`.toLowerCase();
  if (where.includes("security")) return "security";
  if (where.includes("performance") || where.includes("/perf")) return "performance";
  if (where.includes("compliance")) return "compliance";
  return "features";
}

/** Split a file into completed-item blocks, each tagged with its heading. */
export function parseBlocks(markdown: string, sourceFile: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let section = "";
  let fenced = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      section = heading[2].trim();
      continue;
    }

    const done = DONE.exec(line);
    if (!done) continue;

    const depth = indentOf(line);
    const body = [line];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const next = lines[j];
      // A blank line only belongs to the block if something indented follows.
      if (next.trim() === "") {
        const after = lines[j + 1];
        if (after && after.trim() !== "" && indentOf(after) > depth) {
          body.push(next);
          continue;
        }
        break;
      }
      if (indentOf(next) <= depth) break;
      body.push(next);
    }
    i = j - 1;

    blocks.push({
      lines: body,
      section,
      sourceFile,
      kind: kindOf(body.join(" "), section, sourceFile),
    });
  }
  return blocks;
}

/**
 * The text appended to one changelog. Items keep their `- [x]` prefix, which
 * is what every entry already in these files uses, and stay grouped by the
 * heading they lived under so the context survives the move.
 */
export function renderAppendix(blocks: Block[], date: string): string {
  const bySection = new Map<string, Block[]>();
  for (const block of blocks) {
    const key = `${block.sourceFile} — ${block.section || "(no section)"}`;
    const bucket = bySection.get(key);
    if (bucket) bucket.push(block);
    else bySection.set(key, [block]);
  }

  const out = [`## Migrated from TODO.md (${date})`, ""];
  out.push(
    `Moved here when the checklists were retired for GitHub Issues. Prose is verbatim; ${blocks.length} items.`,
    "",
  );
  for (const [key, bucket] of bySection) {
    out.push(`### ${key}`, "");
    for (const block of bucket) out.push(...block.lines);
    out.push("");
  }
  return out.join("\n");
}

if (import.meta.main) {
  const apply = Bun.argv.includes("--apply");
  const date = Bun.argv.includes("--date")
    ? Bun.argv[Bun.argv.indexOf("--date") + 1]
    : new Date().toISOString().slice(0, 10);

  const files = [...SOURCES];
  for await (const path of new Bun.Glob(CIRE).scan(".")) files.push(path);
  files.sort();

  const all: Block[] = [];
  for (const path of files) {
    all.push(...parseBlocks(await Bun.file(path).text(), path));
  }

  const kinds: Kind[] = ["security", "performance", "compliance", "features"];
  for (const kind of kinds) {
    const blocks = all.filter((b) => b.kind === kind);
    console.log(`${CHANGELOG[kind]}  ${blocks.length} items`);
    if (!apply || blocks.length === 0) continue;

    const target = CHANGELOG[kind];
    const existing = await Bun.file(target)
      .text()
      .catch(() => "");
    if (existing.includes(`## Migrated from TODO.md (${date})`)) {
      console.log(`  already folded, skipping`);
      continue;
    }
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    await Bun.write(target, `${existing}${separator}${renderAppendix(blocks, date)}`);
  }

  console.log(`${all.length} items total across ${files.length} files`);
  if (!apply) console.log("\nre-run with --apply");
}
