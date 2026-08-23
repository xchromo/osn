---
"@pulse/web": patch
---

Stop loading a shared jest-dom setup file in every test file's environment; import it directly in the one test file that uses its matchers.
