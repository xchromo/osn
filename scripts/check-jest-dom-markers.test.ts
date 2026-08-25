import { describe, expect, test } from "bun:test";

import { checkJestDomMarkers, checkMarkerFile, mask } from "./check-jest-dom-markers";

const MARKER = '"../../shared/test-config/no-jest-dom.ts"';

/** The flat shape eleven of the repo's thirteen Solid configs use. */
function flatConfig(setupFiles: string | null): string {
  return `import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],${setupFiles === null ? "" : `\n    setupFiles: [${setupFiles}],`}
  },
});
`;
}

describe("mask", () => {
  test("keeps the length of the source so offsets stay usable", () => {
    const source = flatConfig(MARKER);
    expect(mask(source)).toHaveLength(source.length);
  });

  test("blanks line and block comments but keeps their newlines", () => {
    const masked = mask("a // { {\nb /* } } */ c");
    expect(masked).toBe("a       \nb           c");
  });

  test("blanks a regex literal, brackets and all", () => {
    // `cire/invites` really does carry `transformMode: { web: [/\.[jt]sx?$/] }`.
    const masked = mask("transformMode: { web: [/\\.[jt]sx?$/] }");
    expect(masked).toBe("transformMode: { web: [            ] }");
  });

  test("does not mistake division for a regex literal", () => {
    expect(mask("const half = total / 2 / 1;")).toBe("const half = total / 2 / 1;");
  });

  test("keeps string contents but blanks brackets inside them", () => {
    expect(mask('include: ["tests/**/*.test.{ts,tsx}"]')).toBe(
      'include: ["tests/**/*.test. ts,tsx "]',
    );
  });

  test("survives an escaped quote inside a string", () => {
    const masked = mask('const s = "a\\"} b"; const t = { x: 1 };');
    expect(masked).toHaveLength('const s = "a\\"} b"; const t = { x: 1 };'.length);
    expect(masked).toContain("{ x: 1 }");
  });
});

