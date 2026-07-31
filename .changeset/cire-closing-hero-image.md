---
"@cire/organiser": minor
"@cire/web": minor
---

The cire invite's closing image is now a **full-bleed hero band**, spanning the
guest page edge to edge, instead of the 200px centred square it shipped as.

The slot was sized for a monogram or a signature; a photograph is what couples
reach for, and at 200px the sign-off read like a stray avatar rather than the
invite's closing image. It now mirrors the hero at the top of the page: full
width, square corners, the note (when there is one) reading below it on the
section surface.

- `@cire/web`: `InviteClosing.tsx` renders the image at `w-full` with a fixed
  `clamp(16rem,45vw,32rem)` band height and `object-cover`. Height rather than
  the image's own aspect, because an aspect-driven edge-to-edge box is as tall
  as the viewport is wide — a square upload would be ~1600px on a desktop.

  That makes a saved crop a **focal point** (`heroCropBackgroundStyle`: cover,
  centred on the crop's middle) rather than an exact frame — the same trade the
  hero backdrop already makes, and for the same reason: the band's shape is the
  viewport's, not the crop's, so an exact fit would letterbox the moment the two
  ratios differed. Legacy crops with no captured source dims keep framing the
  band instead of falling back to a fixed shape.

  Variants moved with the box: `thumb`/`card` at `sizes="200px"` became
  `card`/`hero` at `sizes="100vw"`, and the crop layer's tightness-based variant
  pick collapsed to plain `hero` (1600w — a background can't carry a `srcset`,
  and at viewport width the 320w thumb was far too soft). Still `loading="lazy"`
  and `decoding="async"`: the section sits below every event card.

  Two layout knock-ons: the section's horizontal padding moved off the
  `<section>` onto the note's own block, since the band has to reach past it;
  and `contain-intrinsic-size: auto 24rem` joined the existing
  `content-visibility: auto`, because a skipped band now collapses ~500px of
  scroll height rather than 200.
- `@cire/organiser`: `CROP_ASPECT.footer` went 1∶1 → 16∶9, so the crop editor
  opens on the shape that actually publishes, and the builder's section preview
  mirrors the band edge-to-edge (a framed thumbnail there would understate what
  saving does). The Closing Section description says the image spans the page
  edge to edge like the hero.

No API, schema or wire change — same `footer_image_key` / `footer_image_crop`
storage, same claim gate, same endpoints. Existing closing images keep rendering;
they are re-framed, not re-uploaded, so a crop saved against the old square
editor now reads as a focal point in the wide band.
