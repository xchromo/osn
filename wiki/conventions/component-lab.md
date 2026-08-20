---
title: Component Lab
description: The in-repo Storybook replacement for prototyping components, three.js scenes and canvas work
tags: [convention, frontend, tooling]
related:
  - "[[component-library]]"
  - "[[frontend-patterns]]"
  - "[[commands]]"
last-reviewed: 2026-08-20
---

# Component Lab

`@tools/lab` — a bench for building a component before it has anywhere to live.
Storybook's shape (sidebar of stories, live preview, args panel) in roughly 600
lines, on the stack the repo already runs.

```bash
bun run dev:lab          # http://localhost:4400
```

Nothing here ships. Full usage is in `tools/lab/README.md`; this page records
the decisions behind it.

## Why not Storybook

Storybook's Solid support (`storybook-solidjs-vite`) is community-maintained and
trails the Vite major line, and this repo is on Vite 8 with Tailwind v4. Adopting
it means a second build config, a second set of version constraints on every
Vite/Tailwind bump, and a `.storybook/` directory that has to be taught about the
token stylesheet anyway.

The parts actually wanted — discovery, a preview, live args, backdrops, a
viewport — are a few hundred lines against `import.meta.glob` and a Solid store.
The parts not wanted (a docs site, an addon API, a test runner, a static build
for publishing) are most of what Storybook is. Revisit if the lab starts growing
addons, or if the design system needs published docs for people outside the repo.

## Shape

| Piece | File | Notes |
| --- | --- | --- |
| Discovery | `src/lab/registry.ts` | `import.meta.glob` over `*.story.tsx`. Globs are literal — a new workspace root means a new line. |
| Story contract | `src/lab/types.ts` | Args are `string \| number \| boolean` — exactly what a control can edit. |
| Args panel | `src/lab/controls.tsx` | Editor inferred from the initial value; `controls` overrides. |
| three / canvas | `src/lab/three.tsx` | `ThreeCanvas`, `Canvas2D`, `htmlToCanvas`, `htmlToTexture`, CSS3D layer. |
| Shell | `src/Lab.tsx` | Sidebar, backdrops, viewports, theme, remount, `?bare`. |

Stories live either in `tools/lab/src/stories/` (spikes) or next to a real
component under any workspace's `src/` (permanent bench). Both are found.

## Decisions worth keeping

**The lab imports `osn/social/src/App.css` rather than copying tokens.** That
file is the source of truth for `--background`, the `.dark` block and the `base:`
variant every `@osn/ui` class is written against. A second copy drifts. The cost
is that the OSN look is the lab's default; a story with its own design language
imports its own CSS.

**No iframe.** Stories render in the same document as the chrome. Hot reload
stays instant and the code stays small; the trade is isolation — a story that
sets global CSS affects the chrome. `?bare` is the escape hatch, and is also what
a screenshot tool should be pointed at.

**Every export except `meta` is a story.** That is what makes
`export const Thing = () => <div />` work with no config. It also means an
exported helper shows up in the sidebar — keep helpers unexported.

**Stories are not tests and carry no gate.** The lab has no `test` script and
nothing in CI renders a story. `check` typechecks it, `lint` and `fmt:check`
cover it. A component whose behaviour matters still needs a real test — see
[[testing-patterns]].

## HTML in canvas

Three routes, demonstrated in `src/stories/html-in-canvas.story.tsx`:

- `htmlToCanvas` — DOM-authored artwork rasterised for canvas compositing.
- `htmlToTexture` — the same raster as a `CanvasTexture` in a 3D scene.
- `css3d` + `CSS3DObject` — live, clickable DOM transformed by the scene camera.
  Real hit-testing, but it composites *over* the WebGL layer: geometry cannot
  occlude it and it takes no lighting.

The first two go through an SVG `foreignObject`, which loads nothing external
(no web fonts, no remote images) and parses its markup as XML (every tag closed).
Both limits belong to the technique, not the helper.

## Gates

`tools/lab` is a workspace (`tools/lab` in the root `workspaces` array, not
`tools/*` — `tools/oxlint` holds vendored plugin source and no package.json).
`scripts/validate-changesets.sh` scans `tools/` alongside the product directories
so a changeset naming `@tools/lab` validates; `fmt` and `fmt:check` list
`tools/lab` explicitly, so the vendored `tools/oxlint/anti-slop` is never
reformatted.
