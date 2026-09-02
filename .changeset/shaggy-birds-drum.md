---
"@osn/landing": patch
"@pulse/landing": patch
---

Take jsdom 30.0.1 (from 29.1.1). It is a test-only dependency — the environment the Astro landing sites' unit tests parse HTML in. The root `undici` override at `^7.29.0` keeps the tree on a single undici copy across the major, so no scoped override was needed.
