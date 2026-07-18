# Cire Invite Templates (Paper) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Paper file for the cire invite template picker — Foundations page plus the `hindu-jewel` + `minimal` probe at mobile (390) and desktop (1440) — and derive the primitives spec from it.

**Architecture:** Design-first, code-later. This plan produces a Paper file and a wiki spec, not `@cire/web` components. Ten templates decompose into four bounded enums (`hero`, `story`, `events`, `ornament`) plus type/palette tokens; the probe pair are deliberate poles (heaviest vs lightest) chosen to falsify that decomposition after 4 artboards rather than 20.

**Tech Stack:** Paper MCP (`mcp__plugin_paper-desktop_paper__*`), Paper design tokens (Tailwind v4 theme namespaces), Google Fonts (Noto family), git worktree.

## Global Constraints

- Worktree: `/Users/ac/.work/osn.git/cire-invite-templates`, branch `feat/cire-invite-templates`. Never commit to `main`.
- **Verification is not TDD here.** This is design work. Each task's gate is the Paper guide's mandatory loop: `get_screenshot` → evaluate against the six Review Checkpoints (Spacing, Typography, Contrast, Alignment, Artboard fit, Repetition) → write a one-line verdict → fix inline before moving on.
- `get_guide({topic: "paper-mcp-instructions"})` MUST be called once before any other Paper tool. Call again if the thread compresses.
- `get_font_family_info` MUST be called before the first typographic styling. It requires an open file.
- Mobile artboards are 390×844 and MUST include a status bar — get markup via `get_guide({topic: "mobile-status-bar"})`. Do not hand-draw one.
- Desktop artboards are 1440×900. Leave 80px between artboards.
- Artboard heights are starting points. When content clips, switch to `height: "fit-content"` via `update_styles`. Never guess a new fixed height.
- `write_html` writes ~one visual group per call (≤15 lines). Never batch a whole comp.
- Comps reference tokens (`var(--…)`), never hardcoded hex — this is what makes the eventual `get_computed_styles` export mechanical.
- No emojis as icons. Use SVG.
- `finish_working_on_nodes` MUST be called when done.
- **Every PR to main requires a changeset** (`.github/workflows/changeset-check.yml` fails without one, docs-only included). `@cire/theme` and `@cire/web` are version-less/ignored — a `@cire/*`-only changeset is valid; never mix them with a versioned package.
- Do not put node IDs in user-facing text.
- **The cultural-review gate is a *ship* gate, not a design gate.** `hindu-jewel` is a cultural template, so designing it here is fine — nothing ships from this plan. The gate binds before any cultural template reaches real couples, which is the follow-on work. Do not treat it as a blocker on Task 5.

## Scope Decision (deviation from spec — read this)

The spec's step 1 says "Foundations page" covering all ten palettes, ten type specimens, and seven ornaments. That contradicts the spec's own step 2 ("learn it after 4 artboards rather than 20") and the quality-first/iterate-quantity direction.

**This plan scopes Foundations to what the probe can falsify:**

- All ten **palettes** as tokens — cheap, and cross-checks that the catalogue coheres as one system.
- **Type specimens** for the probe pair only. Eight more scripts is not cheap and buys nothing until those templates are built.
- **Layout diagrams** for all primitives (4 hero / 3 story / 2 events) — this *is* the falsifiable content.
- **One ornament** (`floral-band`). `minimal` has none, so the probe only needs one.

The other eight templates' specimens and ornaments land when those templates are built.

## File Structure

| File | Responsibility |
|---|---|
| Paper file `Cire Invite Templates` → page **Foundations** | Palettes, probe type specimens, `floral-band` ornament, layout primitive diagrams. The primitives spec in visual form. |
| Paper file → page **Templates** | Artboards `hindu-jewel / mobile`, `hindu-jewel / desktop`, `minimal / mobile`, `minimal / desktop`. |
| Create: `cire/wiki/architecture/invite-templates.md` | Primitives spec derived from the comps. Frontmatter: `title`, `tags`, `related`, `last-reviewed`. |
| Modify: `cire/wiki/index.md` | Link the new page (wiki maintenance rule). |
| Modify: `CLAUDE.md` | Add wiki-nav table row for invite templates. |
| Create: `.changeset/<name>.md` | `@cire/theme` patch. Required by CI. |

