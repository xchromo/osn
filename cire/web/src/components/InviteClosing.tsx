import { Show } from "solid-js";

import { cropAspectRatio, cropBackgroundStyle, type ImageCrop } from "./image-crop";
import { isFooterEmpty } from "./invite-emptiness";
import { buildSrcSet, variantSrc } from "./invite-images";

/**
 * The invite's CLOSING SECTION — the couple's own sign-off: an optional image
 * (monogram, motif, signature) over an optional closing note ("Looking forward
 * to celebrating with you", "No boxed gifts please").
 *
 * This is a SECTION OF THE INVITE, not part of the site footer:
 *   - `SiteFooter.astro` is site-wide chrome — the couple's title plus the legal
 *     links + privacy control. It renders on EVERY document (invite, /privacy,
 *     /terms, 404) and must always be there (compliance blocker C-H4).
 *   - This is invite content, rendered by `InvitePage` as the last thing above
 *     that footer, and — like the events list — only AFTER the guest has
 *     claimed their code. It is behind the unlock because it is addressed to
 *     the invited household, not to anyone who happens to have the URL.
 *
 * Like the hero and Our Story it is a conditional segment: with neither a note
 * nor an image it renders NOTHING — no empty surface, no stray band above the
 * footer.
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
 * The closing image's display shape when no crop was saved (or a legacy crop
 * carries no source dims). Square: the slot is sized for a monogram, motif or
 * signature rather than a scene, and a square reads as deliberate at the small
 * width this section gives it.
 */
const CLOSING_IMAGE_ASPECT = 1;

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

  // When a crop was saved, render the cropped region with the same CSS-fraction
  // technique the story photo uses (a background layer — backgrounds can't take
  // a srcset, so we ask for one bounded variant comfortably above the rendered
  // width at retina). With no crop, fall back to a plain responsive <img>.
  const cropStyle = () => {
    const url = imageSrc();
    return url ? cropBackgroundStyle(variantSrc(url, "card"), props.imageCrop) : null;
  };

  // The box adopts the crop's TRUE pixel aspect (from its captured source dims)
  // so the uniformly-scaled region fills it with no distortion and no empty
  // bars; a legacy crop with no dims falls back to the square default.
  const imageAspect = () => String(cropAspectRatio(props.imageCrop, CLOSING_IMAGE_ASPECT));

  return (
    <Show when={show()}>
      <section
        data-invite-closing
        class="px-6 py-16 text-center md:px-8 md:py-20"
        // Paints the welcome section's surface; the text tokens below resolve
        // from the root palette, which already carries the organiser's scheme.
        style={{ ...props.themeVars, "background-color": "var(--invite-section-bg)" }}
      >
        <Show when={imageSrc()}>
          {(url) => (
            <Show
              when={cropStyle()}
              fallback={
                /* Renders at most 200px wide — `thumb` (320w) covers it at 2× DPR. */
                <img
                  src={url()}
                  srcset={buildSrcSet(url(), ["thumb"])}
                  sizes="200px"
                  alt=""
                  class="mx-auto block h-auto w-[min(200px,45vw)] rounded-sm object-cover"
                  style={{ "aspect-ratio": imageAspect() }}
                />
              }
            >
              {(style) => (
                <div
                  aria-hidden="true"
                  // The cropped variant paints a background layer, so the box
                  // clips it and takes its size from the width + aspect-ratio
                  // (an empty div has no intrinsic dimensions).
                  class="mx-auto w-[min(200px,45vw)] overflow-hidden rounded-sm bg-no-repeat"
                  style={{ ...style(), "aspect-ratio": imageAspect() }}
                />
              )}
            </Show>
          )}
        </Show>
        <Show when={note()}>
          <p
            // `whitespace-pre-line` honours the line breaks an organiser typed;
            // `break-words` stops a long unbroken line overflowing on a phone.
            // Not the muted grey — this is the couple speaking.
            class="font-body text-text mx-auto max-w-[34rem] text-[clamp(1rem,2vw,1.125rem)] leading-relaxed break-words whitespace-pre-line italic data-[has-image=true]:mt-7"
            data-has-image={imageSrc() ? "true" : "false"}
          >
            {note()}
          </p>
        </Show>
      </section>
    </Show>
  );
}
