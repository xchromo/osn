import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// The lab's root is `tools/lab`, but stories live next to the components they
// exercise anywhere in the monorepo. Vite refuses to serve files outside the
// root unless they are allow-listed, so the repo root goes on the list.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), solid()],
  clearScreen: false,
  server: {
    port: 4400,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  // Nothing here ships. Sourcemaps and readable output are worth more than
  // bytes, and a spike gets thrown away long before size matters.
  build: { sourcemap: true, minify: false },
});
