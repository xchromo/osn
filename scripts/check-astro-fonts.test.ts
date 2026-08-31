import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkAstroFonts } from "./check-astro-fonts";

// Every test builds its own throwaway `dist/` under a fresh temp directory,
// tracked here so `afterEach` can remove it even when a test fails partway
// through building its fixture.
let currentDir: string | undefined;

afterEach(async () => {
  if (currentDir) {
    await rm(currentDir, { recursive: true, force: true });
    currentDir = undefined;
  }
});

async function makeDist(): Promise<string> {
  currentDir = await mkdtemp(join(tmpdir(), "check-astro-fonts-"));
  const distDir = join(currentDir, "dist");
  await mkdir(distDir, { recursive: true });
  return distDir;
}

test("a real build — non-empty fonts dir and an inlined @font-face — passes", async () => {
  const distDir = await makeDist();
  await mkdir(join(distDir, "_astro", "fonts"), { recursive: true });
  await writeFile(join(distDir, "_astro", "fonts", "abc123.woff2"), "fake-woff2-bytes");
  await writeFile(
    join(distDir, "index.html"),
    `<html><head><style>@font-face{font-family:"Schibsted Grotesk";src:url(/_astro/fonts/abc123.woff2)}</style></head><body></body></html>`,
  );

  expect(await checkAstroFonts(distDir)).toEqual([]);
});

test("a real build — non-empty fonts dir and a standalone @font-face stylesheet — passes", async () => {
  const distDir = await makeDist();
  await mkdir(join(distDir, "_astro", "fonts"), { recursive: true });
  await writeFile(join(distDir, "_astro", "fonts", "abc123.woff2"), "fake-woff2-bytes");
  await writeFile(
    join(distDir, "_astro", "fonts.a1b2c3.css"),
    `@font-face{font-family:"Schibsted Grotesk";src:url(/_astro/fonts/abc123.woff2)}`,
  );
  await writeFile(join(distDir, "index.html"), `<html><body></body></html>`);

  expect(await checkAstroFonts(distDir)).toEqual([]);
});

test("failure mode 1 — no fonts dir at all — fails even with real @font-face CSS", async () => {
  const distDir = await makeDist();
  await writeFile(
    join(distDir, "index.html"),
    `<html><head><style>@font-face{font-family:"Schibsted Grotesk"}</style></head></html>`,
  );

  expect(await checkAstroFonts(distDir)).toEqual([
    {
      problem: `${join(distDir, "_astro", "fonts")} is missing or empty — no font files were emitted by the build`,
    },
  ]);
});

test("failure mode 1 — fonts dir exists but is empty — fails", async () => {
  const distDir = await makeDist();
  await mkdir(join(distDir, "_astro", "fonts"), { recursive: true });
  await writeFile(
    join(distDir, "index.html"),
    `<html><head><style>@font-face{font-family:"Schibsted Grotesk"}</style></head></html>`,
  );

  expect(await checkAstroFonts(distDir)).toEqual([
    {
      problem: `${join(distDir, "_astro", "fonts")} is missing or empty — no font files were emitted by the build`,
    },
  ]);
});

test("failure mode 2 — fonts dir has files but nothing emits @font-face — fails", async () => {
  const distDir = await makeDist();
  await mkdir(join(distDir, "_astro", "fonts"), { recursive: true });
  // A stale file left behind by an unrelated step is not evidence of a real
  // font build — the guard still requires the CSS half.
  await writeFile(join(distDir, "_astro", "fonts", "leftover.woff2"), "stale-bytes");
  await writeFile(join(distDir, "index.html"), `<html><body>no fonts here</body></html>`);

  expect(await checkAstroFonts(distDir)).toEqual([
    {
      problem: `no "@font-face" rule found in any .css or .html file under ${distDir}`,
    },
  ]);
});

test("both failure modes at once report both findings", async () => {
  const distDir = await makeDist();
  await writeFile(join(distDir, "index.html"), `<html><body>fontless</body></html>`);

  expect(await checkAstroFonts(distDir)).toEqual([
    {
      problem: `${join(distDir, "_astro", "fonts")} is missing or empty — no font files were emitted by the build`,
    },
    {
      problem: `no "@font-face" rule found in any .css or .html file under ${distDir}`,
    },
  ]);
});

test("an @font-face rule nested under a subdirectory's .css file still counts", async () => {
  const distDir = await makeDist();
  await mkdir(join(distDir, "_astro", "fonts"), { recursive: true });
  await writeFile(join(distDir, "_astro", "fonts", "abc123.woff2"), "fake-woff2-bytes");
  await mkdir(join(distDir, "login"), { recursive: true });
  await writeFile(
    join(distDir, "login", "index.html"),
    `<html><head><style>@font-face{font-family:"Cormorant Garamond"}</style></head></html>`,
  );

  expect(await checkAstroFonts(distDir)).toEqual([]);
});
