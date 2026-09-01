import { defineConfig } from "vitest/config";

// `tests/d1/` holds the Miniflare-backed integration tier: it imports `bun:test`
// and boots a real workerd instance, so it runs under `bun run test:d1` rather
// than here. Excluded by path so the fast tier never tries to load it.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/d1/**"],
  },
});
