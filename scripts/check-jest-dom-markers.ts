#!/usr/bin/env bun
/**
 * CI guard: fail the build if a Vitest config that loads `vite-plugin-solid`
 * does not state, in its own `setupFiles`, what it wants to happen with
 * `@testing-library/jest-dom`.
 *
 * The bug class this guards against: `vite-plugin-solid`'s `getJestDomExport`
 * (see `dist/esm/index.mjs`) prepends `@testing-library/jest-dom/vitest` to
 * `setupFiles` on every Vitest project it is loaded into — unless some entry
 * in that array already has a path matching `/jest-dom/`. Nothing in the
 * repo's own configs says so; the injection is silent, it happens per test
 * file, and it costs seconds of setup time in packages that never assert a
 * single DOM matcher. The repo suppresses it with a marker entry
 * (`shared/test-config/no-jest-dom.ts`, a file whose body is `export {};` and
 * whose only job is to have `jest-dom` in its path).
 *
 * A marker is one line, and a config that loses it goes back to injecting
 * with no test failing and no reviewer noticing — the suite still passes, it
 * is only slower. So the invariant is checked here instead:
 *
 *   every `vitest.config.ts` that imports `vite-plugin-solid` declares a
 *   `setupFiles` entry whose path matches /jest-dom/
 *
 * Note what the invariant is NOT: "no marker means jest-dom gets injected".
 * That is false — a config setting `server.deps.external` can skip the
 * injection by another route (index.mjs:83, :131), and a project running in
 * browser mode is skipped outright (index.mjs:91, "vitest browser mode
 * already has bundled jest-dom assertions"). The point is not to predict the
 * plugin. It is that the stance is written down where the next person edits
 * the config, rather than inferred from a plugin's internals.
 *
 * Two exemptions, both narrow:
 *
 * - A config that does not import `vite-plugin-solid` at all is not this
 *   guard's business — `tools/lab/vitest.config.ts` deliberately omits the
 *   plugin, and says so in a comment.
 * - Inside a `test.projects` array, a project whose own `test` block sets
 *   `browser: { enabled: true }` needs no marker: the plugin skips it.
 *
 * This runs in the `script-tests` CI job, which does **no `bun install`**. So
 * every config is read as TEXT — nothing here imports a Vitest config, or any
 * dependency at all beyond Bun and Node built-ins.
 */

/** The suppression marker every Solid Vitest project points `setupFiles` at. */
const MARKER_PATH = "shared/test-config/no-jest-dom.ts";

/** What a `setupFiles` entry has to contain to count as a declared stance —
 *  the same test the plugin itself applies (`/jest-dom/.test(path)`). */
const JEST_DOM = /jest-dom/;

/** `import solid from "vite-plugin-solid"` in any of its spellings — a bare
 *  side-effect import, a dynamic `import(…)`, a `require(…)`. The specifier
 *  must be exactly the package: a comment that merely names the plugin
 *  (`tools/lab`'s does) is not an import, and masking the source strips
 *  comments before this runs anyway.
 *
 *  A config reaching the plugin through a local wrapper that re-exports it is
 *  not matched and cannot be, since the specifier never appears in the file.
 *  No config in this repo does that, and the convention is to name the package
 *  directly; a wrapper would need this regex to grow the wrapper's specifier. */
