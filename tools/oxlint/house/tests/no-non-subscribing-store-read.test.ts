import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginEntry = join(packageDirectory, "index.ts");

/** One oxlint diagnostic, cut down to the fields these tests assert on. */
type Diagnostic = {
  message: string;
  code: string;
  filename: string;
};

/**
 * Fixtures, keyed by file name. The rule is purely syntactic, so a fixture only
 * has to parse — nothing here is type-checked or executed. This test enables the
 * rule directly (not through the `cire/host/src/lib/*-store.ts` path override in
 * the real oxlintrc.json), since that path-scoping is oxlint's job, not the
 * rule's — the acceptance check in the task exercises the real config instead.
 */
const fixtures = {
  // A `peekCachedXxx` function declaration, copied from tasks-store.ts. Its
  // non-subscribing read is deliberate — must not be reported.
  "peek-function-declaration.ts": `
const cache = new Map();
export function peekCachedTasks(weddingId) {
	return cache.get(weddingId)?.tasks() ?? null;
}
`,
  // Same shape, but the function is a const-bound arrow, not a declaration —
  // exercises the VariableDeclarator naming path.
  "peek-arrow-const.ts": `
const cache = new Map();
export const peekCachedTasks = (weddingId) => cache.get(weddingId)?.tasks() ?? null;
`,
  // A `hasCachedXxx` predicate, copied from tasks-store.ts. Also deliberate.
  "has-cached.ts": `
const cache = new Map();
export function hasCachedTasks(weddingId) {
	return cache.get(weddingId)?.tasks() != null;
}
`,
  // The non-subscribing read sits inside an anonymous callback (\`.map\`)
  // nested inside a peekCached* function — the enclosing NAMED function is
  // still peekCached*, so this must not be reported either.
  "peek-nested-callback.ts": `
const cache = new Map();
export function peekCachedTaskLists(weddingIds) {
	return weddingIds.map((weddingId) => cache.get(weddingId)?.tasks() ?? null);
}
`,
  // The subscribing form, \`entryFor(id).accessor()\` — never flagged, this
  // is the fix the message points readers toward.
  "subscribing-form.ts": `
const cache = new Map();
function entryFor(weddingId) {
	let entry = cache.get(weddingId);
	if (!entry) {
		entry = { tasks: () => null };
		cache.set(weddingId, entry);
	}
	return entry;
}
export function tasksAccessor(weddingId) {
	return entryFor(weddingId).tasks;
}
`,
  // A map that isn't literally named \`cache\` — the rule matches by name, not
  // structurally, so this must not be reported.
  "different-map-name.ts": `
const otherMap = new Map();
export function readSomething(weddingId) {
	return otherMap.get(weddingId)?.tasks() ?? null;
}
`,
  // The shape the three broken readers actually shipped with — a "Reactive"
  // exported function reading through the non-minting optional chain, copied
  // from tasks-store.ts's \`openTaskCount\`. Must be reported.
  "broken-reader.ts": `
const cache = new Map();
export function openTaskCount(weddingId) {
	const rows = cache.get(weddingId)?.tasks() ?? null;
	if (rows == null) return null;
	return rows.filter((t) => t.status === "open").length;
}
`,
  // Same bug, but the non-subscribing read sits inside an anonymous callback
  // nested inside a function that is NOT peekCached*/hasCached* — the walk
  // past the anonymous callback must still find \`summarize\` and report.
  "broken-nested-callback.ts": `
const cache = new Map();
export function summarize(weddingIds) {
	return weddingIds.map((weddingId) => cache.get(weddingId)?.tasks() ?? null);
}
`,
} as const;

let fixtureDirectory: string;

/** Run oxlint over the fixture directory with only the house rule enabled. */
function lintFixtures(): Diagnostic[] {
  const result = Bun.spawnSync({
    cmd: [
      "bunx",
      "--bun",
      "oxlint",
      "-c",
      join(fixtureDirectory, "oxlintrc.json"),
      "--format=json",
      ".",
    ],
    cwd: fixtureDirectory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString();
  const parsed: { diagnostics?: Diagnostic[] } = JSON.parse(stdout);
  return parsed.diagnostics ?? [];
}

/** The fixture file names the rule reported, deduplicated and sorted. */
function reportedFiles(diagnostics: Diagnostic[]): string[] {
  return [...new Set(diagnostics.map((d) => d.filename.split("/").at(-1) ?? ""))].toSorted();
}

describe("house/no-non-subscribing-store-read", () => {
  let diagnostics: Diagnostic[];

  beforeAll(() => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), "house-store-read-"));
    writeFileSync(
      join(fixtureDirectory, "oxlintrc.json"),
      JSON.stringify({
        plugins: [],
        categories: { correctness: "off" },
        rules: { "house/no-non-subscribing-store-read": "error" },
        jsPlugins: [{ name: "house", specifier: pluginEntry }],
      }),
    );
    for (const [name, source] of Object.entries(fixtures)) {
      writeFileSync(join(fixtureDirectory, name), source);
    }
    diagnostics = lintFixtures();
  });

  afterAll(() => {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it("reports only the non-subscribing reads outside peekCached*/hasCached*", () => {
    expect(reportedFiles(diagnostics)).toEqual(["broken-nested-callback.ts", "broken-reader.ts"]);
  });

  it("names the accessor and points at the subscribing entryFor(...) form", () => {
    const message = diagnostics.find((d) => d.filename.endsWith("broken-reader.ts"))?.message;
    expect(message).toContain("cache.get(weddingId)?.tasks()");
    expect(message).toContain("entryFor(weddingId).tasks()");
    expect(message).toContain("peekCached*");
    expect(message).toContain("hasCached*");
  });

  it("reports under the plugin's rule id", () => {
    expect(diagnostics.every((d) => d.code === "house(no-non-subscribing-store-read)")).toBe(true);
  });
});
