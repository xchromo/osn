/**
 * Put already-created issues on the Project board.
 *
 * The Project's "auto-add" workflow only fires for issues opened after it is
 * enabled, and this migration created its issues first -- creating the Project
 * needs the `project` OAuth scope, and `gh auth refresh` is interactive. So the
 * issues that went in ahead of the board are added here, once.
 *
 * Re-runnable: it reads what is already on the board and adds only the rest.
 */
import { Throttle } from "./github";
import { plan } from "./main";

const CREATED = ".migration/created.json";
const OWNER = "xchromo";
const REPOS = { public: "xchromo/osn", private: "xchromo/osn-tracker" };

type Created = { number: number; id: string };
export type Run = (args: string[]) => Promise<string>;

export const gh: Run = async (args) => {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh ${args[0]} failed (${code}): ${err.trim()}`);
  return out;
};

/**
 * Which repo an entry's issue lives in. An epic key carries it outright; an
 * item key does not, so it is recovered from the manifest the same way `apply`
 * assigned it. A `link:` key is a sub-issue edge and owns no issue at all.
 */
export function repoOf(key: string, privateKeys: Set<string>): string {
  const epic = /^epic:(public|private):/.exec(key);
  if (epic) return REPOS[epic[1] as "public" | "private"];
  return privateKeys.has(key) ? REPOS.private : REPOS.public;
}

export function urlsFor(state: Record<string, Created>, privateKeys: Set<string>): string[] {
  return Object.entries(state)
    .filter(([key]) => !key.startsWith("link:"))
    .map(
      ([key, created]) => `https://github.com/${repoOf(key, privateKeys)}/issues/${created.number}`,
    );
}

/** The issues on the board already, by URL. */
export function parseBoard(json: string): Set<string> {
  const parsed = JSON.parse(json) as { items?: { content?: { url?: string } }[] };
  return new Set((parsed.items ?? []).flatMap((i) => (i.content?.url ? [i.content.url] : [])));
}

export function pending(all: string[], onBoard: Set<string>): string[] {
  return all.filter((url) => !onBoard.has(url));
}

if (import.meta.main) {
  const project = Bun.argv[2];
  if (!project || Number.isNaN(Number(project))) {
    throw new Error("usage: backfill-project.ts <project-number> [--apply]");
  }
  const apply = Bun.argv.includes("--apply");

  const manifest = await plan();
  const privateKeys = new Set(
    manifest.filter((e) => e.repo === "private").map((e) => `${e.sourceFile}:${e.sourceLine}`),
  );

  const state: Record<string, Created> = await Bun.file(CREATED).json();
  const all = urlsFor(state, privateKeys);
  const board = parseBoard(
    await gh([
      "project",
      "item-list",
      project,
      "--owner",
      OWNER,
      "--format",
      "json",
      "--limit",
      "2000",
    ]),
  );
  const todo = pending(all, board);

  console.log(`${all.length} created, ${board.size} on the board, ${todo.length} to add`);
  if (!apply) {
    for (const url of todo.slice(0, 10)) console.log(`  would add ${url}`);
    if (todo.length > 10) console.log(`  … and ${todo.length - 10} more`);
    console.log("\nre-run with --apply");
    process.exit(0);
  }

  const throttle = new Throttle(8_000);
  for (const url of todo) {
    await throttle.wait();
    await gh(["project", "item-add", project, "--owner", OWNER, "--url", url]);
    console.log(`added ${url}`);
  }
}
