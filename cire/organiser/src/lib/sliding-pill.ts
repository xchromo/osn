import { createEffect, type JSX, onCleanup, onMount } from "solid-js";
import { createSignal } from "solid-js";

/**
 * One indicator that moves between items, instead of one border per item.
 *
 * Every tab strip and every nav rail in the portal wants the same thing: a mark
 * on the active row that *travels* when the active row changes. Done per-item
 * (a border that turns on and off) the mark blinks between positions and the
 * label it sits beside jumps by the border's width. Done as a single absolutely
 * positioned box that is told where to be, it slides, and the labels never move
 * at all.
 *
 * The box is measured in **both axes**, not one. That is what lets the same
 * primitive drive a vertical rail and a horizontal strip — and, more usefully,
 * a horizontal strip that *wraps*: a pill that only knew about x would land on
 * the wrong line the moment the track reflowed.
 *
 * Motion is a plain CSS transition on the returned style, so the reduced-motion
 * kill switch in `global.css` disarms it for free. There is no animation library
 * in this package, by design.
 *
 * The consumer owns two rules the hook cannot enforce: the track must be a
 * containing block (`relative`), and the pill must be `absolute` with `inset-0`
 * unset — it takes its whole geometry from `style()`.
 */

/** The subset of DOMRect the geometry needs. Named so the maths can be tested. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the pill should be, in the track's own coordinates. */
export interface PillBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The pill's position relative to the track's padding box.
 *
 * Rect maths rather than `offsetLeft` so the item may sit at any depth under the
 * track without the caller having to guarantee it is the offset parent, and so a
 * scrolled track (an overflowing tab strip) stays correct.
 *
 * Returns `null` for a zero-area item, which is how a surface hidden by
 * `display: none` reports itself — the rail and the sheet render the same nav
 * twice, and the hidden copy must not claim a position.
 */
export function pillBox(
  track: RectLike,
  item: RectLike,
  scroll: { left: number; top: number } = { left: 0, top: 0 },
): PillBox | null {
  if (item.width <= 0 && item.height <= 0) return null;
  return {
    x: item.left - track.left + scroll.left,
    y: item.top - track.top + scroll.top,
    width: item.width,
    height: item.height,
  };
}

/** Whether two boxes describe the same place. */
export function samePlace(a: PillBox, b: PillBox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

const MOVE = "var(--dur-base) var(--ease-out)";

/**
 * The pill's inline style.
 *
 * `settled` is false for the first frame at a new position and on the frame the
 * pill first appears, so it arrives where it belongs instead of sliding in from
 * the track's corner. Transform rather than `left`/`top` so the move is composited.
 */
export function pillStyle(box: PillBox | null, settled: boolean): JSX.CSSProperties {
  if (!box) return { opacity: 0, transition: "none" };
  return {
    opacity: 1,
    transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    transition: settled ? `transform ${MOVE}, width ${MOVE}, height ${MOVE}` : "none",
  };
}

export interface SlidingPill {
  /** `ref` for the track. Must be the pill's containing block. */
  track: (el: HTMLElement) => void;
  /** `ref` factory for each item, keyed by the same value `active` returns. */
  item: (key: string) => (el: HTMLElement) => void;
  /** `style` for the pill element. */
  style: () => JSX.CSSProperties;
}

/**
 * @param active the key of the item the pill should sit on.
 */
export function createSlidingPill(active: () => string): SlidingPill {
  const items = new Map<string, HTMLElement>();
  const [box, setBox] = createSignal<PillBox | null>(null);
  const [settled, setSettled] = createSignal(false);

  let trackEl: HTMLElement | undefined;
  let observer: ResizeObserver | undefined;
  let mounted = false;
  // The previous box is kept out here rather than read back off the signal:
  // `measure` runs inside an effect, and reading what it is about to write
  // would make the effect depend on its own output.
  let last: PillBox | null = null;

  function measure() {
    const el = items.get(active());
    if (!trackEl || !el?.isConnected) {
      last = null;
      setBox(null);
      setSettled(false);
      return;
    }
    const next = pillBox(trackEl.getBoundingClientRect(), el.getBoundingClientRect(), {
      left: trackEl.scrollLeft,
      top: trackEl.scrollTop,
    });
    // A ResizeObserver reports on every reflow, most of which move nothing.
    // Bail on an unchanged box so the style is not rewritten for no reason.
    if (next && last && samePlace(last, next)) return;
    // Appearing is not a move. Place it, then arm the transition on the next
    // frame so only *subsequent* changes of active row animate.
    const appearing = next !== null && last === null;
    last = next;
    setBox(next);
    if (next === null) setSettled(false);
    else if (appearing) {
      setSettled(false);
      requestAnimationFrame(() => setSettled(true));
    }
  }

  function watch(el: HTMLElement) {
    // One observer over the track and every item. The track catches reflow and
    // wrapping; the items catch a label that changes width on its own — a
    // webfont swapping in under a preloaded fallback is the common case, and it
    // lands after the first measure.
    observer ??= new ResizeObserver(() => measure());
    observer.observe(el);
  }

  onMount(() => {
    mounted = true;
    measure();
    onCleanup(() => observer?.disconnect());
  });

  createEffect(() => {
    active();
    if (mounted) measure();
  });

  return {
    track: (el) => {
      trackEl = el;
      watch(el);
      if (mounted) measure();
    },
    item: (key) => (el) => {
      items.set(key, el);
      watch(el);
      onCleanup(() => {
        if (items.get(key) === el) items.delete(key);
      });
      if (mounted) measure();
    },
    style: () => pillStyle(box(), settled()),
  };
}
