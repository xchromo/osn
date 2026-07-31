import { Show } from "solid-js";

import { heroCropBackgroundStyle, type ImageCrop } from "./image-crop";
import { isFooterEmpty } from "./invite-emptiness";
import { buildSrcSet, variantSrc } from "./invite-images";

/**
 * The invite's CLOSING SECTION — the couple's own sign-off: an optional
 * EDGE-TO-EDGE image over an optional closing note ("Looking forward to
 * celebrating with you", "No boxed gifts please").
 *
 * This is a SECTION OF THE INVITE, not part of the site footer:
 *   - `SiteFooter.astro` is site-wide chrome — the couple's title plus the legal
 *     links + privacy control. It renders on EVERY document (invite, /privacy,
 *     /terms, 404) and must always be there (compliance blocker C-H4).
 *   - This is invite content, rendered by `InvitePage` as the last thing above
 *     that footer, and — like the events list — only AFTER the guest has
 *     claimed their code, because it is addressed to the invited household.
 *
 * That gate is enforced at the API, not here (S-H1): `GET /api/invite/:slug` is
 * unauthenticated, so it REDACTS the closing section, and the content is
 * delivered in the claim response instead (`ClaimResult.closing`). The motif's
 * bytes are likewise session-gated and served `Cache-Control: private`. This
 * component therefore receives nothing at all until a code is entered — the
 * render gate and the data gate are the same gate.
 *
 * Like the hero and Our Story it is a conditional segment: with neither a note
 * nor an image it renders NOTHING — no empty surface, no stray band above the
 * footer.
 *
 * IMAGE SHAPE — the image is a CLOSING HERO: a full-bleed band spanning the
 * viewport edge to edge, mirroring the hero at the top of the invite, with the
 * note (when there is one) reading below it on the section surface. It was a
 * small centred square before; a photograph is what couples reach for here, and
 * a 200px thumbnail made the sign-off read like a stray avatar rather than the
 * page's closing image. Consequences of full-bleed, all shared with the hero:
 *   - the band is a FIXED responsive height, not the image's own aspect — an
 *     edge-to-edge box at the source's ratio would be ~1600px tall on a desktop
 *     for a square upload;
 *   - so the image is COVER-fitted, and a saved crop is a FOCAL POINT
 *     (`heroCropBackgroundStyle`) rather than an exact frame — same treatment
 *     the hero backdrop gives the organiser's rectangle, for the same reason;
 *   - the section's horizontal padding moved off the `<section>` onto the note's
 *     own block, since the band has to reach past it.
 *
 * SURFACE — it deliberately has NO tone setting of its own. It paints whatever
 * the organiser chose for the "Code Entry & Welcome" section (`themeVars`,
 * supplied by the caller as `sectionVars(theme, "welcome")`): the welcome
 * greeting and this closing note are the couple's two direct addresses to their
 * guests, so they read as a matched pair, and the builder gains no extra knob.
 *
 * NAMING — storage and the wire say `footer_*` / `footer` (the invite's footer
 * section, and the image slot's R2 namespace + public URL segment), while the
 * organiser-facing label is "Closing Section". Deliberate, not drift: showing an
 * organiser "footer" next to a page that also has a legal footer would be
 * ambiguous about which one they are editing.
 */

/**
 * The closing hero band's height, shared by the plain `<img>` and the cropped
 * background layer so the two paths can never disagree. A literal Tailwind class
 * (the scanner reads source text — a computed class emits no CSS at all), held
 * in one const rather than typed twice.
 *
 * Height, not aspect-ratio: the band is full-bleed, so an aspect-driven box
 * would be as tall as the viewport is wide. `clamp` gives ~256px on a phone and
 * ~512px from a laptop up — a closing image with presence, that still leaves the
 * note and the site footer in view.
 */
const BAND_CLASS = "block h-[clamp(16rem,45vw,32rem)] w-full";

export interface InviteClosingProps {
  /** The couple's closing note. Blank/whitespace-only ⇒ no note. */
  message?: string | null;
  /**
   * The closing image's URL *path* as the API reports it, or null for none. The
   * component prepends `apiUrl` — callers pass the payload value unchanged.
   */
  imageUrl?: string | null;
  /** Crop rectangle the organiser framed the closing image with, if any. */
  imageCrop?: ImageCrop | null;
  /** cire-api origin the image path is resolved against. */
  apiUrl: string;
  /**
   * Validated CSS-variable map for this section's surface — the WELCOME
   * section's vars (`sectionVars(theme, "welcome")`), since this section
   * deliberately shares that tone rather than carrying one of its own.
   */
  themeVars?: Record<string, string>;
}

