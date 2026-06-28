import { createSignal, For, onCleanup, onMount } from "solid-js";

interface PulseHeroProps {
  /** Primary CTA target — the Pulse app. */
  appUrl: string;
  /** Secondary CTA target — an in-page anchor (e.g. "#how-it-works"). */
  howHref: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// A few playful "live" event-card chips that float around the headline. Pure
// decoration — bounded, fun, on-brand. Each maps to a category colour token.
const CHIPS = [
  { tag: "MUSIC", title: "Rooftop DJ set", meta: "Tonight · 9pm", color: "var(--cat-1)" },
  { tag: "FOOD", title: "Night market", meta: "0.4 mi away", color: "var(--cat-5)" },
  { tag: "ARTS", title: "Late gallery", meta: "Fri · 7pm", color: "var(--cat-4)" },
  { tag: "SPORT", title: "Sunrise run", meta: "Sat · 6am", color: "var(--cat-6)" },
] as const;

/**
 * The hero — editorial and lively. An Instrument Serif headline with an italic
 * accent word (the DESIGN.md hero pattern), a Geist subhead, a few faux "live"
 * stats and floating colourful event chips, and two CTAs. The pulsing-dot energy
 * comes from the page-wide {@link PulseField} behind it; here we add a gentle
 * one-shot entrance. Honours reduced motion (snaps in) and is keyboard-operable.
 */
export function PulseHero(props: PulseHeroProps) {
  let rootRef!: HTMLElement;
  const [shown, setShown] = createSignal(false);

  onMount(() => {
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    // Next frame so the initial (hidden) state paints first, then the entrance.
    const raf = requestAnimationFrame(() => setShown(true));
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <section
      ref={rootRef}
      class="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-6 py-24 text-center"
      aria-label="Pulse — find your scene"
    >
      {/* Soft coral bloom behind the headline. */}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2"
        style={{
          background: "radial-gradient(circle, var(--pulse-accent-soft), transparent 62%)",
          opacity: "0.7",
        }}
      />

      {/* Floating event chips — hidden on small screens, decorative on large. */}
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 hidden lg:block">
        <For each={CHIPS}>
          {(chip, i) => (
            <div
              class="absolute rounded-xl border bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-left shadow-sm transition-all duration-700"
              style={{
                "border-color": "var(--color-border)",
                top: ["14%", "22%", "64%", "70%"][i()],
                left: ["10%", "78%", "8%", "80%"][i()],
                opacity: shown() ? "1" : "0",
                transform: shown() ? "translateY(0)" : "translateY(1.25rem)",
                "transition-delay": `${300 + i() * 140}ms`,
              }}
            >
              <p
                class="font-mono text-[0.6rem] tracking-[0.18em] uppercase"
                style={{ color: chip.color }}
              >
                {chip.tag}
              </p>
              <p class="font-body text-[0.9rem] font-semibold text-[var(--color-text)]">
                {chip.title}
              </p>
              <p class="font-mono text-[0.65rem] text-[var(--color-text-muted)]">{chip.meta}</p>
            </div>
          )}
        </For>
      </div>

      <div
        class="relative mx-auto max-w-[46rem] transition-all duration-700"
        style={{
          opacity: shown() ? "1" : "0",
          transform: shown() ? "translateY(0)" : "translateY(1.5rem)",
        }}
      >
        <p class="mb-5 inline-flex items-center gap-2 font-mono text-[0.72rem] tracking-[0.28em] text-[var(--pulse-accent-strong)] uppercase">
          <span class="dot-mark" aria-hidden="true" />
          What&rsquo;s happening near you
        </p>
        <h1 class="font-display text-[clamp(2.6rem,8vw,5rem)] leading-[1.04] font-normal text-[var(--color-text)]">
          Find what&rsquo;s <span class="text-[var(--pulse-accent)] italic">happening</span>
          <br />
          tonight.
        </h1>
        <p class="font-body mx-auto mt-6 max-w-[34rem] text-[1.05rem] leading-[1.7] text-[var(--color-text-muted)]">
          Discover events by location, category, friends and interests. RSVP in a tap, keep everyone
          in the loop, and let your calendar do the remembering.
        </p>

        {/* Faux live stats — fun, grounded in real Pulse vocabulary. */}
        <dl class="mx-auto mt-9 flex max-w-[30rem] items-stretch justify-center gap-6 sm:gap-10">
          <div>
            <dt class="font-mono text-[0.62rem] tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
              Tonight
            </dt>
            <dd class="font-display text-[1.9rem] leading-none text-[var(--pulse-accent)]">128</dd>
          </div>
          <div class="border-x border-[var(--color-border)] px-6 sm:px-10">
            <dt class="font-mono text-[0.62rem] tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
              Near you
            </dt>
            <dd class="font-display text-[1.9rem] leading-none text-[var(--cat-3)]">12</dd>
          </div>
          <div>
            <dt class="font-mono text-[0.62rem] tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
              Friends out
            </dt>
            <dd class="font-display text-[1.9rem] leading-none text-[var(--cat-2)]">7</dd>
          </div>
        </dl>

        <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={props.appUrl}
            class="font-body w-full rounded-full bg-[var(--pulse-accent)] px-7 py-3.5 text-[0.9rem] font-semibold text-[var(--color-bg)] transition-transform duration-200 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pulse-accent-strong)] sm:w-auto"
          >
            Find events
          </a>
          <a
            href={props.howHref}
            class="font-body w-full rounded-full border border-[var(--color-border)] bg-transparent px-7 py-3.5 text-[0.9rem] font-semibold text-[var(--color-text)] transition-colors duration-200 hover:border-[var(--pulse-accent)] hover:text-[var(--pulse-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pulse-accent-strong)] sm:w-auto"
          >
            How it works
          </a>
        </div>
      </div>
    </section>
  );
}
