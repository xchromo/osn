// `backfill.ts` recards merged pull requests in bulk and had no test at all.
// It is the tool nobody watches: a wrong argv or a renamed `--json` field only
// surfaces when someone runs it over hundreds of PRs and gets numbers that
// cannot be checked by hand.
//
// The seam is a stubbed `gh` on `PATH`. `sh()` spawns a bare `"gh"` with no
// `env`, so the child inherits the backfill process's environment and a
// directory PREPENDED to `PATH` resolves the stub. Prepended, never replaced:
// `repoProjectPaths()` and `repoRoot()` spawn `git`, and `transcriptFiles`
// spawns `sh -c ls`, so a replaced `PATH` loses them and every transcript
// silently vanishes.

import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ChangedFile, numstatFromApi } from "../backfill";
import { parseNumstat } from "../index";

test("numstatFromApi reshapes the GitHub API's file list into numstat lines", () => {
  const files: ChangedFile[] = [
    { filename: "osn/api/src/auth.ts", additions: 10, deletions: 3 },
    { filename: "wiki/notes.md", additions: 5, deletions: 0 },
    { filename: "bun.lock", additions: 1, deletions: 1 },
  ];

  expect(numstatFromApi(files)).toBe(
    "10\t3\tosn/api/src/auth.ts\n5\t0\twiki/notes.md\n1\t1\tbun.lock",
  );

  // The lines exist to be understood by `parseNumstat`, so assert that rather
  // than only the string: a tab swapped for a space would still look right.
  const diff = parseNumstat(numstatFromApi(files), 2);

  expect(diff.commits).toBe(2);
  expect(diff.loc.source).toEqual({ added: 10, deleted: 3 });
  expect(diff.loc.docs).toEqual({ added: 5, deleted: 0 });
});

const BACKFILL = new URL("../backfill.ts", import.meta.url).pathname;
const CARD = new URL("../index.ts", import.meta.url).pathname;

/** The branch carries a trailing dash on purpose: it is legal in git
 * (`git check-ref-format --branch 'feat/foo-'` passes) and it is exactly where
 * `backfill`'s inline slug used to diverge from `branchSlug`. */
const BRANCH = "feat/backfill-fixture-";
const SLUG = "feat-backfill-fixture";
const PR = 4242;

/** Claude Code names a project directory after the session's cwd with `/` and
 * `.` flattened to `-`, and the collector trusts a `TASK-BRANCH:` marker only
 * from a directory this repository owns. `git` resolves symlinks, so the name
 * has to come from git rather than from `mkdtemp`. */
async function projectDirFor(repo: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], { cwd: repo, stdout: "pipe" });
  const top = (await new Response(proc.stdout).text()).trim();
  await proc.exited;

  return top.replaceAll(/[/.]/g, "-");
}

/**
 * A throwaway git repository, a sessions tree whose project directory this
 * repo owns, and a stubbed `gh`.
 *
 * A git repository and not a plain temp dir, deliberately: from a non-git
 * directory both `git` calls in `repoProjectPaths()` fail, it returns `[]`, and
 * `ownedByRepo` then answers `true` for everything — the test would pass
 * without ever exercising ownership.
 */
async function fixture(options: { withTranscript: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "pr-metrics-backfill-"));
  const git = async (...args: string[]) => {
    const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
  };

  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
  await writeFile(join(dir, "seed.txt"), "seed\n");
  await git("add", ".");
  await git("commit", "-qm", "seed");
  await git("checkout", "-qb", BRANCH);
  await mkdir(join(dir, "osn", "api", "src"), { recursive: true });
  await writeFile(join(dir, "osn", "api", "src", "svc.ts"), "export const a = 1;\n");
  await git("add", ".");
  await git("commit", "-qm", "work");

  const sessions = join(dir, "sessions");
  const project = join(sessions, await projectDirFor(dir));
  const subagents = join(project, "sess-1", "subagents");
  await mkdir(subagents, { recursive: true });

  if (options.withTranscript) {
    // The orchestrator session runs on `main` and dispatches with the marker.
    await writeFile(
      join(project, "sess-1.jsonl"),
      `${JSON.stringify({
        type: "assistant",
        sessionId: "sess-1",
        gitBranch: "main",
        timestamp: "2026-09-09T10:00:00.000Z",
        requestId: "req-parent",
        message: {
          model: "claude-opus-5",
          content: [
            {
              type: "tool_use",
              id: "toolu_dispatch",
              name: "Agent",
              input: { prompt: `TASK-BRANCH: ${BRANCH}\n\nImplement it.` },
            },
          ],
        },
      })}\n`,
    );
    await writeFile(
      join(subagents, "agent-worker.meta.json"),
      JSON.stringify({ agentType: "implementer", toolUseId: "toolu_dispatch", spawnDepth: 1 }),
    );
    // Stamped `main` — inherited from the parent session, wrong by construction.
    await writeFile(
      join(subagents, "agent-worker.jsonl"),
      [400, 600]
        .map((output, i) =>
          JSON.stringify({
            type: "assistant",
            sessionId: "sess-1",
            gitBranch: "main",
            isSidechain: true,
            effort: "high",
            requestId: `req-w${i}`,
            timestamp: `2026-09-09T10:0${i + 1}:00.000Z`,
            message: { model: "claude-opus-5", usage: { output_tokens: output } },
          }),
        )
        .join("\n"),
    );
  }

  // The stub. Executable with a shebang, or Bun skips it and silently resolves
  // the REAL `gh` further down PATH — verified on Bun 1.4.0 — which would send
  // the test to the network with the developer's credentials.
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const log = join(dir, "gh-calls.log");
  await writeFile(
    join(binDir, "gh"),
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"pr list"*)
    printf '%s' '[{"number":${PR},"headRefName":"${BRANCH}","mergedAt":"2026-09-09T12:00:00Z","baseRefOid":"aaa","headRefOid":"bbb","labels":[],"closingIssuesReferences":[]}]' ;;
  *"/files"*)
    printf '%s\\n' '{"filename":"osn/api/src/svc.ts","additions":1,"deletions":0}' ;;
  *)
    printf '%s' '3' ;;
