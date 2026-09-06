// Tracker #635 — the invites SSR size guard had no test anywhere in the repo,
// and tracker #619's generalisation (scripts/guard-bundle-size.sh, taking a
// package directory, a worker|static mode, and a threshold) is where that test
// belongs, since writing it against the old cire/invites/scripts/guard-ssr-size.sh
// would have meant writing it twice.
//
// These run the real script as a subprocess against fixture directories, the
// same way scripts/tests/cire-dev-db-guard.cli.test.ts does, and assert exit
// code plus the `::error::` message for each independent decision point:
//
//   1. total under threshold -> exit 0
//   2. total over threshold -> exit 1, "exceeds the"
//   3. the measured directory missing -> exit 1, "is missing"
//   4. the measured directory holding only excluded files -> exit 1, "holds no
//      deployable files"
//   5. a large *.map beside small real files, sized so counting the map would
//      trip the threshold and excluding it would not -> exit 0
//   6. a *.map under the sibling dist/client -> exit 1
//
// Cases 1-6 use `worker` mode fixtures, since that is the mode with exclusion
// logic (wrangler.json, *.map, the dist/client sibling check) worth proving —
// the same code path a missing/empty-except-excluded measured directory takes
// in `static` mode too. Two more cover what `static` mode adds on top: an
// allowlist rather than an exclusion, and the mode argument itself.
//
// No `bun install`: this only imports `bun:test` and Node built-ins, matching
// every other file under scripts/ (the `script-tests` CI job runs with none).

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../guard-bundle-size.sh", import.meta.url).pathname;

async function runCli(
  ...args: readonly string[]
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

// The guard measures `gzip -nc <file> | wc -c`, so a test that hardcodes an
// expected total is really asserting gzip's own output size — pin the fixture
// file's OWN gzip size the same way the guard computes it, instead of guessing.
async function gzipSize(path: string): Promise<number> {
  const proc = Bun.spawn(["gzip", "-nc", path], { stdout: "pipe" });
  const [buf] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited]);
  return buf.byteLength;
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "guard-bundle-size-cli-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("exits 0 when the worker total is under the threshold", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "dist/server"), { recursive: true });
    await writeFile(join(dir, "dist/server/entry.mjs"), "export default 1;\n");

    const { exitCode, stdout } = await runCli(dir, "worker", "999999999");
    expect(stdout).toContain("gzip total");
    expect(exitCode).toBe(0);
  });
});

test("exits non-zero when the worker total exceeds the threshold", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "dist/server"), { recursive: true });
    await writeFile(join(dir, "dist/server/entry.mjs"), "export default 1;\n");

    const { exitCode, stdout } = await runCli(dir, "worker", "0");
    expect(stdout).toContain("exceeds the");
    expect(exitCode).not.toBe(0);
  });
});

test("exits non-zero when dist/server is missing", async () => {
  await withTempDir(async (dir) => {
    const { exitCode, stdout } = await runCli(dir, "worker", "999999999");
    expect(stdout).toContain("is missing");
    expect(exitCode).not.toBe(0);
  });
});

test("exits non-zero when dist/server holds only excluded files", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "dist/server"), { recursive: true });
    await writeFile(join(dir, "dist/server/wrangler.json"), "{}");
    await writeFile(join(dir, "dist/server/entry.mjs.map"), "{}");

    const { exitCode, stdout } = await runCli(dir, "worker", "999999999");
    expect(stdout).toContain("holds no deployable files");
    expect(exitCode).not.toBe(0);
  });
});

test("excluding *.map is load-bearing: counting it would trip the threshold, excluding it does not", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "dist/server"), { recursive: true });
    const entryPath = join(dir, "dist/server/entry.mjs");
    const mapPath = join(dir, "dist/server/entry.mjs.map");
    await writeFile(entryPath, "export default 1;\n");
    // Random, so it does not gzip down to nothing — a genuinely large map.
    await writeFile(mapPath, crypto.getRandomValues(new Uint8Array(20000)));

    const entrySize = await gzipSize(entryPath);
    const mapSize = await gzipSize(mapPath);
    // Between the real total alone and the real total plus the map, so
    // counting the map trips it and excluding it does not.
    const threshold = entrySize + Math.floor(mapSize / 2);

    const { exitCode, stdout } = await runCli(dir, "worker", String(threshold));
    expect(stdout).toContain(`${entrySize} bytes`);
    expect(exitCode).toBe(0);
  });
});

test("exits non-zero when dist/client holds a source map", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "dist/server"), { recursive: true });
    await writeFile(join(dir, "dist/server/entry.mjs"), "export default 1;\n");
    await mkdir(join(dir, "dist/client/_astro"), { recursive: true });
    await writeFile(join(dir, "dist/client/_astro/chunk.js.map"), "{}");

    const { exitCode, stdout } = await runCli(dir, "worker", "999999999");
    expect(stdout).toContain("dist/client");
    expect(stdout).toContain("source map");
    expect(exitCode).not.toBe(0);
  });
});

test("static mode counts only *.js and *.css, ignoring everything else in dist/_astro", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "dist/_astro"), { recursive: true });
    const jsPath = join(dir, "dist/_astro/client.js");
    await writeFile(jsPath, "console.log(1);\n");
    // A large, incompressible font file that must NOT count toward the total.
    await writeFile(
      join(dir, "dist/_astro/font.woff2"),
      crypto.getRandomValues(new Uint8Array(50000)),
    );

    const jsSize = await gzipSize(jsPath);
    const { exitCode, stdout } = await runCli(dir, "static", String(jsSize));
    expect(stdout).toContain(`${jsSize} bytes across 1 files`);
    expect(exitCode).toBe(0);
  });
});

test("exits non-zero on an unrecognised mode", async () => {
  await withTempDir(async (dir) => {
    const { exitCode, stderr } = await runCli(dir, "bogus", "999999999");
    expect(stderr).toContain("unknown mode");
    expect(exitCode).not.toBe(0);
  });
});
