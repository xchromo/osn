---
"@cire/organiser": minor
"@cire/web": minor
---

The cire invite's closing image is now a **full-bleed band**, spanning the guest
page edge to edge, instead of the 200px centred square it shipped as.

The slot was sized for a monogram or a signature; a photograph is what couples
reach for, and at 200px the sign-off read like a stray avatar rather than the
invite's closing image. It now spans the viewport, with the note (when there is
one) reading below it on the section surface.

- `@cire/web`: `InviteClosing.tsx` renders the image at `w-full` with square
  corners, and **the crop decides the height** — the box takes the crop's true
  pixel aspect and renders the framed region exactly (`cropBackgroundStyle`, the
  technique it already used), so an organiser who crops a 3∶1 panorama publishes
  a 3∶1 panorama and one who crops a 4∶3 scene publishes a 4∶3 scene.

  This is deliberately not the hero backdrop's treatment, which pins a
  viewport-shaped box and demotes the crop to a focal point: the hero's box is
  dictated by the screen it fills, while this band has no shape of its own to
  defend, so the crop editor can be honest. With no crop saved the image keeps
  its natural proportions (`h-auto`) — nothing was chosen, so nothing is cut.
  `max-h-[85dvh]` is the single bound, for the one bad case: a 4∶5 portrait at
  1440px wide would otherwise want 1800px of band and bury the note.

  Variants followed the box: `thumb`/`card` at `sizes="200px"` became
  `card`/`hero` at `sizes="100vw"`, and the crop layer's tightness-based variant
  pick collapsed to plain `hero` (1600w — a background can't carry a `srcset`,
  and at viewport width the 320w thumb was far too soft). Still `loading="lazy"`
  and `decoding="async"`: the section sits below every event card.

  Two layout knock-ons: the section's horizontal padding moved off the
  `<section>` onto the note's own block, since the band has to reach past it;
  and `contain-intrinsic-size: auto 24rem` joined the existing
  `content-visibility: auto`, because a skipped band now collapses a
  screen-height of scroll rather than 200px.
- `@cire/organiser`: the builder's section preview (`SectionSample`, the markup
  behind both the inline per-section card and the composed `PreviewPane`) now
  renders the band **edge to edge and crop-aware** — same exact-region render,
  same crop-driven aspect as the invite — so "what will my closing image look
  like" has a truthful answer before saving. `imageCrop` is threaded through
  `PreviewPaneProps["closing"]` and the inline preview to reach it.
  `CROP_ASPECT.footer` went 1∶1 → 16∶9, so the crop editor opens on the shape
  most couples want here rather than a square, and the Closing Section
  description says the image spans the page edge to edge like the hero.

No API, schema or wire change — same `footer_image_key` / `footer_image_crop`
storage, same claim gate, same endpoints. Existing closing images keep the
region their crop already framed; only the size it publishes at changes.
