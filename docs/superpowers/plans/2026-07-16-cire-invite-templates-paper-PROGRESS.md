# Cire Invite Templates (Paper) — Progress + Resume Notes

**Date:** 2026-07-16
**Status:** BLOCKED — Paper MCP weekly limit reached mid-Task 5. Resets ~2026-07-18, or unblock with Paper Pro.
**Plan:** `2026-07-16-cire-invite-templates-paper.md`
**Paper file:** `Cire Invite Templates` — `01KXMR0BX4MSPTY9MP4SFBZM97`
https://app.paper.design/file/01KXMR0BX4MSPTY9MP4SFBZM97

## Task status

| Task | Status |
|---|---|
| 1. File + pages + font verification | Done |
| 2. Design briefs + tokens | Done — 56 tokens |
| 3. Foundations — layout primitive diagrams | Done |
| 4. Foundations — type specimens + floral-band ornament | Done |
| 5. `hindu-jewel / mobile` | **Partial — blocked** |
| 6. `hindu-jewel / desktop` | Not started |
| 7. `minimal / mobile` | Not started |
| 8. `minimal / desktop` + probe verdict | Not started |
| 9. Primitives spec + changeset + PR | Not started |

## Findings so far (these change the spec — Task 9 must record them)

### F1 — `Noto Serif Devanagari` ships no Latin set

The plan gave `hindu-jewel` a single display token. Because that family has no Latin
glyphs, the Latin couple line (`Priya & Arjun` — the most prominent Latin on the invite)
silently rendered in an **unchosen fallback sans**.

Fixed by adding `--font-display-hindu-latin: "Noto Serif", serif`. The two pair well
(same Noto superfamily), but the structural lesson generalises:

> **The registry's `type` field needs per-script faces, not one key per template.**

Every cultural template (`nikah-geometric`, `double-happiness`, `chuppah`, `mizuhiki`)
will hit this. The registry shape in the design spec must change from
`type: { display, body }` to something like
`type: { displayLatin, displayScript, body }`.

### F2 — `--tracking-wide` (0.12em) is wrong for body copy

The plan said apply `--tracking-wide` to the story body to honour the
"Our story needs larger letter spacing" note in `wiki/Wedding Invite Notes.md`.
Rendered, 0.12em is label-tier tracking — on 17px body it reads spaced-out, not refined.

Added `--tracking-body: 0.02em`. The note wanted *larger than default*, not *label
tracking*. `--tracking-wide` stays for all-caps labels only.

### F3 — Paper `fontFamily` design tokens bind lazily and fail SILENTLY

A node created with `font-family: var(--token)` renders a **sans fallback** until that
literal family has been applied to that node at least once.

- Reproduced on three separate nodes.
- `get_computed_styles` reports the **correct token** in the failure case — the tool lies.
- Only catchable by screenshotting and reading the letterforms.

**Workaround:** apply the literal family (`"Noto Serif", serif`), then swap to the token.
It then sticks.

This directly threatens the plan's "comps must reference tokens" constraint. Every new
typographic node needs the literal-then-token dance plus a visual check.

### F4 — the ornament primitive cannot be one fixed asset across breakpoints

`floral-band` was drawn at 1280×88 for desktop. Cloned into the 390px mobile hero and
scaled to 240px wide, it degraded into an illegible smudge — all motif detail lost.

Fix used: **same artwork, tighter viewBox crop** (`viewBox="430 0 420 88"` at 252×53),
showing the three rosettes and vine at a legible relative scale. Not a second drawing.

> **Spec impact:** `ornament` is not `{key → svg}`. It's `{key → svg + per-breakpoint
> viewBox crop}`. Record this before any other ornament is drawn.

### F5 — cloned SVGs keep their intrinsic width

`<x-paper-clone>` of the ornament carried the source's 1280px width and bled straight
through the hero's brass frame. Clones need explicit `width`/`height` on both the clone
wrapper and the inner SVG node.

## Exact resume state — `hindu-jewel / mobile` (artboard `6I-0`, page `3-0`)

Built and reviewed:
- Status bar (guide markup, white) — `6J-0`
- Hero `framed` — `6U-0` / frame `6V-0`: eyebrow, Devanagari `6X-0`, Latin `6Y-0`,
  ornament clone `70-0` (inner SVG `7X-0`, cropped viewBox), date block `7T-0`. **Verdict: holds.**
- Story `photo-left` mobile state — `8P-0`: text `8Q-0` (eyebrow `8R-0`, heading `8S-0`,
  body `8T-0`), photo block `8V-0` underneath. Matches the Wedding Invite Notes.
- Events header — `92-0` (eyebrow `93-0`, heading `94-0`)
- Timeline — `96-0`, rail `97-0`, day group `99-0` (header `9A-0`), event `9F-0` (Mehndi)
  with dot slot `9G-0`, body `9I-0`, palette `9M-0`.

### The exact call that was rejected (re-run this first on resume)

```
update_styles({updates: [
  {nodeIds: ["94-0"], styles: {whiteSpace: "nowrap"}},
  {nodeIds: ["8S-0", "94-0", "9J-0"], styles: {fontFamily: "\"Noto Serif\", serif"}}
]})
```

then immediately swap those three back to `var(--font-display-hindu-latin)` (F3 dance).

### Remaining work on this artboard

1. `94-0` ("Your Events") wraps to two lines — needs `whiteSpace: nowrap`.
2. F3 font-binding fix for `8S-0`, `94-0`, `9J-0` (all use `--font-display-hindu-latin`;
   assume all three are currently rendering sans until screenshot proves otherwise).
3. Clone `9F-0` (Mehndi) ×4 → Haldi, Sangeet, Ceremony, Reception. Use `duplicate_nodes`
   + `set_text_content` per the plan's content table.
4. Add day groups `SATURDAY 5 DECEMBER` (Haldi, Sangeet) and `SUNDAY 6 DECEMBER`
   (Ceremony, Reception) — clone `99-0`.
5. Rail `97-0` height is a placeholder `1136px` and currently overshoots the content.
   Recompute so it ends at the last dot.
6. Artboard `6I-0` → `height: "fit-content"` (it will clip — expected).
7. Critical checkpoint: trace a vertical line through all five dots + five event names.
8. `finish_working_on_nodes()`.

## Open question for the probe verdict (Task 8)

Still unanswered — **does `timeline` carry 5 events across 3 days at 390px without
becoming a pile?** The hero is proven; the events section is not. This is the whole
reason `hindu-jewel` was chosen as the heavy pole. Do not declare the probe successful
until this is seen rendered.
