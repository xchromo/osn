---
"@osn/social": patch
---

Docs-only: mobile UX audit of `@osn/social` + phased remediation plan in
`wiki/apps/social-mobile-ux.md`. The app is desktop-only today (fixed 240 px
rail at every viewport, `h-screen` units, 28 px touch targets, centered
modals under the soft keyboard, sub-16 px inputs triggering iOS auto-zoom).
The plan: P0 viewport/input foundations, P1 responsive shell (bottom tab
bar below `md`), P2 bottom-sheet dialogs, P3 touch ergonomics, P4 viewport
tests + `DESIGN.md` responsive section. Linked from `wiki/index`,
`wiki/apps/social`, and the OSN Core section of `wiki/TODO.md`. No code
change.
