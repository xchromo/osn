---
title: Pulse Landing
description: Marketing site for Pulse events — colourful static Astro brochure following the Pulse design system
tags: [app, events, marketing]
status: active
packages:
  - "@pulse/landing"
related:
  - "[[pulse]]"
  - "[[osn-landing]]"
  - "[[cire-landing]]"
  - "[[venues]]"
last-reviewed: 2026-06-28
---

# Pulse Landing

`@pulse/landing` (`pulse/landing`, dev port **4325**; root script
`dev:pulse-landing`) is the **marketing site** for Pulse — the events app. It
sells the "what's happening near you" experience and points visitors at the
Pulse app. Pure brochure: no Pulse API calls, no account.

## Stack

Same stack as [[cire-landing]] and [[osn-landing]]: **static Astro + SolidJS
islands + Tailwind v4** (`output: "static"`). Signature animation is SVG +
CSS / `requestAnimationFrame` (Motion One is a declared dep for parity but not
imported). Builds to plain HTML, deployable to Cloudflare Pages.

Brand fidelity follows the Pulse design system — see `pulse/DESIGN.md`:

- Fonts: **Instrument Serif** (editorial display, italic accent word), **Geist**
  (UI/body), **Geist Mono** (eyebrow / meta), loaded via the shared preload +
  `noscript` strategy.
- Tokens in `src/styles/global.css` (`@theme`): the coral/ember/peach accent
  family shared with the app (`--pulse-accent*`), warm-tinted neutrals on a
  warm-light base, plus a vivid `--cat-1..6` palette for the category showcase.
- Shared primitives ported from `cire/landing`: the `[data-reveal]` scroll-reveal
  utility + its `IntersectionObserver` bootstrap, and the reduced-motion opt-out.

## Visual identity — colourful + fun

The brief is "colourful and fun" — the bright counterpart to [[osn-landing]]'s
restrained dark site. Two Solid islands:

- **`PulseField.tsx`** (`client:load`, mounted in `BaseLayout` behind every page)
  — a field of colourful pulsing dots / radiating rings in the category palette,
  echoing the app's pulsing-coral-dot mark. Low opacity, `pointer-events:none`,
  spans the page.
- **`PulseHero.tsx`** (`client:load`, `min-h-[100svh]`) — an editorial headline
  with an italic accent word, lively floating chips / faux live-stats, and two
  CTAs ("Find events" → app, "How it works" → `#how-it-works`).

Both honour `prefers-reduced-motion` (still field / instant reveal, no rAF loop)
and contain no `console.*`.

## Page structure (`src/pages/index.astro`)

1. **Pulse hero** — signature pulsing-dot energy + editorial headline + CTAs.
2. **Promise** — the thesis: the social ease of FB Events + the fun of
   Partiful/Luma + the tooling of Eventbrite; "what's happening today near you".
3. **Features** — colourful glyph/gradient cards (no photos): discovery by
   location/category/friends/interests, the "today near you" default view,
   effortless RSVPs, calendar + iCal export, venue pages, event group chats,
   organiser tools, hidden attendance. See [[pulse]].
4. **How it works** — discover → RSVP in a tap → show up.
5. **Categories** — the most colourful section: vivid per-category chips driven by
   `CATEGORIES` in `lib/site.ts`, each in its own `--cat-*` colour.
6. **Venues** — a stylised faux lineup timeline (mono time + act), teasing the
   real venue-page feature. See [[venues]].
7. **FAQ** — native `<details>` accordion.
8. **Final CTA + footer** — repeats the primary CTA; `SiteFooter.astro` carries
   `/privacy` + `/terms` (review drafts).

## Configuration

`src/lib/site.ts` holds `SITE_*` metadata, the `CATEGORIES` list (label + glyph +
colour token), and the CTA target:

| Var | Purpose | Dev default |
|---|---|---|
| `PUBLIC_APP_URL` | Primary CTA → the Pulse app | `http://localhost:3001` |
| `SITE` | Canonical origin for SEO meta (placeholder `https://pulse.events`) | config default |

`public/_headers` ships the same tight CSP as the other static sites (no external
image host; Google Fonts allowed; immutable `/_astro/*`).

## Tests

`PulseHero.test.tsx` renders the hero (reduced-motion path) and asserts the
headline + CTA. Run with `bun run --cwd pulse/landing test:run`.

## Deferred

- **CI deploy** — no deploy workflow yet; add one + a Pages project when a host
  is chosen.
- **Real domain** — `SITE` / `PUBLIC_APP_URL` are placeholders until the Pulse
  marketing + app hosts are decided.
- **Marketing depth** — screenshots/imagery once brand assets exist, deeper
  feature pages, SEO content.