const IMPORTS_SOLID_PLUGIN =
  /(?:\bimport\s+(?:[^;'"]*?\bfrom\s*)?|\b(?:import|require)\s*\(\s*)["']vite-plugin-solid["']/;

/** The everything-but-comments body a marker file is allowed to have, once
 *  all whitespace is squeezed out. Anything else is executable code in a file
 *  that belongs to no package — see `checkMarkerFile` below. */
const INERT_MARKER_BODIES = new Set(["export{};", "export{}"]);

/** Directory names the repo walk never descends into. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  ".astro",
  ".wrangler",
  "coverage",
  "build",
]);

export type Finding = {
  readonly path: string;
  readonly problem: string;
};

export type ConfigFile = {
  readonly path: string;
  readonly source: string;
};

/**
 * The source with every comment and regex literal replaced by spaces, and
 * every bracket, brace and paren **inside a string literal** replaced by a
 * space — same length as the input, so an index into the mask is an index
 * into the original.
 *
 * Both halves are load-bearing. `transformMode: { web: [/\.[jt]sx?$/] }`
 * appears in a real config in this repo, and its regex carries an unbalanced
 * `[` that would derail any bracket counting; comments here run to hundreds
 * of lines and contain braces of their own. String CONTENTS survive because
 * the whole question is whether a `setupFiles` entry says `jest-dom`.
 */
export function mask(source: string): string {
  const out: string[] = [];
  let i = 0;

  /** Last non-whitespace character emitted outside a string or comment —
   *  decides whether a `/` opens a regex literal or is a division sign. */
  let previous = "";

  const blank = (char: string) => (char === "\n" ? "\n" : " ");

  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out.push(blank(source[i]!));
        i++;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) {
        out.push(blank(source[i]!));
        i++;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      out.push(char);
      i++;
      while (i < source.length) {
        const inner = source[i]!;
        if (inner === "\\") {
          out.push(" ", i + 1 < source.length ? blank(source[i + 1]!) : " ");
          i += 2;
          continue;
        }
        if (inner === char) {
          out.push(char);
          i++;
          break;
        }
        out.push("{}[]()".includes(inner) ? blank(inner) : inner);
        i++;
      }
      previous = char;
      continue;
    }

    // A `/` after a value (identifier, `)`, `]`, literal) is division; after
    // an operator or an opening bracket it starts a regex literal.
    if (char === "/" && (previous === "" || "([{,;:=!&|?*+-%^~<>".includes(previous))) {
      out.push(" ");
      i++;
      let inClass = false;
      while (i < source.length) {
        const inner = source[i]!;
        out.push(blank(inner));
        i++;
        if (inner === "\\") {
          if (i < source.length) {
            out.push(blank(source[i]!));
            i++;
          }
          continue;
        }
        if (inner === "[") inClass = true;
        else if (inner === "]") inClass = false;
        else if (inner === "/" && !inClass) break;
        else if (inner === "\n") break; // unterminated — bail rather than eat the file
      }
      previous = "/";
      continue;
    }

    out.push(char);
    if (!/\s/.test(char)) previous = char;
    i++;
  }

  return out.join("");
}

/** Index of the bracket closing the one at `open`, or -1 if unbalanced. */
function matchBracket(masked: string, open: number): number {
  const opener = masked[open]!;
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : ")";
  let depth = 0;

  for (let i = open; i < masked.length; i++) {
    if (masked[i] === opener) depth++;
    else if (masked[i] === closer && --depth === 0) return i;
  }

  return -1;
}

/** The `{ … }` belonging to `<key>:` within `region`, braces included. */
function blockOf(region: string, key: string): string | null {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(region);
  if (!match) return null;

  const open = match.index + match[0].length - 1;
  const close = matchBracket(region, open);

  return close === -1 ? null : region.slice(open, close + 1);
}

/** The value assigned to `setupFiles` within `region` — the array with its
 *  brackets, or the bare string a single-entry config may use instead. */
function setupFilesValue(region: string): string | null {
  const match = /\bsetupFiles\s*:\s*/.exec(region);
  if (!match) return null;

  const start = match.index + match[0].length;
  const first = region[start];

  if (first === "[") {
    const close = matchBracket(region, start);
    return close === -1 ? null : region.slice(start, close + 1);
  }

  // A single entry may be a bare string in any of the three quote styles.
  // `mask` leaves string contents intact for all three, so the slice still
  // carries the path the /jest-dom/ test needs to see.
  if (first === '"' || first === "'" || first === "`") {
    const close = region.indexOf(first, start + 1);
    return close === -1 ? null : region.slice(start, close + 1);
  }

  return null;
}

/** The `name: "…"` of a project block, for a finding a reader can act on. */
function projectName(project: string): string | null {
  return /\bname\s*:\s*["']([^"']+)["']/.exec(project)?.[1] ?? null;
}

/** Top-level `{ … }` elements of the array whose brackets are `region`. */
function objectElements(region: string): string[] {
  const elements: string[] = [];
  let i = 1;

  while (i < region.length - 1) {
    if (region[i] === "{") {
      const close = matchBracket(region, i);
      if (close === -1) break;
      elements.push(region.slice(i, close + 1));
      i = close + 1;
      continue;
    }
    i++;
  }

  return elements;
}

/** `region` with every nested `{ … }` and `[ … ]` blanked, so a key test hits
 *  the object's own keys and not one buried in a value. `browser.instances`
 *  carries objects of its own, and an `enabled: true` down there says nothing
 *  about whether the project runs in browser mode. */
function topLevel(region: string): string {
  const out: string[] = [];
  let i = 0;

  while (i < region.length) {
    const char = region[i]!;

    if (i > 0 && (char === "{" || char === "[")) {
      const close = matchBracket(region, i);
      if (close === -1) break;
      for (; i <= close; i++) out.push(region[i] === "\n" ? "\n" : " ");
      continue;
    }

    out.push(char);
    i++;
  }

  return out.join("");
}

/** One config's `test` block (or one project's), checked for a stance. */
function checkTestBlock(path: string, label: string, testBlock: string): Finding[] {
  const browser = blockOf(testBlock, "browser");
  if (browser && /\benabled\s*:\s*true/.test(topLevel(browser))) return [];

  const setupFiles = setupFilesValue(testBlock);

  if (setupFiles === null) {
    return [
      {
        path,
        problem: `${label} has no \`setupFiles\` — add \`setupFiles: ["…/${MARKER_PATH.split("/").slice(-2).join("/")}"]\` to say it wants no injected jest-dom`,
      },
    ];
  }

  if (!JEST_DOM.test(setupFiles)) {
    return [
      {
        path,
        problem: `${label}'s \`setupFiles\` has no entry matching /jest-dom/, so vite-plugin-solid will prepend @testing-library/jest-dom/vitest to it — point one entry at ${MARKER_PATH}`,
      },
    ];
  }

  return [];
}

/**
 * Every config that loads `vite-plugin-solid` without declaring a jest-dom
 * stance. Configs that do not load the plugin produce no findings.
 */
export function checkJestDomMarkers(configs: readonly ConfigFile[]): readonly Finding[] {
  const findings: Finding[] = [];

  for (const { path, source } of configs) {
    const masked = mask(source);
    if (!IMPORTS_SOLID_PLUGIN.test(masked)) continue;

    const projects = /\bprojects\s*:\s*\[/.exec(masked);

    if (projects) {
      const open = projects.index + projects[0].length - 1;
      const close = matchBracket(masked, open);

      if (close === -1) {
        findings.push({ path, problem: "its `projects` array does not parse as text" });
        continue;
      }

      const elements = objectElements(masked.slice(open, close + 1));

      if (elements.length === 0) {
        findings.push({ path, problem: "its `projects` array holds no project objects" });
        continue;
      }

      elements.forEach((project, index) => {
        const name = projectName(project) ?? `#${index + 1}`;
        const testBlock = blockOf(project, "test");

        if (testBlock === null) {
          findings.push({ path, problem: `project ${name} has no \`test\` block` });
          return;
        }

        findings.push(...checkTestBlock(path, `project ${name}`, testBlock));
      });

      continue;
    }

    const testBlock = blockOf(masked, "test");

    if (testBlock === null) {
      findings.push({ path, problem: "it has no `test` block" });
      continue;
    }

    findings.push(...checkTestBlock(path, "its `test` block", testBlock));
  }

  return findings;
}

/**
 * The marker file must stay inert.
 *
 * It sits at `shared/test-config/`, which carries no `package.json` and is
 * therefore no workspace: turbo's package graph cannot see it, the `test`
 * task declares no `inputs` that name it, and `globalDependencies` does not
 * list it. So editing it changes no task hash — every package would keep
 * serving a cached "pass" built against the previous contents. Real setup
 * code there would be silently stale for thirteen packages at once.
 *
 * The file is allowed comments and `export {};`. Nothing else.
 */
export function checkMarkerFile(source: string): readonly Finding[] {
  const body = mask(source).replace(/\s+/g, "");

  if (INERT_MARKER_BODIES.has(body)) return [];

  return [
    {
      path: MARKER_PATH,
      problem: `must contain nothing but comments and \`export {};\` — found ${JSON.stringify(body)}. Turbo does not hash this file, so code here goes stale in every package's cache without invalidating one of them.`,
    },
  ];
}

if (import.meta.main) {
  const { readdir } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const root = fileURLToPath(new URL("..", import.meta.url));

  async function findConfigs(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const found: string[] = [];
    const subdirectories: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // `isDirectory()` reads the dirent, so a symlinked directory reports
        // false and the walk never leaves the repo.
        if (!SKIP_DIRS.has(entry.name)) subdirectories.push(join(dir, entry.name));
      } else if (entry.name === "vitest.config.ts") {
        found.push(join(dir, entry.name));
      }
    }

    const nested = await Promise.all(subdirectories.map(findConfigs));

    return [...found, ...nested.flat()];
  }

  const paths = await findConfigs(root);

  // A walk that finds nothing would report green while checking nothing —
  // exactly the failure mode this guard exists to close.
  if (paths.length === 0) {
    console.error("❌ check-jest-dom-markers: found no vitest.config.ts anywhere under the repo");
    process.exit(1);
  }

  const configs = await Promise.all(
    paths.map(async (path) => ({
      path: relative(root, path),
      source: await Bun.file(path).text(),
    })),
  );

  const markerFile = Bun.file(join(root, MARKER_PATH));

  if (!(await markerFile.exists())) {
    console.error(`❌ check-jest-dom-markers: ${MARKER_PATH} not found`);
    console.error("   Every Solid Vitest config points `setupFiles` at it. Restore it.");
    process.exit(1);
  }

  const findings = [...checkJestDomMarkers(configs), ...checkMarkerFile(await markerFile.text())];

  if (findings.length > 0) {
    console.error("❌ check-jest-dom-markers: the jest-dom suppression has drifted.");
    for (const { path, problem } of findings) console.error(`   ${path} — ${problem}`);
    console.error("");
    console.error(
      "   vite-plugin-solid prepends @testing-library/jest-dom/vitest to setupFiles unless",
    );
    console.error(`   an entry's path matches /jest-dom/. ${MARKER_PATH} is that entry; a test`);
    console.error(
      "   that needs a matcher imports @testing-library/jest-dom/vitest itself instead.",
    );
    process.exit(1);
  }

  console.log(
    `✅ check-jest-dom-markers: ${configs.length} vitest configs checked, jest-dom suppression intact.`,
  );
}
