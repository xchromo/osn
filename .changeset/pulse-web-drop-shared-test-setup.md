---
"@pulse/web": patch
---

Drop the redundant jest-dom setup file. `vite-plugin-solid` already injects
`@testing-library/jest-dom/vitest` into `setupFiles`, and it skips that
injection only when one of your own setup paths matches `/jest-dom/`.
`./tests/setup.ts` does not match, so the plugin injected the module and the
package asked for it a second time — Vitest then ran both entries once per test
file, 41 times over, to serve three matcher calls in one file.

This is a tidiness fix, not a speed one. Measured over three runs each way, the
suite takes the same time with the setup file as without it (2.7–3.0s for 41
files and 471 tests, the difference inside the noise) — the module is resolved
from cache after the first hit. What the change buys is one less file to
maintain and no second answer to the question of where the matchers come from.
