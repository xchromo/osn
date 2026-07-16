---
title: "Invite Templates"
tags: [architecture, web, theme, design]
related:
  - "[[invite-builder]]"
  - "[[cire]]"
  - "[[cire-auth]]"
  - "[[index]]"
last-reviewed: 2026-07-16
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
| `events` | `stack` \| `timeline` | |
| `ornament` | closed union + `none` | per-template SVG. No free-form values reach rendered CSS. |

### `story: photo-left` — both states are part of the primitive

Encodes the standing feedback in `wiki/Wedding Invite Notes.md`:

- **Desktop:** photo left (fixed 480px, `flexShrink: 0`), text right (`flex: 1`,
  `align-items: flex-end`, `text-align: right`), 80px gap, 120–140px block padding.
- **Mobile:** text first, photo underneath, full-bleed width.
- **Body tracking:** `+0.02em` (see "Tracking" below).

Both probe templates use `photo-left` unchanged and it reads as ornate on
`hindu-jewel` and austere on `minimal`. That is the clearest evidence the preset
approach works.

### `events: timeline` — the one real build

No equivalent exists in `@cire/web` today. Everything else re-composes existing
surface.

- Vertical rail: `position: absolute; left: 5px; top: 10px; bottom: 14px; width: 1px`
  on a `position: relative` container. **Use `top`/`bottom`, never a fixed
  height** — a fixed height overshoots the last dot.
- Dot lane: fixed **11px** slot, `flexShrink: 0`, `justify-content: center`,
  `padding-top: 5px`. Event dots 9px round (accent); day-header marks 5px square
  (gold). Never rely on `gap` alone — the lane must hold across rows.
- Day-group headers between event sets; 16px row gap; 20px intra-group gap.

**Verified:** carries 5 events across 3 day groups at 390px with time, venue,
dress code and a palette row per event, and still reads as a schedule. `stack`
fails this content outright — which is why `timeline` is a separate primitive and
not a variant.

**Desktop:** the rail stays **single-column** in a centred 680px column. A
multi-column rail stops reading as a timeline.

### `events: stack`

Today's `EventCard` shape. Probe used hairline `border-top` separators rather
than filled cards — information on the surface, minimal boxing. ≤3 events.

**Desktop:** stacked in a centred 680px column, **not** side by side. Two events
side by side at 1440 reads as a pricing table.

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

## Out of scope

RSVP / details modals, the code-entry screen, the organiser-side picker UI,
per-template motion signatures, and all `@cire/web` implementation.