export function InviteClosing(props: InviteClosingProps) {
  // The whole section is a conditional segment: nothing set ⇒ render nothing.
  // `isFooterEmpty` is the shared predicate the organiser builder mirrors for
  // its "Shown / Hidden — empty" badge, so the two cannot disagree.
  const show = () => !isFooterEmpty({ message: props.message, imageUrl: props.imageUrl });

  // Trimmed so a note of "  text  " doesn't render its padding. The API already
  // normalises on save; this also covers a legacy row.
  const note = () => props.message?.trim() ?? "";

  const imageSrc = () => (props.imageUrl ? `${props.apiUrl}${props.imageUrl}` : null);

  // A saved crop paints a background layer instead of the `<img>` — and, because
  // the band is a fixed viewport-width shape rather than the crop's own aspect,
  // it is rendered as a FOCAL POINT (cover, centred on the crop's middle), the
  // same treatment the hero backdrop gives its rectangle. An exact-fit render
  // here would letterbox or shear whenever the crop's ratio differed from the
  // band's. Backgrounds can't carry a `srcset`, so we name one bounded variant:
  // `hero` (1600w), the width a full-bleed band actually needs.
  const cropStyle = () => {
    const url = imageSrc();
    return url ? heroCropBackgroundStyle(variantSrc(url, "hero"), props.imageCrop) : null;
  };

  return (
    <Show when={show()}>
      <section
        data-invite-closing
        // No horizontal padding of its own — the band reaches the viewport edge,
        // and the note below carries its own. `content-visibility: auto` defers
        // layout/paint (and the crop path's background fetch) until this
        // off-screen section approaches the viewport; the intrinsic-size hint
        // keeps a skipped band from collapsing the scroll height to nothing,
        // which now matters more than it did at 200px.
        class="text-center [contain-intrinsic-size:auto_24rem] [content-visibility:auto]"
        // Paints the welcome section's surface; the text tokens below resolve
        // from the root palette, which already carries the organiser's scheme.
        style={{ ...props.themeVars, "background-color": "var(--invite-section-bg)" }}
      >
        <Show when={imageSrc()}>
          {(url) => (
            <Show
              when={cropStyle()}
              fallback={
                /* Two candidates so `sizes` has a real choice to make: `card`
                   (800w) covers the band on a phone, `hero` (1600w) from a
                   laptop up (and on a retina phone). The bare `src` names
                   `card` explicitly — an absent `variant` resolves to `card`
                   server-side anyway, and naming it keeps the browser from
                   minting a second transform-cache entry for a URL it never
                   fetches under a `w`-descriptor srcset. `loading="lazy"`
                   because this section is below every event card and is
                   guaranteed off-screen at mount: without it the fetch races
                   the in-viewport cards that ARE deferred, and bills a
                   per-call Images transform for guests who never scroll here. */
                <img
                  src={variantSrc(url(), "card")}
                  srcset={buildSrcSet(url(), ["card", "hero"])}
                  sizes="100vw"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class={`${BAND_CLASS} object-cover`}
                />
              }
            >
              {(style) => (
                <div
                  aria-hidden="true"
                  // The cropped variant paints a background layer, so the box
                  // owns its size (an empty div has no intrinsic dimensions) —
                  // the same band height the <img> path uses.
                  class={BAND_CLASS}
                  style={style()}
                />
              )}
            </Show>
          )}
        </Show>
        <Show when={note()}>
          {/* The note's own block owns the section padding now that the band
              above it is full-bleed. */}
          <div class="px-6 py-16 md:px-8 md:py-20">
            <p
              // `whitespace-pre-line` honours the line breaks an organiser typed;
              // `break-words` stops a long unbroken line overflowing on a phone.
              // Not the muted grey — this is the couple speaking.
              class="font-body text-text mx-auto max-w-[34rem] text-[clamp(1rem,2vw,1.125rem)] leading-relaxed break-words whitespace-pre-line italic"
              // Not a styling hook (the block above owns the spacing) — it
              // records that the couple's words follow their image, which the
              // tests pin so the two can't silently swap order.
              data-has-image={imageSrc() ? "true" : "false"}
            >
              {note()}
            </p>
          </div>
        </Show>
      </section>
    </Show>
  );
}
