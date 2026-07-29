import { type JSX, onMount, Show } from "solid-js";

import { CATEGORY_META, type ConsentCategory } from "../../lib/consent/categories";
import {
  grantCategory,
  hydrateConsent,
  isCategoryGranted,
  openConsentPreferences,
} from "../../lib/consent/store";
import { vendorById } from "../../lib/consent/vendors";

interface ConsentGateProps {
  /** The category that must be granted before `children` may render. */
  category: ConsentCategory;
  /** Registry id of the third party behind this gate — names it in the placeholder. */
  vendor: string;
  /**
   * What to render instead when consent is absent. Omit for the standard
   * placeholder (vendor name + purpose + an in-place "allow" button). Pass
   * something else when the component already has a good un-consented state to
   * fall back to — `MapPreview` passes its CSS-drawn map card, which is a
   * better answer than a permission notice where a map should be.
   */
  fallback?: JSX.Element;
  children: JSX.Element;
}

/**
 * Renders `children` only once the guest has granted `category`.
 *
 * This is the single choke point that replaced the bespoke, Pinterest-shaped
 * gate: previously the one third party that happened to have a consent story
 * carried its own persisted key, its own prompt and its own copy inside the
 * component that used it, while the Google Maps embed — an equivalent transfer
 * to an equivalent US recipient — had no gate at all, because nobody had
 * written it one. Consent lived wherever someone had remembered to put it.
 * Making the gate a wrapper inverts that: a new embed is un-consented by
 * construction, and shipping it *without* a decision means deliberately not
 * wrapping it rather than merely not thinking about it.
 *
 * Children are not rendered — not hidden — while consent is absent, so a gated
 * component's `onMount`/`createEffect` never runs and no request can escape.
 * That is the property that makes the gate meaningful for something like
 * Pinterest, whose entire tracker is injected from inside such an effect.
 */
export function ConsentGate(props: ConsentGateProps) {
  // Read the persisted decision on mount. Every gate does this rather than
  // depending on a banner having mounted first, so an embed behaves correctly
  // on any page — including one that never shows the banner because the guest
  // already decided.
  onMount(hydrateConsent);

  return (
    <Show
      when={isCategoryGranted(props.category)}
      fallback={
        props.fallback ?? <ConsentPlaceholder category={props.category} vendor={props.vendor} />
      }
    >
      {props.children}
    </Show>
  );
}

/**
 * The standard blocked-content notice: what would be here, who it comes from,
 * and two ways to act on it.
 *
 * Both routes are offered on purpose. "Allow" grants just this category, so the
 * guest who only wants to see the moodboard isn't forced through a settings
 * dialog to get it; "privacy choices" opens the full picture for the guest who
 * wants to know what else they'd be turning on before turning it on. Offering
 * only the first would be a one-click accept with no visible alternative, which
 * is the pattern regulators treat as consent that was not freely given.
 */
export function ConsentPlaceholder(props: { category: ConsentCategory; vendor: string }) {
  const vendor = () => vendorById(props.vendor);
  const vendorName = () => vendor()?.name ?? "This content";
  const categoryTitle = () => CATEGORY_META[props.category].title.toLowerCase();

  return (
    <div class="border-border/70 bg-surface-raised/60 mt-2 rounded-md border px-4 py-4 text-center">
      <p class="font-body text-text-muted text-[0.78rem] leading-relaxed">
        <Show
          when={vendor()?.purpose}
          fallback={<>Content from {vendorName()} is blocked until you allow it.</>}
        >
          {(purpose) => (
            <>
              {vendorName()} would {purpose().charAt(0).toLowerCase() + purpose().slice(1)}
            </>
          )}
        </Show>
      </p>
      <p class="font-body text-text-muted/80 mt-1.5 text-[0.72rem] leading-relaxed">
        It loads from {vendorName()}'s servers, which lets them see your IP address and browser.
      </p>
      <div class="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => grantCategory(props.category)}
          class="border-gold text-gold hover:bg-gold hover:text-bg focus-visible:ring-gold/60 rounded-sm border px-4 py-1.5 text-[0.7rem] tracking-[0.12em] uppercase transition-colors duration-200 focus:outline-none focus-visible:ring-2"
        >
          Allow {categoryTitle()}
        </button>
        <button
          type="button"
          onClick={openConsentPreferences}
          class="font-body text-text-muted hover:text-gold focus-visible:ring-gold/60 rounded-sm text-[0.72rem] underline underline-offset-2 transition-colors duration-200 focus:outline-none focus-visible:ring-2"
        >
          Privacy choices
        </button>
      </div>
    </div>
  );
}
