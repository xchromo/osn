import { Glob } from "bun";

import { checkManifest } from "./assert";
import { classify } from "./classify";
import { createIssue, ghApi, linkSubIssue, Throttle } from "./github";
import { parseTodo } from "./parse";
import { PHASES } from "./phases";
import { buildManifest } from "./render";
import type { ManifestEntry } from "./types";
import { buildWikiIndex } from "./wikilinks";

const SOURCES = ["wiki/TODO.md", ...new Glob("cire/wiki/todo/*.md").scanSync(".")].sort();
const MANIFEST = ".migration/manifest.json";
const CREATED = ".migration/created.json";

const REPOS = { public: "xchromo/osn", private: "xchromo/osn-tracker" };

async function wikiIndex(): Promise<Map<string, string>> {
  const paths = [
    ...new Glob("wiki/**/*.md").scanSync("."),
    ...new Glob("cire/wiki/**/*.md").scanSync("."),
  ];
  return buildWikiIndex(paths.sort());
}

export async function plan(): Promise<ManifestEntry[]> {
  const index = await wikiIndex();
  const classified = [];
  for (const source of SOURCES) {
    const markdown = await Bun.file(source).text();
    classified.push(...parseTodo(markdown, source).map(classify));
  }
  return buildManifest(classified, index);
}

async function apply(phase: string): Promise<void> {
  const manifest = await plan();
  const violations = checkManifest(manifest);
  if (violations.length > 0) {
    throw new Error(`refusing to apply: ${violations.length} violations -- run migrate:verify`);
  }

  const select = PHASES[phase];
  if (!select) throw new Error(`unknown phase: ${phase}`);

  const state: Record<string, { number: number; id: string }> = await Bun.file(CREATED)
    .json()
    .catch(() => ({}));
  const entries = manifest.filter(select);
  const throttle = new Throttle(8_000);
  const save = () => Bun.write(CREATED, `${JSON.stringify(state, null, 2)}\n`);
  const key = (e: ManifestEntry) => `${e.sourceFile}:${e.sourceLine}`;

  // Epics first, so every child has a parent to attach to.
  for (const epic of new Set(entries.map((e) => e.epic))) {
    const sample = entries.find((e) => e.epic === epic)!;
    const epicKey = `epic:${sample.repo}:${epic}`;
    if (state[epicKey]) continue;
    await throttle.wait();
    state[epicKey] = await createIssue(ghApi, REPOS[sample.repo], {
      title: epic,
      body: `Epic. Migrated from \`${sample.sourceFile}\` — section "${epic}".`,
      labels: ["epic", sample.labels.find((l) => l.startsWith("product:"))!],
    });
    await save();
    console.log(`epic  #${state[epicKey].number}  ${epic}`);
  }

  for (const entry of entries) {
    if (state[key(entry)]) continue;
    await throttle.wait();
    state[key(entry)] = await createIssue(ghApi, REPOS[entry.repo], {
      title: entry.issueTitle,
      body: entry.issueBody,
      labels: entry.labels,
    });
    await save();
    console.log(`issue #${state[key(entry)].number}  ${entry.issueTitle.slice(0, 60)}`);
  }

  for (const entry of entries) {
    const child = state[key(entry)];
    const parent = state[`epic:${entry.repo}:${entry.epic}`];
    if (!child || !parent || state[`link:${key(entry)}`]) continue;
    await throttle.wait();
    await linkSubIssue(ghApi, REPOS[entry.repo], parent.number, child.id);
    state[`link:${key(entry)}`] = child;
    await save();
  }
}

if (import.meta.main) {
  const command = Bun.argv[2] ?? "plan";
  if (command === "plan") {
    const manifest = await plan();
    await Bun.write(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    const counts = manifest.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.repo] = (acc[entry.repo] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`${manifest.length} items -> ${MANIFEST}`);
    console.log(`  public:  ${counts.public ?? 0}`);
    console.log(`  private: ${counts.private ?? 0}`);
  } else if (command === "verify") {
    const violations = checkManifest(await plan());
    if (violations.length === 0) {
      console.log("manifest clear");
    } else {
      for (const v of violations) console.error(`${v.rule}  ${v.where}  ${v.detail}`);
      console.error(`\n${violations.length} violations`);
      process.exit(1);
    }
  } else if (command === "apply") {
    await apply(Bun.argv[3] ?? "");
  } else {
    console.error(`unknown command: ${command}`);
    process.exit(1);
  }
}
