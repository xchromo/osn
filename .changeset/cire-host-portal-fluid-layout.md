---
"@cire/organiser": patch
---

Make the host portal fluid: a `page-frame` measure that scales with the screen,
intrinsic `auto-grid` card grids, and the wide layouts the shell already
declared but could never reach.

The shell has queried **containers** rather than the viewport since the
2026-07-22 redesign, but `index.astro` capped the page at a fixed
`max-w-[1100px]`. On a widescreen that left the portal as a narrow column
between two empty margins — and, less visibly, held the panel below every wide
threshold the components declared: the invite builder's `@4xl/builder`
side-by-side `PreviewPane` was unreachable code on exactly the screens it was
written for.

Two utilities in `global.css` now carry the intrinsic half of the system:

- **`page-frame`** — `cqi`-based gutters and `max-width: var(--page-max, 100rem)`.
  Worn by the masthead, `<main>`, the login card (`[--page-max:30rem]`) and the
  two portalled editor save bars, so a `fixed` bar lines up with the page behind
  it.
- **`auto-grid`** — `repeat(auto-fit, minmax(min(100%, var(--auto-grid-min)), 1fr))`.
  Card and field counts follow the available width with no `grid-cols` ladder to
  extend: Overview's stat cards, the wedding list, checklist buckets, budget
  categories, event cards, directory listings, settings fields, the CSV import
  steps and the builder's field grids.

New shape switches (container queries, because these change the layout rather
than scale it): Overview gives the agenda a fixed-measure left column beside the
stat cards at `@4xl/panel`; `EnquiriesView` becomes real master-detail at
`@3xl/enquiries`, keeping the inbox mounted and hiding it with
`@max-3xl/enquiries:hidden` on narrow layouts (`EnquiryInbox` gained
`selectedId` + `aria-current` so the open thread is marked); the module rail is
`sticky top-6 self-start` from `@2xl/shell` up, so the modules no longer scroll
away on a long panel.

Also fixes two components that were querying a container they didn't live in —
the event card's details grid (now its own `@container/card`) and the builder's
field grids (now intrinsic, since they sit in the form column, not the builder).

No data, route, hash or copy changes. Contract documented in
`cire/wiki/architecture/host-portal-layout.md`.
