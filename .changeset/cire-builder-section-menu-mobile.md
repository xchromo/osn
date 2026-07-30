---
"@cire/organiser": patch
---

Collapse the invite builder's section tabs into a menu on phones.

The builder's eight section tabs can't share a line below `@3xl/builder`
(48rem), and the row was `overflow-x-auto` — so on a phone Closing and Message
sat off the right edge with nothing to say so, the same failure the module strip
had before it became a sheet.

Below that threshold the tabs now collapse behind a trigger naming the current
section — its label, its `n/8` position and its Shown/Hidden dot, so the menu
only has to be opened to move, never to orient — which opens them as a
two-column grid: all eight on screen at once (≈206px tall on a 390px phone, so
nothing scrolls), 44px touch targets, positioned against the sticky bar so
opening it overlays the form rather than shoving it down. From `@3xl/builder` up
the trigger is `display: none` and the tabs are the same static row as before.

It re-lays-out the SAME `role="tablist"` rather than rendering a second copy of
the tabs: each section panel's `aria-labelledby` points at `${id}-tab`, so a
duplicate would give every panel two candidate labels and assistive tech two
tabs widgets. Selecting a section closes the menu and hands focus back to the
trigger (collapsing takes the focused tab to `display: none` and focus with it);
`Escape` and an outside press also close it; `ArrowDown`/`ArrowUp` step sections
alongside the existing `ArrowLeft`/`ArrowRight`/`Home`/`End`, since the open menu
is a grid. Six tests cover the trigger's live naming, the collapse, the dismiss
paths and the vertical arrows.
