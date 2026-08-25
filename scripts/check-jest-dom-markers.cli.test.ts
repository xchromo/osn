// The pure-function tests next door feed `checkJestDomMarkers` synthetic
// config strings; they never exercise the `import.meta.main` block, so they
// prove nothing about whether the real binary finds the repo's configs, skips
// `node_modules`, or reads the marker file. These tests run the actual script
// as a subprocess against a fixture tree, the same way `bun run
// check:jest-dom-markers` and the `script-tests` CI job invoke it.
//
// The script resolves the repo root as `..` relative to its own file, so a
// copy placed at `<tmp>/scripts/check-jest-dom-markers.ts` walks `<tmp>` —
// which lets this point the real, unmodified script at a throwaway tree.

import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REAL_SCRIPT = new URL("./check-jest-dom-markers.ts", import.meta.url).pathname;

const MARKER_FILE = "shared/test-config/no-jest-dom.ts";

const SOLID_CONFIG = `import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["../../shared/test-config/no-jest-dom.ts"],
  },
});
`;

type Result = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };

/** Run the real script against a fixture tree of `path -> contents`. */
async function runCliAgainst(files: Readonly<Record<string, string>>): Promise<Result> {
  const dir = await mkdtemp(join(tmpdir(), "jest-dom-markers-cli-"));

  try {
    for (const [path, contents] of Object.entries(files)) {
      const full = join(dir, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, contents);
    }

    const scriptsDir = join(dir, "scripts");
    await mkdir(scriptsDir, { recursive: true });
    const copiedScript = join(scriptsDir, "check-jest-dom-markers.ts");
    await cp(REAL_SCRIPT, copiedScript);

    const proc = Bun.spawn(["bun", "run", copiedScript], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { exitCode, stdout, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the real CLI exits 0 against a tree whose configs all carry the marker", async () => {
  const { exitCode, stdout, stderr } = await runCliAgainst({
    [MARKER_FILE]: "// marker\nexport {};\n",
    "osn/client/vitest.config.ts": SOLID_CONFIG,
    "shared/toast/vitest.config.ts": SOLID_CONFIG,
  });

  expect(stderr).toBe("");
  expect(stdout).toContain("2 vitest configs checked");
  expect(exitCode).toBe(0);
});

test("the real CLI exits non-zero when a config loses its marker", async () => {
  const { exitCode, stdout, stderr } = await runCliAgainst({
    [MARKER_FILE]: "export {};\n",
    "osn/client/vitest.config.ts": SOLID_CONFIG,
    "shared/toast/vitest.config.ts": SOLID_CONFIG.replace(
      '    setupFiles: ["../../shared/test-config/no-jest-dom.ts"],\n',
      "",
    ),
  });

  expect(exitCode).not.toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("shared/toast/vitest.config.ts");
  expect(stderr).not.toContain("osn/client/vitest.config.ts");
});

test("the real CLI does not walk into node_modules", async () => {
  // Every installed package ships its own vitest.config.ts; walking into
  // node_modules would bury a real finding under hundreds of strangers'.
  const { exitCode, stdout } = await runCliAgainst({
    [MARKER_FILE]: "export {};\n",
    "osn/client/vitest.config.ts": SOLID_CONFIG,
    "node_modules/some-dep/vitest.config.ts": SOLID_CONFIG.replace(
      '    setupFiles: ["../../shared/test-config/no-jest-dom.ts"],\n',
      "",
    ),
  });

  expect(stdout).toContain("1 vitest configs checked");
  expect(exitCode).toBe(0);
});

test("the real CLI skips every build-output directory, not only node_modules", async () => {
  // `dist` stands for the rest of SKIP_DIRS: a compiled copy of a config is
  // the same config, and counting it doubles every real finding.
  const { exitCode, stdout } = await runCliAgainst({
    [MARKER_FILE]: "export {};\n",
    "osn/client/vitest.config.ts": SOLID_CONFIG,
    "osn/client/dist/vitest.config.ts": SOLID_CONFIG.replace(
      '    setupFiles: ["../../shared/test-config/no-jest-dom.ts"],\n',
      "",
    ),
  });

  expect(stdout).toContain("1 vitest configs checked");
  expect(exitCode).toBe(0);
});

test("the real CLI reads the projects shape, browser exemption and all", async () => {
  // The two-project shape only ever ran against synthetic strings next door.
  // This proves the binary reaches each project through the real walk.
  const projects = `import solidPlugin from "vite-plugin-solid";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [solidPlugin()],
        test: {
          name: "unit",
          environment: "node",
          transformMode: { web: [/\\.[jt]sx?$/] },
        },
      },
      {
        plugins: [solidPlugin()],
        test: {
          name: "browser",
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
`;

  const { exitCode, stderr } = await runCliAgainst({
    [MARKER_FILE]: "export {};\n",
    "cire/host/vitest.config.ts": projects,
  });

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("project unit");
  expect(stderr).not.toContain("project browser");
});

test("the real CLI exits non-zero when the marker file gains executable code", async () => {
  const { exitCode, stderr } = await runCliAgainst({
    [MARKER_FILE]: 'import "@testing-library/jest-dom/vitest";\nexport {};\n',
    "osn/client/vitest.config.ts": SOLID_CONFIG,
  });

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(MARKER_FILE);
  expect(stderr).toContain("nothing but comments and");
});

test("the real CLI exits non-zero when the marker file is gone", async () => {
  const { exitCode, stderr } = await runCliAgainst({
    "osn/client/vitest.config.ts": SOLID_CONFIG,
  });

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(`${MARKER_FILE} not found`);
});

test("the real CLI exits non-zero when the walk finds no configs at all", async () => {
  // A green report over zero files is the failure mode this guard exists to
  // close, so finding nothing has to be an error rather than a pass.
  const { exitCode, stderr } = await runCliAgainst({
    [MARKER_FILE]: "export {};\n",
    "README.md": "# nothing to check\n",
  });

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("found no vitest.config.ts");
});
