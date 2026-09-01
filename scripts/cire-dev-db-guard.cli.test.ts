// Tracker #454 — the pure-function tests in cire-dev-db-guard.test.ts import
// `assertCireDevDb` directly, so none of them exercise the `import.meta.main`
// block that the two destructive callers actually invoke:
// `bun scripts/cire-dev-db-guard.ts <path>`. That block is where "the
// underlying command fails" lives now that there is no grep left to fail on —
// a missing path argument, an unreadable file, or a file `Bun.TOML.parse`
// cannot parse. A guard that passes on any of those, because a caller mistook
// an empty or thrown read for "nothing to refuse", is the exact failure mode
// this script exists to rule out. These tests run the real script as a
// subprocess, the same way cire-db-reset.sh and cire-db-seed.sh do, and prove
// each of those cases exits non-zero — not just the config-is-wrong cases
// already covered by the pure-function tests.

import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("./cire-dev-db-guard.ts", import.meta.url).pathname;
const DEV_ID = "bf0510eb-6998-4ee3-b5a0-833c646ef855";
const PROD_ID = "6e835474-e0a7-4db9-8883-3247c3c891cd";

async function runCli(
  ...args: readonly string[]
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const proc = Bun.spawn(["bun", "run", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function withFixture(toml: string, run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "cire-dev-db-guard-cli-"));
  try {
    const path = join(dir, "wrangler.toml");
    await writeFile(path, toml);
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the real CLI exits non-zero with no path argument", async () => {
  const { exitCode, stdout, stderr } = await runCli();
  expect(stdout).toBe("");
  expect(stderr).toContain("wrangler.toml path required");
  expect(exitCode).not.toBe(0);
});

test("the real CLI exits non-zero when the file does not exist", async () => {
  const { exitCode, stdout, stderr } = await runCli("/nonexistent/does-not-exist.toml");
  expect(stdout).toBe("");
  expect(stderr).toContain("cannot read");
  expect(exitCode).not.toBe(0);
});

// The file exists and is readable, but is not valid TOML — `Bun.TOML.parse`
// throws rather than returning something a comparison could mistake for
// empty. A guard that swallowed this and fell through would read as "no dev
// block", which already refuses, but only by accident; prove the failure
// itself is not silently absorbed into a pass. The throw is uncaught, so what
// reaches stderr is Bun's own parse error; assert on the word TOML rather than
// the exact wording, which is Bun's to change. Without that assertion the case
// would pass on any non-zero exit, including one from an unrelated crash.
test("the real CLI exits non-zero when the file is not valid TOML", async () => {
  await withFixture("this is not = = valid toml [[[", async (path) => {
    const { exitCode, stdout, stderr } = await runCli(path);
    expect(stdout).toBe("");
    expect(stderr).toContain("TOML");
    expect(exitCode).not.toBe(0);
  });
});

test("the real CLI exits 0 against a clean fixture wrangler.toml", async () => {
  await withFixture(
    `
[[env.dev.d1_databases]]
binding = "DB"
database_name = "cire-db-dev"
database_id = "${DEV_ID}"
`,
    async (path) => {
      const { exitCode, stdout, stderr } = await runCli(path);
      expect(stderr).toBe("");
      expect(stdout).toContain("dedicated to the dev tier");
      expect(exitCode).toBe(0);
    },
  );
});

test("the real CLI exits non-zero against a fixture pointing at the production id", async () => {
  await withFixture(
    `
[[env.dev.d1_databases]]
binding = "DB"
database_name = "cire-db-dev"
database_id = "${PROD_ID}"
`,
    async (path) => {
      const { exitCode, stdout, stderr } = await runCli(path);
      expect(stdout).toBe("");
      expect(stderr).toContain("PRODUCTION database");
      expect(exitCode).not.toBe(0);
    },
  );
});

test("the real CLI exits 0 against the committed cire/api/wrangler.toml", async () => {
  const repoRoot = new URL("../", import.meta.url).pathname;
  const { exitCode, stderr } = await runCli(join(repoRoot, "cire/api/wrangler.toml"));
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
