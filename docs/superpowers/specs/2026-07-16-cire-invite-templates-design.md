# Cire Invite Templates — Design

**Date:** 2026-07-16
**Status:** Approved (design); implementation plan pending
**Scope:** Paper design work + a derived primitives spec. No `@cire/web` code.

## Problem

The cire guest invite has one look. Organisers can theme it — a bounded set of
fonts and colours per section (`@cire/theme`, migration `0014`) — but every
invite shares the same layout. A Hindu five-event multi-day wedding and a
two-event church wedding render through identical components, and neither is
served well.

We want a **template picker**: an organiser chooses a template, and the invite
changes layout, typography, and palette together — not just colours.

## Approach

**Template = data preset over composable primitives.**

`@cire/theme` grows a template registry. Each entry selects from four bounded
enums and supplies tokens:

```ts
{
  key: "hindu-jewel",
  hero: "framed",
  story: "photo-left",
  events: "timeline",
  ornament: "floral-band",
  type: { display: "noto-serif-devanagari", body: "…" },
  palette: { /* every value validated via isSafeCssColor */ },
  suggestedEvents: ["Mehndi", "Haldi", "Sangeet", "Ceremony", "Reception"],
}
```

Adding a template is a data change. This fits the existing bounded-allowlist
pattern (`isSafeCssColor`, `INVITE_IMAGE_SLOTS`, the font-key allowlist) rather
than fighting it.

### Rejected alternatives

- **Ten bespoke component trees** — maximum cultural fidelity, but every future
  invite feature ships ten times. Only justified if fidelity is the whole
  product.
- **Two layouts + heavy token theming** — cheapest, but templates would read as
  skins. Explicitly rejected: skins are what we already have.

## Primitives

Four bounded enums, derived from the comps (not invented upfront):

| Primitive | Values | Notes |
|---|---|---|
| `hero` | `full-bleed` \| `split` \| `framed` \| `block` | image+overlay / halves / ornament frame / colour-block type-first |
| `story` | `photo-left` \| `photo-bleed` \| `text-rule` | |
| `events` | `stack` \| `timeline` | `stack` = today's cards, ≤3 events. `timeline` = day-grouped rail, 4+ events. |
| `ornament` | closed union, per-template SVG | frame/divider slot. No free-form values reach rendered CSS. |

`story: photo-left` resolves existing feedback in `wiki/Wedding Invite Notes.md`
— desktop text right-aligned with photo left-aligned; mobile photo underneath;
larger letter-spacing. Fixed as part of the primitive, not deferred.

`events: timeline` is the only primitive that is genuinely new surface in
`@cire/web`. Everything else re-composes what exists.

### Event scaffolds are import-time suggestions

The `events` table has no type enum — it carries `name`, `description`,
`startAt`/`endAt`, `address`, `dressCodeDescription`, `dressCodePalette`,
`pinterestUrl`, `mapsUrl`, an image key, and `sortOrder`. A template's
`suggestedEvents` therefore seeds **default event names at CSV import**. No
schema change.

### Typography finding

Six templates need non-Latin script coverage (Devanagari, Arabic, Hebrew, CJK,
Japanese). The current font-key allowlist is Latin-only. The pragmatic answer is
the Noto family — one type system, every script, consistent metrics. The
allowlist roughly doubles. Payload is unaffected: an invite loads exactly one
template's fonts.

## Template catalogue

Ten is the **ambition, not the commitment**. Quality first, quantity
iteratively. Each template ships only after its cultural-review gate passes.

| Key | Tradition | Suggested events | Palette | Ornament |
|---|---|---|---|---|
| `hindu-jewel` | Hindu / South Asian | Mehndi, Haldi, Sangeet, Ceremony, Reception | marigold / crimson / gold | floral band |
| `nikah-geometric` | Muslim | Nikah, Walima | emerald / ivory / gold | geometric arabesque |
| `chapel-classic` | Christian | Ceremony, Reception | ivory / blush / ink | fine rule |
| `double-happiness` | Chinese | Tea Ceremony, Banquet | red / gold | 囍 seal |
| `chuppah` | Jewish | Ketubah signing, Ceremony, Reception | ink / gold / white | geometric band |
| `mizuhiki` | Japanese | Ceremony, Reception | white / red / black | mizuhiki cord |
| `minimal` | — | Ceremony, Reception | mono-neutral | none |
| `editorial` | — | Ceremony, Reception | ivory + accent | none |
| `botanical` | — | Ceremony, Reception | sage / blush | watercolour florals |
| `bold` | — | Ceremony, Reception | high-contrast blocks | none |

The Buddhist slot targets **Japanese** specifically. Thai, Tibetan, Japanese and
Sri Lankan Buddhist weddings share almost no visual vocabulary; a generic
"Buddhist" template would satisfy nobody.

## Cultural review gate — hard blocker

**No cultural template ships without approval from someone inside that
tradition.** This is a release gate, not a review suggestion.

Design work can research and be respectful. It cannot be authoritative about
whether a template reads as *right* to the community it targets. A template that
fails this gate does not ship in degraded form — it does not ship.

Secular templates (`minimal`, `editorial`, `botanical`, `bold`) are exempt.

## Paper file

New file **Cire Invite Templates**, two pages.

**Foundations** — palette swatch rows, type-pairing specimens (each in its own
script), the ornament library, and diagrams of the four hero / three story / two
events layouts. This page is the primitives spec in visual form.

**Templates** — artboards named `<key> / mobile` (390) and `<key> / desktop`
(1440). Each comp is one tall artboard: hero → story → events.

Paper tokens (`create_tokens`) hold palettes and the type scale, so comps
reference tokens rather than hardcoded hex. The eventual export into
`@cire/theme` via `get_computed_styles` is then mechanical, not eyeballed.

## Content

Culturally-matched placeholders — plausible names and real event scaffolds per
tradition. Realistic content density is the point: a five-event Hindu invite and
a two-event church invite stress the layout primitives differently, and a single
neutral couple across all ten would hide exactly the problem the `timeline`
primitive exists to solve.

## Sequencing

1. **Foundations page.** Gate: review before any comp is drawn.
2. **Probe — `hindu-jewel` + `minimal`, mobile + desktop (4 artboards).**
   Gate: review. Deliberate poles: heaviest case (5 events, Devanagari, ornament
   frame, timeline) against lightest (2 events, Latin, no ornament). If the
   primitives survive both, the rest is fill-in. If they don't, we learn it after
   4 artboards rather than 20.
3. **Expand iteratively** — one template at a time, quality-gated, cultural
   review per template. Not a batch.
4. **Primitives spec** → `cire/wiki/architecture/invite-templates.md`, derived
   from the final comps.

Only step 4 touches the repo. Steps 1–3 are Paper-only.

## Out of scope

RSVP and details modals (near-identical across templates), the code-entry
screen, the organiser-side picker UI, per-template motion signatures, and all
`@cire/web` implementation. Each is a separate plan.

## Risks

- **Ten templates may be too many to maintain well.** The probe decides. If
  `hindu-jewel` and `minimal` cannot share primitives without one looking
  compromised, the honest answer is fewer templates done properly.
- **`events: timeline` is real build**, not a re-skin — the one primitive with
  no existing surface in `@cire/web`.
- **Cultural fidelity has a ceiling** — see the review gate above.
