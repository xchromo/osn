import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("_headers", () => {
  it("sets a Referrer-Policy that never leaks the query string cross-origin", () => {
    const path = fileURLToPath(new URL("../../public/_headers", import.meta.url));
    const contents = readFileSync(path, "utf8");
    expect(contents).toMatch(/Referrer-Policy:\s*strict-origin-when-cross-origin/);
    expect(contents).toMatch(/X-Content-Type-Options:\s*nosniff/);
  });
});
