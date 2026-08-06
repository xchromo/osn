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
  thing an organiser must not misread. They now read in `--gold-ink` — the
  variant the token contract actually holds to 4.5:1 — on a gold-tinted,
  gold-bordered ground, and carry a `*` plus an `sr-only` "(mandatory)" so the
  distinction survives greyscale, a colour-vision deficiency and a screen reader
  alike. The panel's other `gold-dim` ink (diff heading, tips summary, matrix
  header, IANA link) moved to `gold-ink` with them.

The `schedule` module id becomes `events` everywhere (routes, nav, sub-tab
labels, chunk-prefetch keys, Overview's jump targets), with its read sub-tab
relabelled `List`. No legacy alias — nothing links to the old hash.
