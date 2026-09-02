---
"@cire/invites": patch
"@cire/landing": patch
---

Take jsdom 30.0.1 (from 29.1.1), the test-only DOM environment for these two sites' unit tests. The root `undici` override at `^7.29.0` keeps the tree on a single undici copy across the major.
