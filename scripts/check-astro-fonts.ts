#!/usr/bin/env bun
/**
 * CI guard: fail the build if Astro's build-time Google Fonts fetch silently
 * dropped every font.
 *
 * `@cire/vendor`, `@cire/host` and `@cire/landing` all declare fonts with
 * `provider: fontProviders.google()`, which makes `GET
 * https://fonts.google.com/metadata/fonts` a hard dependency of `astro
 * build`. The failure is silent, three layers deep:
 *
 *   - unifont retries the fetch 3 times then throws;
 *   - Astro constructs unifont with `throwOnError: false`, so unifont
 *     `console.error`s the failure and drops the provider instead of
 *     propagating it;
 *   - Astro then finds zero fonts for the family, logs a `logger.warn("No
 *     data found for font family …")`, and `continue`s to the next family.
 *
 * Result: an empty `dist/_astro/fonts/`, zero `@font-face` rules anywhere in
 * the built output, zero font preloads, a `--font-ui`-shaped custom property
 * pointing at a family nothing defines — and `astro build` exits 0. Nothing
 * downstream of the build (`wrangler pages deploy dist`) would notice; the
 * broken artefact ships on a green CI run. xchromo/osn-tracker#128.
 *
 * This guard takes a `dist` directory and fails unless BOTH hold:
 *
 *   1. `dist/_astro/fonts/` exists and holds at least one file — Astro's own
 *      copy step writes the downloaded font files there, so an empty (or
 *      missing) directory means nothing was ever fetched.
 *   2. At least one `.css` or `.html` file under `dist` contains an
 *      `@font-face` rule. Astro inlines the generated `@font-face` CSS into
 *      each page's `<style>` block when it is small enough, and only spills
 *      it into a standalone `_astro/*.css` file above that threshold — a
 *      real build was observed doing the former, so this guard checks both
 *      rather than assuming one.
 *
 * Turbo caches a package's `build` task only on a zero exit code (no
 * `continueOnError`-shaped setting exists in the root `turbo.json`), and
 * this guard runs as a second `&&`-chained command in that same `build`
 * script — so a guard failure makes the whole task exit non-zero and turbo
 * never caches the broken artefact as a success. A later run that DOES hit
 * turbo's cache is replaying a build that passed this guard when it was
 * created, which is why the guard does not need to run again on a cache hit.
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Glob } from "bun";

export type Finding = {
  readonly problem: string;
};

/**
 * True if `dir` exists and contains at least one regular file, checked
 * recursively — Astro nests per-family subdirectories under some provider
 * configurations, so a shallow `readdir` would miss a real, non-empty
 * result. A missing directory is not an error here: it means the same thing
 * as an empty one — no fonts were emitted — so both report `false`.
 */
async function hasAnyFile(dir: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    return false;
  }
  return entries.length > 0;
}

/**
 * True if any `.css` or `.html` file under `distDir` contains a literal
 * `@font-face` rule. This is a substring check, not a CSS parse — the same
 * shortcut `verify-vendored-anti-slop.sh`-style guards in this repo take,
 * and adequate here: nothing legitimate emits the literal text
 * `@font-face` other than a real font-face rule.
 */
async function distContainsFontFace(distDir: string): Promise<boolean> {
  const glob = new Glob("**/*.{css,html}");
  for await (const relativePath of glob.scan({ cwd: distDir, dot: true })) {
    const text = await Bun.file(join(distDir, relativePath)).text();
    if (text.includes("@font-face")) return true;
  }
  return false;
}

export async function checkAstroFonts(distDir: string): Promise<readonly Finding[]> {
  const findings: Finding[] = [];

  const fontsDir = join(distDir, "_astro", "fonts");
  if (!(await hasAnyFile(fontsDir))) {
    findings.push({
      problem: `${fontsDir} is missing or empty — no font files were emitted by the build`,
    });
  }

  if (!(await distContainsFontFace(distDir))) {
    findings.push({
      problem: `no "@font-face" rule found in any .css or .html file under ${distDir}`,
    });
  }

  return findings;
}

if (import.meta.main) {
  const distArg = process.argv[2];

  if (!distArg) {
    console.error("❌ check-astro-fonts: usage: bun run check-astro-fonts.ts <dist-dir>");
    process.exit(1);
  }

  // `resolve`, not `join` — an absolute `distArg` (the CLI test below passes
  // one) must be used as-is rather than joined onto `cwd` as a relative
  // path segment, which `join` would do silently.
  const distDir = resolve(process.cwd(), distArg);

  // The package name is read from the caller's own `package.json` rather
  // than passed as a second argument, so the same invocation
  // (`bun run ../../scripts/check-astro-fonts.ts dist`) works unchanged in
  // every package's `build` script — the whole point of task #128's second
  // half being "use the same invocation shape in all three".
  let packageName = process.cwd();
  try {
    const pkg = (await Bun.file(join(process.cwd(), "package.json")).json()) as {
      readonly name?: string;
    };
    if (typeof pkg.name === "string" && pkg.name.length > 0) packageName = pkg.name;
  } catch {
    // No readable package.json — fall back to the cwd already assigned above.
  }

  const findings = await checkAstroFonts(distDir);

  if (findings.length > 0) {
    console.error(`❌ check-astro-fonts: ${packageName} shipped a fontless build.`);
    for (const { problem } of findings) console.error(`   ${problem}`);
    console.error("");
    console.error("   This is the failure mode in xchromo/osn-tracker#128: Astro's build-time");
    console.error("   Google Fonts fetch failed and every layer between unifont and astro build");
    console.error(
      "   swallowed the error, so the build still exited 0 with no fonts in it. Re-run",
    );
    console.error("   the build with network access to fonts.google.com, or investigate why the");
    console.error("   fetch failed before shipping this artefact.");
    process.exit(1);
  }

  console.log(`✅ check-astro-fonts: ${packageName} shipped a real font build.`);
}
