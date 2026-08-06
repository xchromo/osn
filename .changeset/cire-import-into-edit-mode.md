---
"@cire/organiser": patch
---

Host portal: the CSV import moves into each module's Edit mode, and `Schedule`
is renamed `Events`.

Both sheets used to be uploaded from one panel sitting above the guest list on
**Guests → Households** — so importing a schedule meant going to a tab about
people, on a read view, through a control that also offered to overwrite the
guest list. `ImportPanel` is now scoped to one sheet (`kind: "events" |
"guests"`): one file input, one template, one export, one guide, and it posts
only its own CSV key, so a module's import cannot express "reconcile the other
half" at all.

Edit is now a choice rather than a surface. The new `EditWorkspace` offers **Web
editor | Spreadsheet import** and mounts exactly one of them — the editor by
default, the import not mounted (and not fetching change history) until it is
picked — with a mode switch routed through `confirmNavigation()` so an unsaved
draft is never dropped silently.

Two fixes ride along:

- The CSV format guide opens itself **once**. A first-time organiser gets it
  expanded with a slow gold glow around it; every visit after that starts
  collapsed and quiet (one `localStorage` bit, shared by both sheets). The glow
  clears on the summary's click rather than the disclosure's `toggle` event —
  setting `open` fires `toggle` too, which would kill the glow in the same tick
  it appeared.
- Mandatory column chips were `text-gold-dim`: `--gold` at ~30% alpha, a rule
  colour, and as ink the least readable text in the panel while marking the one
  thing an organiser must not misread. Measured as painted, they were **1.8:1**
  in the dark ramp and **1.3:1** in the light one. They now read in `--gold-ink`
  — the variant the token contract actually holds to 4.5:1 — on a gold-tinted,
  gold-bordered ground: **9.6:1** and **4.8:1**. They also carry a `*` plus an
  `sr-only` "(mandatory)", so the distinction survives greyscale, a
  colour-vision deficiency and a screen reader alike. The panel's other
  `gold-dim` ink (diff heading, tips summary, matrix header, IANA link) moved to
  `gold-ink` with them.

`@cire/organiser` also gains a **real-Chromium test tier**, the same second
Vitest project `@cire/web` has run since 2026-08-06, because those numbers were
unmeasurable without one: happy-dom parses no stylesheet, so nothing in the fast
tier could see that a chip's ink was 1.3:1 against what was actually painted
under it. `ImportPanel.browser.test.tsx` measures the composited result in both
ramps (compositing on a 1×1 canvas, which parses whatever syntax
`getComputedStyle` returns), and pins the first-run glow: that the hand-written
`attention-glow` utility emits a real, finite animation, that it is a shadow
rather than a border, and that the global reduced-motion clamp silences it. Run
with `bun run --cwd cire/organiser test:browser`; CI already runs the tier for
every package that has one.

The `schedule` module id becomes `events` everywhere (routes, nav, sub-tab
labels, chunk-prefetch keys, Overview's jump targets), with its read sub-tab
relabelled `List`. No legacy alias — nothing links to the old hash.