## Placeholder Content (use verbatim — do not invent)

**`hindu-jewel`** — Priya Sharma & Arjun Mehta, 5–7 December 2026, Udaipur, Rajasthan.

- Hero title: `Priya & Arjun`. Subtitle: `5 — 7 December 2026 · Udaipur, Rajasthan`
- Story eyebrow: `Our Story`. Heading: `Two cities, one long train ride`. Body: `We met in a Mumbai bookshop queue in 2019, arguing about whether the last copy of a Ghalib collection was rightfully claimed. Arjun lost the argument and gained a phone number. Seven years and eleven trains later, we would like you in Udaipur.`
- Events (5) — this density is the point:

| Event | When | Where | Dress code | Palette |
|---|---|---|---|---|
| Mehndi | Fri 4 Dec 2026, 4:00pm | Courtyard, Hotel Lakend | Bright florals. Something you can sit cross-legged in. | Marigold `#F0A32C`, Bougainvillea `#D6246E`, Leaf `#4E7A3A` |
| Haldi | Sat 5 Dec, 10:00am | Poolside Lawn | Yellow. Something you don't mind staining. | Turmeric `#E4B429` |
| Sangeet | Sat 5 Dec, 7:00pm | Durbar Hall | Cocktail, dance-ready. | Indigo `#2E2A4A`, Gold `#C9A961` |
| Ceremony | Sun 6 Dec, 7:30am | Jagmandir Island | Traditional formal. | Ivory `#F5F0E6`, Gold `#C9A961` |
| Reception | Sun 6 Dec, 8:00pm | Zenana Mahal | Black tie, with colour. | Oxblood `#6B1F2E` |

**`minimal`** — Elena Fischer & Tom Baird, 18 April 2026, Marin County, California.

- Hero title: `Elena & Tom`. Subtitle: `18 April 2026 · Marin County, California`
- Story eyebrow: `Our Story`. Heading: `A wrong turn at Point Reyes`. Body: `Elena was looking for the lighthouse. Tom was looking for the trailhead. Neither found what they were after, and both were fine about it.`
- Events (2):

| Event | When | Where | Dress code |
|---|---|---|---|
| Ceremony | Sat 18 April 2026, 4:00pm | Cypress Grove, Point Reyes | Garden formal. Flat shoes — it's grass. |
| Reception | Sat 18 April 2026, 6:30pm | The Barn at Nicasio | Come as you are. |

---

### Task 1: Paper file + pages + font verification

