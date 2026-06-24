import { createSignal, For, onCleanup, onMount } from "solid-js";

import { generateField, type VineField } from "../lib/vines/generate";
import { randomSeed } from "../lib/vines/prng";

// Generative botanical backdrop. Vines emerge from the left/right page edges,
// meander down and inward, curl into tendrils and carry leaves + flowers — and
// "grow" (draw on) as you scroll past them.
//
// SSR / no-JS: a deterministic field at a default size renders fully-drawn and
// static (this is the "roots + start points, server-rendered" baseline). On
// mount the client measures the real document, regenerates with a FRESH per-load
// seed (so every visit is unique), and drives each vine's growth from scroll via
// a single CSS custom property `--p` (0→1) — cheap, one write per in-view vine
// per frame. Reduced motion shows the vines fully drawn, no growth.

// SSR baseline size — replaced by the real measured size on mount.
const SSR_W = 1280;
const SSR_H = 4200;
// Fraction down the viewport that the "growth front" follows.
const TRIGGER = 0.82;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function VineCanvas() {
  const [field, setField] = createSignal<VineField>(
    generateField("cire-ssr-baseline", SSR_W, SSR_H),
  );
  const [animated, setAnimated] = createSignal(false);
  let layerRef!: HTMLDivElement;

  onMount(() => {
    const measure = () => ({
      w: document.documentElement.clientWidth,
      h: Math.max(document.documentElement.scrollHeight, window.innerHeight),
    });

    // Regenerate at the real document size with a fresh seed (unique per load).
    const regen = () => {
      const { w, h } = measure();
      setField(generateField(randomSeed(), w, h));
    };
    regen();
    setAnimated(true);

    if (prefersReducedMotion()) return; // CSS leaves the field fully drawn

    let ticking = false;
    const update = () => {
      ticking = false;
      const vh = window.innerHeight;
      const sY = window.scrollY;
      const groups = layerRef.querySelectorAll<SVGGElement>("[data-vine]");
      for (const g of groups) {
        const top = Number(g.dataset.top);
        const bottom = Number(g.dataset.bottom);
        const span = Math.max(1, bottom - top);
        const p = Math.min(1, Math.max(0, (sY + vh * TRIGGER - top) / span));
        g.style.setProperty("--p", p.toFixed(3));
      }
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    let resizeTimer: number | undefined;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        regen();
        requestAnimationFrame(update);
      }, 200);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    onCleanup(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
    });

    // First paint at the correct scroll position (avoids a grow-from-zero flash).
    requestAnimationFrame(update);
  });

  return (
    <div
      ref={layerRef}
      class="vine-layer"
      classList={{ "is-animated": animated() }}
      aria-hidden="true"
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${field().width} ${field().height}`}
        preserveAspectRatio="none"
      >
        <For each={field().vines}>
          {(vine) => (
            <g
              data-vine
              data-top={vine.top}
              data-bottom={vine.bottom}
              style={{ "--p": animated() ? "0" : "1" }}
            >
              <For each={vine.strands}>
                {(d) => <path class="vine-stroke" d={d} pathLength="1" />}
              </For>
              <g class="vine-organs">
                <For each={vine.leaves}>{(leaf) => <path class="vine-leaf" d={leaf.d} />}</For>
                <For each={vine.flowers}>
                  {(flower) => (
                    <>
                      <For each={flower.petals}>{(d) => <path class="vine-petal" d={d} />}</For>
                      <circle class="vine-heart" cx={flower.cx} cy={flower.cy} r={flower.cr} />
                    </>
                  )}
                </For>
              </g>
            </g>
          )}
        </For>
      </svg>
    </div>
  );
}
