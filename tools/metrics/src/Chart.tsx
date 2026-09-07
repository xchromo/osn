import * as Plot from "@observablehq/plot";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";

interface ChartProps {
  /** Called with the container's width every time the chart is (re)drawn. */
  options: (width: number) => Plot.PlotOptions;
}

/**
 * Plot renders to a detached SVG, so this is a `ref` + `createEffect` wrapper:
 * the effect draws into the container and the cleanup removes the previous
 * node, so a redraw never stacks two figures. Width is read from the
 * container and tracked with a `ResizeObserver`, which is what makes a redraw
 * happen at all — the data behind every chart is static.
 */
export function Chart(props: ChartProps) {
  const [width, setWidth] = createSignal(0);
  let host!: HTMLDivElement;

  onMount(() => {
    setWidth(host.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const w = width();
    if (w === 0) return;
    const node = Plot.plot({ width: w, ...props.options(w) });
    host.replaceChildren(node);
    onCleanup(() => node.remove());
  });

  return <div ref={host} class="w-full" />;
}