**Files:**
- Create: Paper file `Cire Invite Templates` (team: Aniket's Team)
- Create: pages `Foundations`, `Templates`

**Interfaces:**
- Produces: `fileId` (used by every later task), `foundationsPageId`, `templatesPageId`, and a verified font list.

- [ ] **Step 1: Load the Paper guide**

Call `get_guide({topic: "paper-mcp-instructions"})`. Required before any other Paper tool.

- [ ] **Step 2: Create the file**

Call `create_file({name: "Cire Invite Templates"})`. Record the returned `fileId`.

- [ ] **Step 3: Open it**

Call `open_file({fileId})`. This makes the file sticky for later calls.

- [ ] **Step 4: Create both pages**

Call `create_page({name: "Foundations"})` then `create_page({name: "Templates"})`. Record both page IDs.

- [ ] **Step 5: Verify fonts exist**

```
get_font_family_info({familyNames: [
  "Noto Serif Devanagari", "Noto Sans Devanagari", "Noto Sans", "Inter"
]})
```

Expected: each family resolves with weight/style lists. **If `Noto Serif Devanagari` is unavailable, STOP and report** — it is the `hindu-jewel` display face and the plan's typography assumption fails without it. Do not silently substitute.

- [ ] **Step 6: Confirm baseline**

Call `get_basic_info()`. Expected: file name `Cire Invite Templates`, two pages, zero artboards.

---

### Task 2: Design briefs + tokens

**Files:**
- Modify: Paper file tokens

**Interfaces:**
- Produces: token names consumed by every comp — `--color-{template}-{role}`, `--text-*`, `--font-*`, `--tracking-*`, `--leading-*`, `--radius-*`, `--spacing-*`.

- [ ] **Step 1: Post both design briefs to the user as chat messages**

The Paper guide requires this **before any mutation tool call**. The brief is a deliverable, not scratch work. Format per guide: Mood candidates / Mood chosen (+ why it isn't the first instinct) / Palette (5–6 hex with roles) / Type / Direction.

The moods below are pre-committed — they already apply the guide's "avoid the cliché pairings" rule, and the reasoning must be reproduced in the brief:

**`hindu-jewel` — mood: nocturnal.** Candidates: candlelit, arid, nocturnal, marigold-market, chapel. Not the first instinct: the reflexive Indian-wedding palette is ivory/gold or warm-off-white × terracotta, which the guide names as a current cliché — and a tinted warm ground would mute the high-chroma marigold anyway. Nocturnal is a real scene here: a lit courtyard sangeet under a night sky over Udaipur. Inky ground carries high-chroma accents; the guide sanctions exactly this.

**`minimal` — mood: maritime.** Candidates: gallery, brutalist, maritime, alpine, editorial. Not the first instinct: minimal templates reflexively land on pure-white × cadmium-red gallery or stark brutalist. Maritime is the actual scene — Point Reyes fog, weathered shingle, deep navy — and gives a restrained ground that stays neutral enough to read as "the safe default".

- [ ] **Step 2: Create the shared type + scale tokens**

```
create_tokens({tokens: [
  {type: "fontFamily", name: "--font-display-hindu", value: "\"Noto Serif Devanagari\", serif"},
  {type: "fontFamily", name: "--font-body-hindu", value: "\"Noto Sans\", sans-serif"},
  {type: "fontFamily", name: "--font-display-minimal", value: "\"Inter\", sans-serif"},
  {type: "fontFamily", name: "--font-body-minimal", value: "\"Inter\", sans-serif"},
  {type: "fontSize", name: "--text-label", value: "13px"},
  {type: "fontSize", name: "--text-body", value: "17px"},
  {type: "fontSize", name: "--text-h2", value: "24px"},
  {type: "fontSize", name: "--text-h1", value: "32px"},
  {type: "fontSize", name: "--text-display", value: "56px"},
  {type: "fontSize", name: "--text-display-lg", value: "88px"},
  {type: "fontWeight", name: "--font-weight-regular", value: 400},
  {type: "fontWeight", name: "--font-weight-medium", value: 500},
  {type: "fontWeight", name: "--font-weight-bold", value: 800},
  {type: "letterSpacing", name: "--tracking-tight", value: "-0.02em"},
  {type: "letterSpacing", name: "--tracking-normal", value: "0em"},
  {type: "letterSpacing", name: "--tracking-wide", value: "0.12em"},
  {type: "lineHeight", name: "--leading-display", value: "60px"},
  {type: "lineHeight", name: "--leading-body", value: "27px"},
  {type: "spacing", name: "--spacing-2", value: "8px"},
  {type: "spacing", name: "--spacing-4", value: "16px"},
  {type: "spacing", name: "--spacing-6", value: "24px"},
  {type: "spacing", name: "--spacing-8", value: "32px"},
  {type: "spacing", name: "--spacing-12", value: "48px"},
  {type: "spacing", name: "--spacing-20", value: "80px"},
  {type: "radius", name: "--radius-none", value: "0px"},
  {type: "radius", name: "--radius-sm", value: "4px"},
  {type: "radius", name: "--radius-lg", value: "16px"}
]})
```

Expected: every entry returns `{result: "created"}`. Investigate any `{result: "error"}` before continuing.

- [ ] **Step 3: Create the probe-pair colour tokens**

Guide order: neutrals first, then primary, secondary, accent.

```
create_tokens({tokens: [
  {type: "color", name: "--color-hindu-ground", value: "#14121F", description: "Night sky over Udaipur. Page ground."},
  {type: "color", name: "--color-hindu-surface", value: "#1F1B2E", description: "Raised panel — event cards, story block."},
  {type: "color", name: "--color-hindu-text", value: "#F5F0E6", description: "Lamp-lit limewash. Body text on ground."},
  {type: "color", name: "--color-hindu-text-muted", value: "#B7AFA0", description: "Secondary text. Min 16px — see contrast rule."},
  {type: "color", name: "--color-hindu-marigold", value: "#F0A32C", description: "Marigold garland. Primary accent — the one intense moment."},
  {type: "color", name: "--color-hindu-fuchsia", value: "#D6246E", description: "Bougainvillea. Secondary accent, sparing."},
  {type: "color", name: "--color-hindu-gold", value: "#C9A961", description: "Temple brass. Ornament strokes only, not text."},
  {type: "color", name: "--color-minimal-ground", value: "#FFFFFF", description: "Page ground."},
  {type: "color", name: "--color-minimal-fog", value: "#E8EAEC", description: "Point Reyes fog. Dividers, inset panels."},
  {type: "color", name: "--color-minimal-slate", value: "#6B7378", description: "Weathered shingle. Muted text."},
  {type: "color", name: "--color-minimal-text", value: "#14181C", description: "Body text."},
  {type: "color", name: "--color-minimal-navy", value: "#1B2A3D", description: "Deep navy. Primary accent."}
]})
```

- [ ] **Step 4: Create the remaining eight palettes as tokens**

Cheap, and it cross-checks that the ten-template catalogue coheres as one system. Two colours each — ground + primary accent. Roles only; these get refined when each template is designed.

```
create_tokens({tokens: [
  {type: "color", name: "--color-nikah-ground", value: "#F7F4ED", description: "Ivory. nikah-geometric ground."},
  {type: "color", name: "--color-nikah-accent", value: "#1F5F4B", description: "Emerald. nikah-geometric primary."},
  {type: "color", name: "--color-chapel-ground", value: "#FBF8F5", description: "chapel-classic ground."},
  {type: "color", name: "--color-chapel-accent", value: "#2B2B33", description: "Ink. chapel-classic primary."},
  {type: "color", name: "--color-doublehappiness-ground", value: "#FFFFFF", description: "double-happiness ground."},
  {type: "color", name: "--color-doublehappiness-accent", value: "#C8102E", description: "Red. double-happiness primary."},
  {type: "color", name: "--color-chuppah-ground", value: "#FFFFFF", description: "chuppah ground."},
  {type: "color", name: "--color-chuppah-accent", value: "#141822", description: "Ink. chuppah primary."},
  {type: "color", name: "--color-mizuhiki-ground", value: "#FFFFFF", description: "mizuhiki ground."},
  {type: "color", name: "--color-mizuhiki-accent", value: "#B7282E", description: "Cord red. mizuhiki primary."},
  {type: "color", name: "--color-editorial-ground", value: "#FFFFFF", description: "editorial ground."},
  {type: "color", name: "--color-editorial-accent", value: "#1B3FCC", description: "Cobalt. editorial primary."},
  {type: "color", name: "--color-botanical-ground", value: "#F6F5F0", description: "botanical ground."},
  {type: "color", name: "--color-botanical-accent", value: "#5A6B4A", description: "Moss. botanical primary."},
  {type: "color", name: "--color-bold-ground", value: "#FFFFFF", description: "bold ground."},
  {type: "color", name: "--color-bold-accent", value: "#E4322B", description: "Cadmium. bold primary."}
]})
```

- [ ] **Step 4a: Verify**

Call `get_basic_info()`. Expected: all tokens listed. Confirm no duplicate names.

---

### Task 3: Foundations — layout primitive diagrams

This is the falsifiable content. If these nine diagrams can't express both probe templates, approach A is wrong and we find out here.

**Files:**
- Create: artboard `Primitives / layouts` on page `Foundations`

**Interfaces:**
- Consumes: tokens from Task 2.
- Produces: the visual definition of `hero` (`full-bleed` | `split` | `framed` | `block`), `story` (`photo-left` | `photo-bleed` | `text-rule`), `events` (`stack` | `timeline`).

- [ ] **Step 1: Create the artboard**

```
create_artboard({name: "Primitives / layouts", styles: {
  display: "flex", flexDirection: "column", width: "1440px", height: "900px",
  backgroundColor: "#FFFFFF", padding: "80px", gap: "48px"
}})
```

Record the node ID.

- [ ] **Step 2: Write the page header**

One `write_html` call, `mode: "insert-children"`. A `<div layer-name="Header">` with an all-caps label (`--text-label`, `--tracking-wide`, `--color-minimal-slate`) reading `CIRE INVITE TEMPLATES` and an `<h1>` (`--text-h1`, `--font-weight-bold`, `--tracking-tight`) reading `Layout primitives`.

- [ ] **Step 3: Hero row container**

One call. `<div layer-name="Hero primitives" style="display:flex; flex-direction:column; gap:16px">` containing only its label: `HERO — 4 VARIANTS`.

- [ ] **Step 4: Hero diagrams**

One call per diagram, four calls total, each inserted into the Hero row container. Each is a 260×180 wireframe box (`--color-minimal-fog` fill blocks for image regions, `--color-minimal-slate` bars for type) plus a caption below naming the enum value:

- `full-bleed` — image fills box, type bars centered over it
- `split` — box halved vertically, image left, type bars right
- `framed` — inset border (`--color-minimal-slate`, 1px), type bars centered, small image block inset
- `block` — solid accent block top 60%, type bars on it, image block below

Wrap the four in a `display:flex; gap:24px` row.

- [ ] **Step 5: Screenshot + review checkpoint**

`get_screenshot({nodeId: <artboard id>})`. Evaluate all six checkpoints. Write a one-line verdict. Trace vertical lanes across the four diagrams — captions must sit on one baseline. Fix before continuing.

- [ ] **Step 6: Story diagrams**

Same pattern — container + label `STORY — 3 VARIANTS`, then one call per diagram: `photo-left`, `photo-bleed`, `text-rule`.

`photo-left` MUST show both states, since it encodes existing feedback from `wiki/Wedding Invite Notes.md`: desktop = photo left / text right-aligned; mobile = photo underneath. Annotate the letter-spacing note (`--tracking-wide` on story body) as a caption.

- [ ] **Step 7: Events diagrams**

Container + label `EVENTS — 2 VARIANTS`, then one call per diagram:

- `stack` — 2 cards stacked. Caption: `≤3 events. Today's EventCard.`
- `timeline` — vertical rail with day-group headers and 5 nodes. Caption: `4+ events, multi-day. NEW SURFACE — no equivalent in @cire/web.`

- [ ] **Step 8: Screenshot + review checkpoint**

`get_screenshot({nodeId: <artboard id>})`. Six checkpoints + verdict. If content clips, `update_styles({updates: [{nodeIds: [<artboard id>], styles: {height: "fit-content"}}]})`. Do not guess a fixed height.

- [ ] **Step 9: Release + report**

`finish_working_on_nodes()`. Report to the user: the nine primitives, and an explicit statement of whether they look sufficient to express both probe templates.

---

### Task 4: Foundations — type specimens + floral-band ornament

**Files:**
- Create: artboards `Primitives / type` and `Primitives / ornament` on page `Foundations`

**Interfaces:**
- Consumes: font + colour tokens from Task 2.
- Produces: `floral-band` SVG, reused by Task 5 and Task 6 via `<x-paper-clone>`.

- [ ] **Step 1: Type specimen artboard**

```
create_artboard({name: "Primitives / type", styles: {
  display: "flex", flexDirection: "column", width: "1440px", height: "900px",
  backgroundColor: "#FFFFFF", padding: "80px", gap: "48px"
}})
```

- [ ] **Step 2: hindu-jewel specimen**

One call. Display line `प्रिया और अर्जुन` in `--font-display-hindu` at `--text-display-lg`, `--tracking-tight` — this is the actual reason the family was chosen, so the specimen must exercise Devanagari, not Latin-only. Below it, `Priya & Arjun` at `--text-display`. Below that, the body paragraph from the placeholder content at `--text-body` / `--leading-body` in `--font-body-hindu`. Dark ground (`--color-hindu-ground`), text `--color-hindu-text`.

- [ ] **Step 3: minimal specimen**

One call. `Elena & Tom` in `--font-display-minimal` at `--text-display-lg`, `--font-weight-bold`, `--tracking-tight`. Body paragraph at `--text-body` / `--leading-body`, `--font-weight-regular`. White ground, `--color-minimal-text`. The weight contrast (800 vs 400) is the point — verify it reads.

- [ ] **Step 4: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict. Specifically confirm the Devanagari renders as glyphs and not tofu boxes. **If it tofus, STOP and report** — the Noto assumption has failed.

- [ ] **Step 5: Ornament artboard**

```
create_artboard({name: "Primitives / ornament", styles: {
  display: "flex", flexDirection: "column", width: "1440px", height: "600px",
  backgroundColor: "#14121F", padding: "80px", gap: "32px"
}})
```

- [ ] **Step 6: floral-band SVG**

One call. An inline `<svg>` band ~1200×80, stroke `var(--color-hindu-gold)`, fill `none` — a repeating marigold/vine motif. SVGs support tokens via CSS variables on `stroke`/`fill`. Restraint per the guide: one refined motif, not five competing ones.

Name it `layer-name="ornament / floral-band"` and record its node ID for cloning in Tasks 5–6.

- [ ] **Step 7: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict.

- [ ] **Step 8: Release**

`finish_working_on_nodes()`.

---

### Task 5: `hindu-jewel / mobile`

The heavy pole: 5 events, Devanagari, `framed` hero, `timeline` events, ornament.

**Files:**
- Create: artboard `hindu-jewel / mobile` on page `Templates`

**Interfaces:**
- Consumes: tokens (Task 2), `floral-band` node ID (Task 4).
- Produces: the reference comp that Task 6 (desktop) mirrors.

- [ ] **Step 1: Status bar markup**

`get_guide({topic: "mobile-status-bar"})`. Use the returned markup verbatim. Do not hand-draw one.

- [ ] **Step 2: Create the artboard**

```
create_artboard({name: "hindu-jewel / mobile", styles: {
  display: "flex", flexDirection: "column", width: "390px", height: "844px",
  backgroundColor: "var(--color-hindu-ground)"
}})
```

- [ ] **Step 3: Status bar**

One call, guide markup, light content (dark ground).

- [ ] **Step 4: Hero — `framed`**

One call. Inset 1px `--color-hindu-gold` border, generous padding. Inside: `प्रिया और अर्जुन` small above, `Priya & Arjun` at `--text-display` in `--font-display-hindu`, subtitle `5 — 7 December 2026 · Udaipur, Rajasthan` at `--text-label`, `--tracking-wide`, `--color-hindu-text-muted`.

- [ ] **Step 5: Hero ornament**

One call. `<x-paper-clone node-id="<floral-band id>" style="width:100%" />` beneath the hero type. Cloning, not rewriting — the guide is explicit that this saves tokens.

- [ ] **Step 6: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict. The hero is what sells the template in a picker — hold it to the highest bar. Fix before continuing.

- [ ] **Step 7: Story — `photo-left` (mobile state)**

Per `wiki/Wedding Invite Notes.md`, mobile = photo underneath. One call for the text block: eyebrow `Our Story` (`--text-label`, `--tracking-wide`, `--color-hindu-marigold`), heading `Two cities, one long train ride` (`--text-h1`), body paragraph (`--text-body`, `--leading-body`, `--tracking-wide` — the notes ask for larger letter-spacing).

- [ ] **Step 8: Story photo**

One call. Image placeholder block below the text, `--color-hindu-surface` fill, full-bleed width.

- [ ] **Step 9: Events header**

One call. Eyebrow + heading (`detailsEyebrow` / `detailsHeading` slots exist in the schema — this copy is organiser-editable).

- [ ] **Step 10: Events — `timeline` rail + first day group**

One call for the rail container (vertical 1px `--color-hindu-gold` line, left gutter, fixed-width slot `flexShrink: 0` for the node dots — vertical lane alignment is mandatory). Then one call for the `FRIDAY 4 DECEMBER` day-group header.

- [ ] **Step 11: Mehndi event node**

One call. Dot on the rail lane, name `Mehndi`, time `4:00pm`, venue `Courtyard, Hotel Lakend`, dress code line, and a 3-swatch palette row (marigold / bougainvillea / leaf).

- [ ] **Step 12: Remaining 4 event nodes**

Use `duplicate_nodes` on the Mehndi node, then `set_text_content` + `update_styles` per the content table — cheaper than four `write_html` calls. Add day-group headers for `SATURDAY 5 DECEMBER` (Haldi, Sangeet) and `SUNDAY 6 DECEMBER` (Ceremony, Reception).

- [ ] **Step 13: Screenshot + review checkpoint — the critical one**

`get_screenshot({nodeId: <artboard id>})`. Six checkpoints + verdict.

Trace a vertical line through all five dots and all five event names — they MUST align. This is where `timeline` either works or doesn't.

Content will almost certainly clip 844px. That is expected: `update_styles({updates: [{nodeIds: [<artboard id>], styles: {height: "fit-content"}}]})`. Never guess a fixed height.

- [ ] **Step 14: Release + report**

`finish_working_on_nodes()`. Report: does `timeline` carry 5 events across 3 days at 390px without becoming a pile? Answer honestly — a "no" here is the probe doing its job, not a failure.

---

### Task 6: `hindu-jewel / desktop`

**Files:**
- Create: artboard `hindu-jewel / desktop` on page `Templates`

**Interfaces:**
- Consumes: tokens, `floral-band`, and the mobile comp (clone its subtrees where they survive the reflow).

- [ ] **Step 1: Create the artboard**

```
create_artboard({name: "hindu-jewel / desktop", styles: {
  display: "flex", flexDirection: "column", width: "1440px", height: "900px",
  backgroundColor: "var(--color-hindu-ground)"
}})
```

- [ ] **Step 2: Hero — `framed` at scale**

One call. Same structure as mobile, `--text-display-lg` for the couple line. The frame inset should be proportionally generous — 80px, not 24px. Scale contrast is the guide's explicit preference.

- [ ] **Step 3: Hero ornament**

One call. `<x-paper-clone node-id="<floral-band id>" />`.

- [ ] **Step 4: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict.

- [ ] **Step 5: Story — `photo-left` (desktop state)**

Per the notes: photo LEFT, text RIGHT-ALIGNED. One call for the row container (`display:flex; gap:48px`), one call for the photo block (left, `--color-hindu-surface`), one call for the text block (right, `textAlign: "right"`, `--tracking-wide` body).

This is the exact layout the notes asked for. Verify it against them.

- [ ] **Step 6: Events — `timeline` at desktop**

Rail container, then day groups, then clone the mobile event nodes via `<x-paper-clone>` and re-flow. Decide and state explicitly: does the desktop rail stay single-column, or do day groups sit side by side? Single-column is the safer default — a 3-column rail stops reading as a timeline.

- [ ] **Step 7: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict. Trace the dot lane. `height: "fit-content"` if clipped.

- [ ] **Step 8: Release**

`finish_working_on_nodes()`.

---

### Task 7: `minimal / mobile`

The light pole: 2 events, Latin, `split` hero, `stack` events, no ornament.

**Files:**
- Create: artboard `minimal / mobile` on page `Templates`

- [ ] **Step 1: Create the artboard**

```
create_artboard({name: "minimal / mobile", styles: {
  display: "flex", flexDirection: "column", width: "390px", height: "844px",
  backgroundColor: "var(--color-minimal-ground)"
}})
```

- [ ] **Step 2: Status bar**

One call. Guide markup, dark content (light ground).

- [ ] **Step 3: Hero — `split`**

One call. Image block top (`--color-minimal-fog`), type below: `Elena & Tom` at `--text-display`, `--font-weight-bold`, `--tracking-tight`; subtitle `18 April 2026 · Marin County, California` at `--text-label`, `--tracking-wide`, `--color-minimal-slate`.

White space is the feature here. Resist adding anything.

- [ ] **Step 4: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict. Specifically: does this read as *designed restraint* or as *unfinished*? That distinction is the whole template.

- [ ] **Step 5: Story — `photo-left` (mobile state)**

One call text block (eyebrow / `A wrong turn at Point Reyes` / body), one call photo block underneath.

- [ ] **Step 6: Events — `stack`**

One call for the section header, then one call per event card (Ceremony, Reception) per the content table. Cards are the existing `EventCard` shape — information on the surface, minimal boxing (guide preference).

- [ ] **Step 7: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict. `height: "fit-content"` if clipped.

- [ ] **Step 8: Release**

`finish_working_on_nodes()`.

---

### Task 8: `minimal / desktop`

**Files:**
- Create: artboard `minimal / desktop` on page `Templates`

- [ ] **Step 1: Create the artboard**

```
create_artboard({name: "minimal / desktop", styles: {
  display: "flex", flexDirection: "column", width: "1440px", height: "900px",
  backgroundColor: "var(--color-minimal-ground)"
}})
```

- [ ] **Step 2: Hero — `split` at scale**

One call. True vertical split: image left half, type right half. `--text-display-lg`, `--font-weight-bold`, `--tracking-tight`. Asymmetry over centering — the guide prefers it.

- [ ] **Step 3: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict.

- [ ] **Step 4: Story — `photo-left` (desktop state)**

Photo left, text right-aligned. One call per block.

- [ ] **Step 5: Events — `stack` at desktop**

Section header, then the two cards. Decide and state: side by side, or stacked with generous rhythm? Two cards side by side at 1440px risks reading as a pricing table — stacked with air is likelier right for a wedding.

- [ ] **Step 6: Screenshot + review checkpoint**

`get_screenshot`. Six checkpoints + verdict. `height: "fit-content"` if clipped.

- [ ] **Step 7: Release + report all four comps**

`finish_working_on_nodes()`. Screenshot all four probe artboards. Report to the user with the probe's actual verdict: **did the primitives survive both poles?**

State plainly if any of these are true — they are the outcomes the probe exists to surface:
- a primitive needed a value that isn't in the enum
- `hindu-jewel` and `minimal` couldn't share bones without one looking compromised
- `timeline` didn't work at 390px

**GATE: stop here for user review before Task 9.**

---

### Task 9: Primitives spec + changeset + PR

Only this task touches the repo.

**Files:**
- Create: `cire/wiki/architecture/invite-templates.md`
- Modify: `cire/wiki/index.md`
- Modify: `CLAUDE.md` (wiki-nav table)
- Create: `.changeset/cire-invite-templates.md`

- [ ] **Step 1: Extract real values from Paper**

Use `get_computed_styles` and `get_jsx` on the four comps. **Never read values off screenshots** — the guide is explicit. Screenshots verify; they don't source.

- [ ] **Step 2: Write the wiki page**

Create `cire/wiki/architecture/invite-templates.md` with required frontmatter:

```markdown
---
title: "Invite Templates"
tags: [architecture, web, theme, design]
related:
  - "[[invite-builder]]"
  - "[[cire]]"
  - "[[index]]"
last-reviewed: 2026-07-16
---
```

Body must document: the registry entry shape; the four bounded enums with every value; the Noto font-key expansion; `suggestedEvents` as import-time defaults (no schema change); the cultural-review release gate; and — recorded honestly — the probe's actual verdict from Task 8, including anything that failed.

- [ ] **Step 3: Link from the wiki index**

Add `[[invite-templates]]` to `cire/wiki/index.md`. Wiki maintenance rule: use `[[wiki links]]`, never relative markdown links.

- [ ] **Step 4: Add the CLAUDE.md nav row**

In the Wiki Navigation table, after the invite-builder-adjacent rows:

```markdown
| Work on cire invite templates / the template picker | `[[cire/wiki/architecture/invite-templates]]` |
```

- [ ] **Step 5: Write the changeset**

CI requires one. `@cire/theme` is version-less/ignored — valid alone, never mixed with a versioned package.

```markdown
---
"@cire/theme": patch
---

Invite templates design spec — four bounded layout primitives (hero/story/events/ornament) plus per-template type and palette tokens, derived from the hindu-jewel + minimal probe comps.
```

- [ ] **Step 6: Validate the changeset locally**

Run: `bash scripts/validate-changesets.sh`
Expected: `✅` with `@cire/theme` listed among known workspace names. Fixing this locally beats discovering it in CI.

- [ ] **Step 7: Commit**

```bash
cd /Users/ac/.work/osn.git/cire-invite-templates
git add cire/wiki/architecture/invite-templates.md cire/wiki/index.md CLAUDE.md .changeset/cire-invite-templates.md
git commit -m "docs(cire): invite template primitives spec from Paper probe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Note: `lefthook` is not in PATH in this fresh worktree (`bun install` hasn't run there). Harmless for a docs commit; run `bun install` first if the hooks are wanted.

- [ ] **Step 8: Open the PR**

```bash
git push -u origin feat/cire-invite-templates
gh pr create --title "docs(cire): invite templates design + Paper probe" --body "..."
```

PR body must link the Paper file, state the probe verdict, and call out the cultural-review gate as blocking for any cultural template.

---

## Follow-on (NOT this plan)

- Remaining eight templates — one at a time, quality-gated, cultural review per template.
- `@cire/web` implementation of the primitives (`timeline` is the only real build).
- Organiser-side picker UI.
- RSVP / details modals, code-entry screen, motion signatures.
