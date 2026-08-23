---
"@pulse/web": patch
---

Drop the redundant jest-dom setup file. `vite-plugin-solid` already registers the matchers in every test file, so `tests/setup.ts` only made each of the 41 test files resolve the same import a second time. The one test that asserts with those matchers now imports them itself.
