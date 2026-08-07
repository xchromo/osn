import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app";

/**
 * Regenerates `shared/openapi/pulse.json` from the live route definitions.
 * Boots the real app (in-memory DB + rate limiters, matching test defaults)
 * and fetches its own `/openapi/json` rather than re-deriving the document
 * by hand, so the committed spec can never drift from what the app serves.
 */

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const OUTPUT_PATH = resolve(join(SCRIPT_DIR, "../../../shared/openapi/pulse.json"));

// Recursively sorts object keys so re-running the script on an unchanged
// route tree produces byte-identical output — required for the CI freshness
// check (`git diff --exit-code`) to be meaningful rather than flaky.
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

const app = createApp();
const res = await app.handle(new Request("http://localhost/openapi/json"));
if (!res.ok) {
  throw new Error(`GET /openapi/json returned ${res.status}`);
}
const doc = await res.json();

const output = `${JSON.stringify(sortKeys(doc), null, 2)}\n`;

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, output, "utf-8");

console.log(`Wrote ${OUTPUT_PATH}`);
