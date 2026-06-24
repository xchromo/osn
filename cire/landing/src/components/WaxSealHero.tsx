import { createSignal, onCleanup, onMount, Show } from "solid-js";

import { unsplash } from "../lib/site";
import type { WaxSealRefs } from "./WaxSeal.motion";

interface WaxSealHeroProps {
  /** Background image — passed in so the markup stays config-driven. */
  heroImageId: string;
  heroImageAlt: string;
  /** Primary CTA target (organiser portal). */
  organiserUrl: string;
  /** Secondary CTA target — an external live invite, or an in-page anchor. */
  demoHref: string;
  /** True when `demoHref` is an external invitation rather than a page anchor. */
  demoIsExternal: boolean;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The hero: an envelope sealed with a gold wax disc that opens — on tap, or by
 * itself after a beat — to unveil the headline and calls to action. This is the
 * page's first impression and the thesis of the product in one gesture: a link
 * that feels like breaking a wax seal. Honours reduced motion (snaps open) and
 * is fully keyboard-operable.
 */
export function WaxSealHero(props: WaxSealHeroProps) {
  let stageRef!: HTMLDivElement;
  let flapRef!: HTMLDivElement;
  let sealRef!: HTMLButtonElement;
  let promptRef!: HTMLParagraphElement;
  let glowRef!: HTMLDivElement;
  let contentRef!: HTMLDivElement;

  const [opened, setOpened] = createSignal(false);

  function refs(): WaxSealRefs {
    return {
      stage: stageRef,
      flap: flapRef,
      seal: sealRef,
      prompt: promptRef,
      glow: glowRef,
      content: contentRef,
    };
  }

  async function open() {
    if (opened()) return;
    setOpened(true);
    if (prefersReducedMotion()) {
      const { revealInstant } = await import("./WaxSeal.motion");
      revealInstant(refs());
      return;
    }
    const { openSeal } = await import("./WaxSeal.motion");
    await openSeal(refs());
  }

  onMount(() => {
    if (prefersReducedMotion()) {
      void open();
      return;
    }
    // Auto-open after a short, savour-the-moment beat — unless the guest has
    // already opened it themselves. Cleared on cleanup so a fast unmount can't
    // fire a reveal on a disposed instance.
    const timer = window.setTimeout(() => void open(), 1400);
    onCleanup(() => window.clearTimeout(timer));
  });

  function onSealKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void open();
    }
  }

  return (
    <section
      class="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-6 py-24 text-center"
      aria-label="Cire — invitations worthy of the moment"
    >
      {/* Backdrop: a warm celebration photo, dimmed for legibility, with a gold
          radial glow that blooms when the seal breaks. */}
      <div class="absolute inset-0 -z-10">
        <img
          src={unsplash(props.heroImageId, 2000)}
          alt={props.heroImageAlt}
          class="h-full w-full object-cover opacity-40"
          fetchpriority="high"
        />
        <div
          class="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 30%, oklch(19.96% 0.0331 147.34 / 0.55), oklch(19.96% 0.0331 147.34 / 0.96))",
          }}
        />
      </div>
      <div
        ref={glowRef}
        aria-hidden="true"
        class="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 opacity-0"
        style={{
          background: "radial-gradient(circle, oklch(74.99% 0.0854 82.08 / 0.45), transparent 60%)",
        }}
      />

      {/* The sealed envelope. A button so it is reachable + operable by keyboard;
          the auto-open timer covers everyone else. */}
      <div ref={stageRef} class="relative" style={{ perspective: "1200px" }}>
        <button
          ref={sealRef}
          type="button"
          onClick={() => void open()}
          onKeyDown={onSealKey}
          class="group relative block cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none"
          aria-label="Open the invitation"
        >
          <div
            class="relative h-[15rem] w-[22rem] max-w-[82vw] rounded-md border shadow-2xl sm:h-[17rem] sm:w-[26rem]"
            style={{
              "border-color": "var(--color-border)",
              background:
                "linear-gradient(160deg, var(--color-surface-raised), var(--color-surface))",
            }}
          >
            {/* Envelope pocket seams */}
            <div
              aria-hidden="true"
              class="absolute inset-0 overflow-hidden rounded-md"
              style={{
                background:
                  "linear-gradient(115deg, transparent 49.6%, var(--color-border) 49.8%, transparent 50%), linear-gradient(65deg, transparent 49.6%, var(--color-border) 49.8%, transparent 50%)",
              }}
            />
            {/* The flap — hinged at the top, swings open on reveal. */}
            <div
              ref={flapRef}
              aria-hidden="true"
              class="absolute inset-x-0 top-0 h-[58%] origin-top"
              style={{
                "transform-style": "preserve-3d",
                "clip-path": "polygon(0 0, 100% 0, 50% 100%)",
                background:
                  "linear-gradient(180deg, var(--color-surface-raised), var(--color-surface))",
                "border-bottom": "1px solid var(--color-border)",
              }}
            />
            {/* The wax seal, embossed with the Cire monogram. */}
            <div
              aria-hidden="true"
              class="absolute top-1/2 left-1/2 flex h-[4.75rem] w-[4.75rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-lg"
              style={{
                background:
                  "radial-gradient(circle at 38% 32%, oklch(82% 0.09 82.08), oklch(63% 0.085 70) 70%, oklch(54% 0.08 65))",
                "box-shadow":
                  "inset 0 1px 3px oklch(95% 0.05 82 / 0.5), inset 0 -3px 6px oklch(40% 0.06 60 / 0.6), 0 6px 16px oklch(0% 0 0 / 0.4)",
              }}
            >
              <span
                class="font-display text-[2.25rem] leading-none italic"
                style={{ color: "oklch(30% 0.04 80)" }}
              >
                C
              </span>
            </div>
          </div>
        </button>

        <p
          ref={promptRef}
          class="font-body text-text-muted mt-7 text-[0.72rem] tracking-[0.22em] uppercase"
        >
          <Show when={!opened()} fallback={<span>&nbsp;</span>}>
            Tap to open
          </Show>
        </p>
      </div>

      {/* The unveiled letter — hidden until the seal opens (revealed by the
          motion sequence). `display:none` inline keeps it out of the initial
          paint without removing it from the DOM (so the reveal can target it). */}
      <div ref={contentRef} class="relative mx-auto max-w-[44rem]" style={{ display: "none" }}>
        <p data-stagger class="font-body text-gold mb-5 text-[0.74rem] tracking-[0.28em] uppercase">
          Bespoke digital wedding invitations
        </p>
        <h1
          data-stagger
          class="font-display text-text text-[clamp(2.6rem,8vw,5rem)] leading-[1.05] font-light italic"
        >
          Invitations worthy
          <br />
          of the moment
        </h1>
        <p
          data-stagger
          class="font-body text-text-muted mx-auto mt-6 max-w-[34rem] text-[1.02rem] leading-[1.7] font-light"
        >
          Paper is beautiful but still. Generic e-invites are soulless. Cire is a real invitation —
          tactile, animated, personal — that also happens to track every RSVP for you.
        </p>
        <div data-stagger class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={props.organiserUrl}
            class="border-gold bg-gold text-bg hover:text-gold font-body w-full rounded-sm border px-7 py-3.5 text-[0.84rem] tracking-[0.12em] uppercase transition-colors duration-200 hover:bg-transparent sm:w-auto"
          >
            Create your invitation
          </a>
          <a
            href={props.demoHref}
            target={props.demoIsExternal ? "_blank" : undefined}
            rel={props.demoIsExternal ? "noopener noreferrer" : undefined}
            class="border-border font-body text-text hover:border-gold hover:text-gold w-full rounded-sm border bg-transparent px-7 py-3.5 text-[0.84rem] tracking-[0.12em] uppercase transition-colors duration-200 sm:w-auto"
          >
            See a live invite
          </a>
        </div>
      </div>
    </section>
  );
}
