import type { RpSession } from "@shared/rp-auth";
import { onMount } from "solid-js";

import ProfileMenu from "./ProfileMenu";
import ViewTabs, { type VendorView } from "./ViewTabs";

/**
 * The portal's only chrome.
 *
 * It replaces two stacked bands — an Astro masthead carrying a "Vendor Portal"
 * eyebrow above a `Your business` display heading, and a row of four bare
 * text buttons under it — with one sticky row. The masthead said nothing a
 * signed-in vendor needed twice, and cost the whole first screen to say it.
 *
 * The design law it enforces: **the container is continuous; only its contents
 * change.** Nothing below this bar is chrome, so the first thing under it is
 * always the thing the vendor came for.
 *
 * Reading left to right it answers two questions in order: whose product
 * (wordmark), and which of the two views am I in (tabs). Account housekeeping
 * sits at the far end, in a menu, away from the work. The wordmark doubles as
 * the way back to the listings view, which is why its accessible name says so —
 * a logo that navigates and doesn't announce it is a trap for anyone not
 * looking at it.
 *
 * Sticky rather than fixed so it participates in flow and the page below needs
 * no compensating top padding. `overflow-x: clip` (not `hidden`) on the
 * document is load-bearing for that: `hidden` would make the document a scroll
 * container and strand the bar mid-page.
 */
export default function TopBar(props: {
  session: RpSession | null | undefined;
  view: VendorView;
  onView: (next: VendorView) => void;
  onHome: () => void;
  onSignOut: () => void;
}) {
  // The static bar in `index.astro` paints this row before the island's script
  // arrives, and stands in for it through the session check. It goes the moment
  // the real one exists — mount, not module load, so the two never overlap for
  // a frame and never both go missing.
  onMount(() => document.getElementById("boot-chrome")?.remove());

  return (
    <header class="border-border bg-bg/85 sticky top-0 z-30 border-b backdrop-blur-md">
      <div class="page-frame flex h-14 items-center gap-2 @2xl/frame:h-16">
        <button
          type="button"
          aria-label="Cire — your listings"
          onClick={() => props.onHome()}
          class="group hover:bg-surface/60 -mx-1 flex shrink-0 items-center gap-2 rounded-sm px-1.5 py-1.5 transition-colors duration-(--dur-fast) ease-(--ease-out)"
        >
          <span
            aria-hidden="true"
            class="text-gold group-hover:text-gold-ink text-[0.85rem] leading-none transition-colors duration-(--dur-fast)"
          >
            ✦
          </span>
          <span
            aria-hidden="true"
            class="font-display text-text text-[1.05rem] leading-none font-light tracking-[0.02em]"
          >
            Cire
          </span>
        </button>

        {/* Hidden below the strip's own breakpoint: at phone width the divider
            and the tabs together overflow the row, and the tabs are the half
            that carries meaning. */}
        <span aria-hidden="true" class="bg-border hidden h-5 w-px shrink-0 @md/frame:block" />

        <ViewTabs value={props.view} onChange={props.onView} />

        <div class="ml-auto flex shrink-0 items-center gap-2">
          <ProfileMenu session={props.session} onSignOut={props.onSignOut} />
        </div>
      </div>
    </header>
  );
}