esac
`,
  );
  await chmod(join(binDir, "gh"), 0o755);

  return { dir, sessions, binDir, log, git };
}

async function runBackfill(f: Awaited<ReturnType<typeof fixture>>, extra: string[] = []) {
  const proc = Bun.spawn(
    ["bun", BACKFILL, "--sessions-dir", f.sessions, "--out-dir", join(f.dir, "cards"), ...extra],
    {
      cwd: f.dir,
      stdout: "pipe",
      stderr: "pipe",
      // Prepend, never replace: `git` and `sh` are still needed.
      env: { ...process.env, PATH: `${f.binDir}:${process.env.PATH}` },
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  return { stdout, stderr };
}

test("backfill cards a marked subagent, and agrees with `card` on both figure and filename", async () => {
  const f = await fixture({ withTranscript: true });
  try {
    await runBackfill(f);

    // The stub was actually reached — without this the test passes just as well
    // against the real `gh` failing on a PR number no repository has.
    const calls = await readFile(f.log, "utf8");
    expect(calls).toContain("pr list");
    expect(calls).toContain(`repos/xchromo/osn/pulls/${PR}/files`);
    expect(calls).toContain("--jq .commits");

    // The filename `branchSlug` would produce, not the inline slug: a trailing
    // dash is where the two used to differ.
    const backfilled = JSON.parse(await readFile(join(f.dir, "cards", `${SLUG}.json`), "utf8")) as {
      spend: { usd_equivalent: number; by_actor: Record<string, { tokens: { output: number } }> };
    };

    // Assert the marker path FIRST. Equality alone can pass vacuously: if
    // ownership were broken for both tools they would agree on a number that
    // never included the subagent at all.
    expect(backfilled.spend.by_actor.subagent?.tokens.output).toBe(1000);
    expect(backfilled.spend.by_actor.main?.tokens.output).toBe(0);

    // Now the agreement the doc comment has only ever asserted in prose. Read
    // the JSON: both tools print `toFixed(2)`, so comparing stdout compares
    // two-decimal roundings.
    const live = Bun.spawn(
      [
        "bun",
        CARD,
        "--branch",
        BRANCH,
        "--base",
        "main",
        "--sessions-dir",
        f.sessions,
        "--out-dir",
        join(f.dir, "live"),
      ],
      { cwd: f.dir, stdout: "pipe", stderr: "pipe" },
    );
    await live.exited;

    const liveCard = JSON.parse(await readFile(join(f.dir, "live", `${SLUG}.json`), "utf8")) as {
      spend: { usd_equivalent: number };
    };

    expect(backfilled.spend.usd_equivalent).toBeGreaterThan(0);
    expect(backfilled.spend.usd_equivalent).toBe(liveCard.spend.usd_equivalent);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

// `wiki/observability/session-metrics.md` §Backfilling states this rule and
// nothing tested it: a zero-cost card is indistinguishable from a genuinely
// cheap one once it is in the datalake, and it drags every average it touches.
test("a merged PR with no local transcript is skipped, not written as a zero card", async () => {
  const f = await fixture({ withTranscript: false });
  try {
    const { stdout } = await runBackfill(f);

    expect(stdout).toContain("wrote 0 card(s)");
    expect(stdout).toContain(String(PR));

    // `mkdirSync` sits inside the write branch, so on a skip the directory is
    // never created — assert absence, not emptiness.
    expect(await Bun.file(join(f.dir, "cards", `${SLUG}.json`)).exists()).toBe(false);
    const dir = Bun.spawnSync(["test", "-d", join(f.dir, "cards")]);
    expect(dir.exitCode).not.toBe(0);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("--dry-run reports what it would write and writes nothing", async () => {
  const f = await fixture({ withTranscript: true });
  try {
    const { stdout } = await runBackfill(f, ["--dry-run"]);

    expect(stdout).toContain("would write");
    expect(stdout).toContain(`#${PR}`);
    expect(await Bun.file(join(f.dir, "cards", `${SLUG}.json`)).exists()).toBe(false);

    // The three `gh` calls run BEFORE the dry-run branch, so the stub is still
    // exercised — a dry run is not an offline run.
    const calls = await readFile(f.log, "utf8");
    expect(calls).toContain("pr list");
    expect(calls).toContain("--jq .commits");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
