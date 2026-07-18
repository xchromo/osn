---
title: "Invite Templates"
tags: [architecture, web, theme, design]
related:
  - "[[invite-builder]]"
  - "[[cire]]"
  - "[[cire-auth]]"
  - "[[index]]"
last-reviewed: 2026-07-17
---

# Invite Templates

Lets an organiser pick a **template** for the guest invite — changing layout,
typography and palette together, not just colours. Sits on top of the existing
per-section theming ([[invite-builder]]), which stays as-is: templates choose the
bones, the invite builder still overrides copy, images and per-section colour.

**Status:** design only. Paper file
[Cire Invite Templates](https://app.paper.design/file/01KXMR0BX4MSPTY9MP4SFBZM97)
holds the Foundations page + the `hindu-jewel` / `minimal` probe at mobile (390)
and desktop (1440). **No `@cire/web` implementation exists yet.**

## Why not ten bespoke layouts

A template is a **data preset over composable primitives**, not its own component
tree. Ten bespoke trees would mean every future invite feature ships ten times.
The preset approach fits the existing bounded-allowlist pattern
(`isSafeCssColor`, `INVITE_IMAGE_SLOTS`) rather than fighting it: adding a
template is a data change.

The alternative — two layouts plus heavy token theming — was rejected because it
produces skins, which is what we already have.

## Registry entry

```ts
{
  key: "hindu-jewel",
  hero: "framed",
  story: "photo-left",
  events: "timeline",
  ornament: "floral-band",
  type: {
    displayScript: "noto-serif-devanagari",  // see "Per-script faces" below
    displayLatin:  "noto-serif",
    body:          "noto-sans",
  },
  palette: { /* every value validated via isSafeCssColor */ },
  suggestedEvents: ["Mehndi", "Haldi", "Sangeet", "Ceremony", "Reception"],
}
```

## Primitives (closed unions)

Derived from the probe comps, not invented upfront.

| Primitive | Values | Notes |
|---|---|---|
| `hero` | `full-bleed` \| `split` \| `framed` \| `block` | image+overlay / halves / ornament frame / colour-block type-first |
| `story` | `photo-left` \| `photo-bleed` \| `text-rule` | |
| `events` | `stack` \| `timeline` | **arrangement only** — the card is invariant. See below. |
| `ornament` | closed union + `none` | per-template SVG. No free-form values reach rendered CSS. |

## `EventCard` is invariant — `events` only arranges it

**The card is not a variant of `events`. It is the atom every arrangement
contains.** Every event, every template, always renders the full card:

| Card slot | Source | Notes |
|---|---|---|
| name | `events.name` | template display face |
| meta | `events.startAt` | **full day + time in `stack`; time only in `timeline`** — the day header owns the date, so repeating it is noise |
| venue | `venueLine(event)` | |
| description | `events.description` | |
| image | `events.imageUrl` + `imageCrop` | **optional** — card collapses to a single text column when absent (prod behaviour) |
| `Respond` | → RSVP modal | **mandatory** |
| `View Event` | → DetailsModal | **mandatory** |

Desktop cards are two-column (text ∥ image) with prod's **alternating rhythm** —
even rows text-left/image-right, odd rows reversed. Ignored when the event has no
image.

**Dress code and dress palette are NOT on the card.** They live in the
DetailsModal behind *View Event* — see [[invite-builder]].

> **Why this is stated so forcefully:** the first pass modelled `stack` and
> `timeline` as alternatives ("`stack` = today's EventCard; `timeline` = 4+
> events"). That framing quietly dropped `Respond`, `View Event`, the image and
> the description from every multi-day invite — i.e. it produced an invite a
> guest **cannot RSVP from**. Treating the card as invariant makes that class of
> mistake unrepresentable, and means future invite features touch one card rather
> than one card per arrangement.

### `events: timeline` — one value, two states

Same shape as `story: photo-left`: a single primitive whose expression differs by
breakpoint.

- **Desktop:** day-grouped rail threading the cards. Rail
  `position: absolute; left: 6px; top/bottom` on a `position: relative` container
  — **never a fixed height**, which overshoots the last dot. Dot lane: fixed
  **13px** slot, `flexShrink: 0`; event dots 11px round (accent), day-header marks
  5px square (gold). Cards sit beside the lane at ~940px column width.
- **Mobile:** **no rail.** Day headers (label + hairline rule) span full width;
  cards render full-bleed beneath them. At 390px a rail would cost ~27px off every
  card for a thread that reads as decoration.

**Verified:** 5 events across 3 day groups at both breakpoints, every card
carrying image, description and both buttons.

### `events: stack`

Plain list of the same cards, hairline `border-top` separators rather than filled
boxes — information on the surface, minimal boxing. ≤3 events, no day grouping.

**Desktop:** stacked in a centred column, **not** side by side. Two events side by
side at 1440 reads as a pricing table.

### `story: photo-left` — both states are part of the primitive

Encodes the standing feedback in `wiki/Wedding Invite Notes.md`:

- **Desktop:** photo left (fixed 480px, `flexShrink: 0`), text right (`flex: 1`,
  `align-items: flex-end`, `text-align: right`), 80px gap, 120–140px block padding.
- **Mobile:** text first, photo underneath, full-bleed width.
- **Body tracking:** `+0.02em` (see "Tracking" below).

Both probe templates use `photo-left` unchanged and it reads as ornate on
`hindu-jewel` and austere on `minimal`. That is the clearest evidence the preset
approach works.

## Per-script faces — `type` is not one key

**`Noto Serif Devanagari` ships no Latin set.** A single display key meant the
Latin couple line — the most prominent Latin on the invite — rendered in an
*unchosen fallback*, silently.

So `type` carries **three** faces, not two:

| Field | `hindu-jewel` | `minimal` |
|---|---|---|
| `displayScript` | Noto Serif Devanagari | — (omit) |
| `displayLatin` | Noto Serif | Inter 800 |
| `body` | Noto Sans | Inter 400 |

Noto Serif and Noto Serif Devanagari share a superfamily, so they pair without
tension. Every remaining cultural template (`nikah-geometric`,
`double-happiness`, `chuppah`, `mizuhiki`) hits this same split — decide the
Latin face explicitly per template; never let fallback decide it.

Payload is unaffected: an invite loads exactly one template's faces.

## Ornament is not one asset per key

`floral-band` was drawn at 1280×88. Cloned into the 390px hero and scaled to
240px, it degraded into an illegible smudge — all motif detail lost.

The fix is **one artwork, a viewBox crop per breakpoint** — not a second drawing:

| Breakpoint | Rendered | viewBox |
|---|---|---|
| Desktop | 900×62 | `0 0 1280 88` (full band) |
| Mobile | 252×53 | `430 0 420 88` (centre motif only) |

So the registry's ornament entry is `{key → svg + per-breakpoint viewBox}`.
Record the crop when each ornament is drawn; it is not derivable later.

## Ground texture — scene light + grain

A flat fill reads as a slab. Both templates already commit to a scene, and both
scenes are inherently non-flat, so the texture is derived rather than decorative.
It works at **three layers** — page grain, ambient light, and surface dimension —
and **how much of it a template takes is itself part of the template's identity.**

### Layer 1 — page grain (both templates)

One grain layer per artboard, not per section: an inline `<svg>` with
`feTurbulence` fractalNoise at child **index 0** (behind content),
`position: absolute` covering the artboard, `pointer-events: none`,
`preserveAspectRatio="none"`.

| Template | baseFrequency | octaves | opacity |
|---|---|---|---|
| `hindu-jewel` | 0.75–0.8 | 3 | **0.15–0.17** |
| `minimal` | 0.85–0.9 | 4 | **0.07** |

Grain is also what stops a large dark gradient banding — `hindu-jewel` runs it
roughly **2×** `minimal` for that reason, and because dark grounds swallow low-
opacity noise.

### Layer 2 — ambient light (`hindu-jewel` only)

The scene is a lit courtyard, and a courtyard has **many lamps, not one**. So
light pools down the whole page, not just the hero:

- **Hero:** the brightest pool — `radial-gradient` marigold → bougainvillea →
  transparent, ~15% peak.
- **Story / events sections:** faint off-axis warm pools (`~0.045–0.055` marigold
  / bougainvillea, alternating side) so light carries down the page.

The hero stays the **brightest** moment — the marigold remains the single colour
event; the section pools are ambient bounce, never a second focal glow.

`minimal` gets no light pools. Its scene is flat daylight; the only light move is
the base fog wash (Layer 3).

### Layer 3 — surface dimension (`hindu-jewel` only)

Event cards were flat `--color-hindu-surface` slabs sitting on the grain — the
grain couldn't lift them. They now use a **top-lit gradient**
(`linear-gradient(165deg, #262038 → #1B172A → #191527)`) with a lighter top
border edge (`--color-hindu-gold` @ ~40%), so each reads as a surface catching
light from above.

`minimal`'s "cards" are hairline `border-top` separators, not slabs — there is no
surface to light, and adding one would break the template's restraint. **This is
deliberate: forcing hindu's treatment onto minimal would erase the difference the
palettes work to create.**

### `minimal`'s base fog

`linear-gradient` transparent → fog → deeper fog, **bottom-anchored**. A top wash
is invisible because the hero's fog-coloured image block already occupies that
zone; the base also matches the copy ("done before the fog rolls in").

### Layer 4 — wallpaper motif

A subtle tiling pattern behind the content, sat **above the grain, below the
sections** (`position: absolute`, `pointer-events: none`, full artboard, child
index 1). It shows in section margins and between cards — wallpaper behind
framed pictures — while opaque surfaces (hero, image blocks) cover it.

| Template | Motif | Colour | Alpha |
|---|---|---|---|
| `hindu-jewel` | **jali diamond lattice** (thin diagonals + centre dot, 56px tile) — echoes the Udaipur-palace screen and the ornament's gold | `--color-hindu-gold` | ~0.34 |
| `minimal` | **whisper dot grid** (single slate dot, 26px tile) — reads as fine paper, not ornament | `--color-minimal-slate` | ~0.20 |

The two motifs keep the templates distinct: an ornate lattice would flatten
`minimal`, so `minimal` gets the plainest possible mark — a dot, not a line —
and far fainter. This still honours "texture tracks character": `minimal`'s
wallpaper is the least-patterned pattern that reads at all.

**Generated as tiled PNGs, not drawn in-tool** — see the Paper notes for why. The
tiles are reproducible via ImageMagick:

```
# hindu jali tile (56px), then tile across the artboard
magick -size 56x56 xc:none \
  -stroke '#C9A96157' -strokewidth 1 -fill none -draw "polyline 28,0 56,28 28,56 0,28 28,0" \
  -stroke none -fill '#C9A96157' -draw "circle 28,28 28,29.6" jali_tile.png
magick -size <W>x<H> tile:jali_tile.png hindu_wallpaper.png

# minimal dot tile (26px)
magick -size 26x26 xc:none -fill '#6B737833' -draw "circle 13,13 13,14.2" dot_tile.png
magick -size <W>x<H> tile:dot_tile.png minimal_wallpaper.png
```

Alpha is baked into the PNG (`#RRGGBBAA` — `57`≈0.34, `33`≈0.20); the Paper `<img>`
node stays at full opacity.

### The principle

Texture amount tracks template character. `hindu-jewel` (dark, ornate,
ceremonial) takes all four layers — grain, ambient light, lit surfaces, an ornate
jali wallpaper. `minimal` (bright, restrained) takes two — grain and a whisper dot
grid — and nothing else. "More texture everywhere" is wrong when it flattens the
distinction between templates; the right amount is whatever each template's scene
actually contains, expressed in that template's own vocabulary.

## Tracking

| Token | Value | Use |
|---|---|---|
| `--tracking-tight` | `-0.02em` | display type |
| `--tracking-body` | `0.02em` | **story/body copy** |
| `--tracking-wide` | `0.12em` | all-caps labels **only** |

`--tracking-wide` on body copy reads as spaced-out, not refined. The
"larger letter spacing" note in `wiki/Wedding Invite Notes.md` wants
`--tracking-body`.

## Event scaffolds are import-time suggestions

The `events` table has no type enum — it carries `name`, `description`,
`startAt`/`endAt`, `address`, `dressCodeDescription`, `dressCodePalette`,
`pinterestUrl`, `mapsUrl`, an image key and `sortOrder`. A template's
`suggestedEvents` seeds **default event names at CSV import**. No schema change.

## Cultural review gate — hard blocker

**No cultural template ships without approval from someone inside that
tradition.** A release gate, not a review suggestion. A template that fails it
does not ship in degraded form — it does not ship.

Design work can research and be respectful; it cannot be authoritative about
whether a template reads as *right* to the community it targets.

Secular templates (`minimal`, `editorial`, `botanical`, `bold`) are exempt.

The gate binds at **ship**, not at design — designing `hindu-jewel` in Paper is
not covered by it.

## Catalogue

Ten is the **ambition, not the commitment**. Quality first, quantity
iteratively — one template at a time, each gated.

| Key | Tradition | Suggested events | Ornament | Status |
|---|---|---|---|---|
| `hindu-jewel` | Hindu / South Asian | Mehndi, Haldi, Sangeet, Ceremony, Reception | floral-band | **Comped (probe)** |
| `minimal` | — | Ceremony, Reception | none | **Comped (probe)** |
| `nikah-geometric` | Muslim | Nikah, Walima | geometric arabesque | Not started |
| `chapel-classic` | Christian | Ceremony, Reception | fine rule | Not started |
| `double-happiness` | Chinese | Tea Ceremony, Banquet | 囍 seal | Not started |
| `chuppah` | Jewish | Ketubah signing, Ceremony, Reception | geometric band | Not started |
| `mizuhiki` | Japanese | Ceremony, Reception | mizuhiki cord | Not started |
| `editorial` | — | Ceremony, Reception | none | Not started |
| `botanical` | — | Ceremony, Reception | watercolour florals | Not started |
| `bold` | — | Ceremony, Reception | none | Not started |

The Buddhist slot targets **Japanese** specifically. Thai, Tibetan, Japanese and
Sri Lankan Buddhist weddings share almost no visual vocabulary; a generic
"Buddhist" template would satisfy nobody.

## Probe verdict (2026-07-16)

**The primitives survived both poles.** `hindu-jewel` (5 events, Devanagari,
`framed` + `timeline` + ornament) and `minimal` (2 events, Latin, `split` +
`stack`, no ornament) share primitives without either looking compromised, and
read as different invites rather than two skins.

- No primitive needed a value outside its enum.
- `story: photo-left` served both unchanged — the strongest evidence for the
  preset approach.
- `timeline` carries 5 events across 3 days at 390px.

**Revised after review (2026-07-16):** the first pass had `timeline` *replacing*
the event card rather than arranging it, which dropped `Respond` / `View Event` —
an invite a guest cannot RSVP from. `EventCard` is now the invariant atom and
`events` only chooses the arrangement. All four comps rebuilt against prod's card
anatomy. See "`EventCard` is invariant" above.

**Still open:** the probe proves *two* templates can share primitives. It does
not prove *ten* can. `nikah-geometric` is the next real test — it is the first
template to stress the ornament slot with a non-figurative geometric system
rather than a vine.

## Paper working notes

- **`fontFamily` design tokens bind lazily and fail silently.** A node created
  with `font-family: var(--token)` renders a **sans fallback** until that literal
  family has been applied to that node at least once. `get_computed_styles`
  reports the correct token in the failure case — the tool does not reveal it.
  Font registration is per-session: reopening the file returns an empty
  `fontFamilies` list. **Workaround:** set the literal family, then swap to the
  token. Cloned nodes are new nodes and need the same dance.
- **Cloned SVGs keep their intrinsic width.** `<x-paper-clone>` of the ornament
  carried its 1280px width and bled through the hero frame. Set explicit
  `width`/`height` on **both** the clone wrapper and the inner SVG node.
- Only screenshots catch either of these. Trust the render, not the computed styles.
- **A node screenshot renders that node in ISOLATION** — sibling background
  layers (grain, glow, wallpaper) that live at the artboard level do **not** appear
  behind a child section's screenshot, and transparency renders as **black**. So a
  section can look flat-black in a screenshot while its artboard background is
  correct. To judge any background layer you **must `export` the whole artboard**
  to a jpg and read the file. (`get_screenshot` also returns empty silently above
  ~1900px of node height, and `export` returns empty when the render is wedged —
  see below.)
- **Only single gradients render. `repeating-linear-gradient` does NOT**, and SVG
  `<pattern>`/`<defs>` are dropped on import. So a tiled motif cannot be made
  in-tool — neither a repeating-gradient nor an SVG pattern shows. The working
  route is a **pre-tiled PNG embedded via `<img src="paper-asset:///…">`** (see
  Layer 4). Plain `radial-`/`linear-gradient` (non-repeating) do work — that's what
  the glow/fog/card gradients use.
- **Data-URI SVG (`url("data:…")`) does not load** — Paper paints a broken-image
  fill. Local `paper-asset://` images and inline `<svg>` (e.g. `feTurbulence`
  grain) do render.
- **Background/gradient edits reliably wedge the renderer.** After a batch of
  background changes, `get_screenshot`/`export` start returning empty and reopening
  the file does not clear it — only an app restart does. Edits still SAVE (the
  `update_styles` calls succeed); only rendering stalls. Plan for a restart between
  a batch of background work and verifying it, and set values to their intended
  (not test) state before the restart so one export confirms the real result.
- **The lazy-font-binding bug (F3) also corrupts layout, not just colour.** If a
  display line is measured before its font loads, Paper caches a one-line height
  and then renders wrapped text into it, overlapping the line below. A file
  restart re-triggers this on every display node. The reliable repair: set the
  literal family, then in a second call set the token **and nudge `fontSize` by
  1px** to force a re-measure with the real font. Also give every display line an
  explicit `white-space: nowrap` where it's meant to stay one line — Devanagari
  metrics shift enough between renders to wrap a previously-fitting line.

## Out of scope

RSVP / details modals, the code-entry screen, the organiser-side picker UI,
per-template motion signatures, and all `@cire/web` implementation.
