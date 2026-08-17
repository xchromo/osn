import { Glob } from "bun";

import { checkManifest } from "./assert";
import { classify } from "./classify";
import {
  createIssueOnce,
  ghApi,
  linkSubIssue,
  readIssue,
  setIssueType,
  Throttle,
  updateIssue,
} from "./github";
import { issueType } from "./issue-type";
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

async function apply(phase: string, limit = Infinity): Promise<void> {
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

  // A run may be capped, so a first batch can be read on GitHub before the rest
  // follows. Every write is recorded in CREATED, so the next run resumes where
  // this one stopped rather than repeating it.
  let budget = limit;
  const spend = async () => {
    if (budget <= 0) return false;
    budget -= 1;
    await throttle.wait();
    return true;
  };

  // Epics first, so every child has a parent to attach to.
  for (const epic of new Set(entries.map((e) => e.epic))) {
    const sample = entries.find((e) => e.epic === epic)!;
    const epicKey = `epic:${sample.repo}:${epic}`;
    if (state[epicKey]) continue;
    if (!(await spend())) break;
    state[epicKey] = await createIssueOnce(ghApi, REPOS[sample.repo], {
      title: epic,
      body: `Epic. Migrated from \`${sample.sourceFile}\` — section "${epic}".`,
      labels: ["epic", sample.labels.find((l) => l.startsWith("product:"))!],
    });
    await save();
    console.log(`epic  #${state[epicKey].number}  ${epic}`);
  }

  for (const entry of entries) {
    if (state[key(entry)]) continue;
    if (!(await spend())) break;
    state[key(entry)] = await createIssueOnce(ghApi, REPOS[entry.repo], {
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
    if (!(await spend())) break;
    await linkSubIssue(ghApi, REPOS[entry.repo], parent.number, child.id);
    state[`link:${key(entry)}`] = child;
    await save();
  }
}

/**
 * Give every created issue its GitHub issue type.
 *
 * Types are an org-level field a Project can group and filter on, and they were
 * adopted after the first issues had been filed. Each issue that has been set
 * is remembered in CREATED, so a stopped run resumes rather than repeating the
 * ones it already did.
 */
async function types(limit = Infinity): Promise<void> {
  const manifest = await plan();
  const state: Record<string, { number: number; id: string }> = await Bun.file(CREATED)
    .json()
    .catch(() => ({}));

  const targets: { key: string; repo: string; number: number; type: string }[] = [];
  for (const entry of manifest) {
    const created = state[`${entry.sourceFile}:${entry.sourceLine}`];
    if (created) {
      targets.push({
        key: `type:${entry.sourceFile}:${entry.sourceLine}`,
        repo: REPOS[entry.repo],
        number: created.number,
        type: issueType(entry.labels),
      });
    }
    const epicKey = `epic:${entry.repo}:${entry.epic}`;
    const epic = state[epicKey];
    if (epic && !targets.some((t) => t.key === `type:${epicKey}`)) {
      targets.push({
        key: `type:${epicKey}`,
        repo: REPOS[entry.repo],
        number: epic.number,
        type: issueType(["epic"]),
      });
    }
  }

  const throttle = new Throttle(8_000);
  const save = () => Bun.write(CREATED, `${JSON.stringify(state, null, 2)}\n`);
  let budget = limit;
  let done = 0;
  for (const target of targets) {
    // The marker records which type was set, so a later change to the mapping
    // re-applies rather than being mistaken for work already done.
    if (state[target.key]?.id === target.type || budget <= 0) continue;
    budget -= 1;
    await throttle.wait();
    await setIssueType(ghApi, target.repo, target.number, target.type);
    state[target.key] = { number: target.number, id: target.type };
    await save();
    done += 1;
    console.log(`type  #${target.number}  ${target.type}`);
  }
  console.log(`${targets.length} issues, ${done} set this run`);
}

/**
 * Push a corrected rendering onto issues already created. A defect in the
 * rendering can surface hundreds of calls into a run, and the alternative is
 * editing them by hand. Only issues whose title or body actually moved are
 * touched, so a repeat run is free.
 */
async function resync(limit = Infinity): Promise<void> {
  const manifest = await plan();
  const state: Record<string, { number: number; id: string }> = await Bun.file(CREATED)
    .json()
    .catch(() => ({}));

  // A read is an ordinary GET against the 5,000/hr allowance, so it needs
  // nothing like the gap a write does. Only the PATCH is content creation.
  const reads = new Throttle(500);
  const writes = new Throttle(8_000);
  let budget = limit;
  let checked = 0;
  let changed = 0;
  for (const entry of manifest) {
    const created = state[`${entry.sourceFile}:${entry.sourceLine}`];
    if (!created || budget <= 0) continue;
    const repo = REPOS[entry.repo];
    await reads.wait();
    const live = await readIssue(ghApi, repo, created.number);
    checked += 1;
    if (live.title === entry.issueTitle && live.body === entry.issueBody) continue;
    budget -= 1;
    changed += 1;
    await writes.wait();
    await updateIssue(ghApi, repo, created.number, {
      title: entry.issueTitle,
      body: entry.issueBody,
    });
    console.log(`resync #${created.number}  ${entry.issueTitle.slice(0, 60)}`);
  }
  console.log(`${checked} checked, ${changed} updated`);
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
  } else if (command === "apply" || command === "resync" || command === "types") {
    const flag = Bun.argv.indexOf("--limit");
    const limit = flag === -1 ? Infinity : Number(Bun.argv[flag + 1]);
    if (Number.isNaN(limit) || limit <= 0) throw new Error("--limit wants a positive number");
    if (command === "apply") await apply(Bun.argv[3] ?? "", limit);
    else if (command === "types") await types(limit);
    else await resync(limit);
  } else {
    console.error(`unknown command: ${command}`);
    process.exit(1);
  }
}