describe("checkJestDomMarkers", () => {
  test("passes a flat config carrying the marker", () => {
    expect(
      checkJestDomMarkers([{ path: "osn/client/vitest.config.ts", source: flatConfig(MARKER) }]),
    ).toEqual([]);
  });

  test("flags a flat config whose setupFiles lost the marker", () => {
    const findings = checkJestDomMarkers([
      { path: "osn/client/vitest.config.ts", source: flatConfig('"./src/test-setup.ts"') },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe("osn/client/vitest.config.ts");
    expect(findings[0]!.problem).toContain("no entry matching /jest-dom/");
  });

  test("flags a flat config with no setupFiles at all", () => {
    const findings = checkJestDomMarkers([
      { path: "osn/client/vitest.config.ts", source: flatConfig(null) },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.problem).toContain("no `setupFiles`");
  });

  test("accepts a bare string setupFiles, not only an array", () => {
    const source = flatConfig(null).replace(
      '    environment: "node",',
      `    environment: "node",\n    setupFiles: ${MARKER},`,
    );

    expect(checkJestDomMarkers([{ path: "x/vitest.config.ts", source }])).toEqual([]);
  });

  test("accepts a bare setupFiles written as a template literal", () => {
    const source = flatConfig(null).replace(
      '    environment: "node",',
      '    environment: "node",\n    setupFiles: `../../shared/test-config/no-jest-dom.ts`,',
    );

    expect(checkJestDomMarkers([{ path: "x/vitest.config.ts", source }])).toEqual([]);
  });

  test("accepts any path matching /jest-dom/, the same test the plugin applies", () => {
    const source = flatConfig('"@testing-library/jest-dom/vitest"');
    expect(checkJestDomMarkers([{ path: "x/vitest.config.ts", source }])).toEqual([]);
  });

  test("ignores a config that never imports the plugin", () => {
    // `tools/lab/vitest.config.ts` names vite-plugin-solid in a comment
    // explaining why it does not use it. A substring match would flag it.
    const source = `import { defineConfig } from "vitest/config";

// Deliberately without \`vite-plugin-solid\`: the plugin adds
// \`@testing-library/jest-dom/vitest\` to \`setupFiles\` for any test run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
`;

    expect(checkJestDomMarkers([{ path: "tools/lab/vitest.config.ts", source }])).toEqual([]);
  });

  test("sees the import whatever the local binding is called", () => {
    // `cire/host` binds it as `solid`, `cire/invites` as `solidPlugin`.
    const source = flatConfig(null).replace("import solid from", "import solidPlugin from");
    expect(checkJestDomMarkers([{ path: "x/vitest.config.ts", source }])).toHaveLength(1);
  });

  test("sees a bare side-effect import of the plugin", () => {
    const source = flatConfig(null).replace(
      'import solid from "vite-plugin-solid";',
      'import "vite-plugin-solid";',
    );
    expect(checkJestDomMarkers([{ path: "x/vitest.config.ts", source }])).toHaveLength(1);
  });

  test("sees the plugin reached through a dynamic import", () => {
    const source = flatConfig(null).replace(
      'import solid from "vite-plugin-solid";',
      'const solid = (await import("vite-plugin-solid")).default;',
    );
    expect(checkJestDomMarkers([{ path: "x/vitest.config.ts", source }])).toHaveLength(1);
  });

  test("sees the plugin reached through require()", () => {
    const source = flatConfig(null).replace(
      'import solid from "vite-plugin-solid";',
      'const solid = require("vite-plugin-solid");',
    );
    expect(checkJestDomMarkers([{ path: "x/vitest.config.ts", source }])).toHaveLength(1);
  });

  test("does not treat a commented-out import as an import", () => {
    const source = flatConfig(null).replace(
      'import solid from "vite-plugin-solid";',
      '// import solid from "vite-plugin-solid";',
    );
    expect(checkJestDomMarkers([{ path: "x/vitest.config.ts", source }])).toEqual([]);
  });
});

describe("checkJestDomMarkers, projects shape", () => {
  /** The two-project shape `cire/host` and `cire/invites` use. */
  function projectsConfig(unitSetupFiles: string | null, browserEnabled = true): string {
    return `import solidPlugin from "vite-plugin-solid";
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
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          transformMode: { web: [/\\.[jt]sx?$/] },${
            unitSetupFiles === null ? "" : `\n          setupFiles: [${unitSetupFiles}],`
          }
        },
      },
      {
        plugins: [solidPlugin()],
        test: {
          name: "browser",
          include: ["tests/browser/**/*.test.{ts,tsx}"],
          browser: {
            enabled: ${browserEnabled},
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
`;
  }

  test("passes when the unit project carries the marker and the browser one is exempt", () => {
    expect(
      checkJestDomMarkers([{ path: "cire/host/vitest.config.ts", source: projectsConfig(MARKER) }]),
    ).toEqual([]);
  });

  test("flags the unit project by name when its marker goes", () => {
    const findings = checkJestDomMarkers([
      { path: "cire/host/vitest.config.ts", source: projectsConfig(null) },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.problem).toContain("project unit");
  });

  test("stops exempting the browser project once it is no longer in browser mode", () => {
    const findings = checkJestDomMarkers([
      { path: "cire/host/vitest.config.ts", source: projectsConfig(MARKER, false) },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.problem).toContain("project browser");
  });

  test("checks every project, not just the first", () => {
    const findings = checkJestDomMarkers([
      { path: "cire/host/vitest.config.ts", source: projectsConfig(null, false) },
    ]);

    expect(findings.map((f) => f.problem.split(" has")[0]?.split("'")[0])).toEqual([
      "project unit",
      "project browser",
    ]);
  });

  test("does not read an `enabled: true` nested inside browser as browser mode", () => {
    // `browser.instances[].enabled` is a per-instance switch. Only the
    // block's own `enabled` says the project runs in the browser, where the
    // plugin skips its injection.
    const source = projectsConfig(MARKER, false).replace(
      '            instances: [{ browser: "chromium" }],',
      '            instances: [{ browser: "chromium", enabled: true }],',
    );

    const findings = checkJestDomMarkers([{ path: "cire/host/vitest.config.ts", source }]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.problem).toContain("project browser");
  });

  test("reports each config it is given", () => {
    const findings = checkJestDomMarkers([
      { path: "a/vitest.config.ts", source: flatConfig(null) },
      { path: "b/vitest.config.ts", source: flatConfig(MARKER) },
      { path: "c/vitest.config.ts", source: flatConfig(null) },
    ]);

    expect(findings.map((f) => f.path)).toEqual(["a/vitest.config.ts", "c/vitest.config.ts"]);
  });
});

describe("checkMarkerFile", () => {
  test("passes the marker file as it stands", () => {
    const source = `// A marker, not a setup file. \`vite-plugin-solid\` prepends
// \`@testing-library/jest-dom/vitest\` to \`setupFiles\` unless a path matches.
export {};
`;

    expect(checkMarkerFile(source)).toEqual([]);
  });

  test("passes without the trailing semicolon", () => {
    expect(checkMarkerFile("export {}\n")).toEqual([]);
  });

  test("flags executable code smuggled into the marker file", () => {
    // The point of #530: turbo does not hash this file, so code here would go
    // stale in thirteen packages' caches without invalidating one of them.
    const findings = checkMarkerFile(`import { expect } from "vitest";
expect.extend({});
export {};
`);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe("shared/test-config/no-jest-dom.ts");
    expect(findings[0]!.problem).toContain("nothing but comments and");
  });

  test("flags an empty marker file, which would not be a module", () => {
    expect(checkMarkerFile("// nothing here\n")).toHaveLength(1);
  });
});
