import { type ComponentProps, splitProps } from "solid-js";

/**
 * The portal's five tables — guests, events, RSVPs, an import diff, a change
 * history — as one set of parts.
 *
 * ## The wrapper scrolls, the page does not
 *
 * A guest table with an email column is wider than a phone, and a table that
 * cannot be reached sideways is a table with a hidden column. The scroll lives
 * on the wrapper, so the body never scrolls sideways with it — which is the one
 * thing that makes a page feel broken rather than dense.
 *
 * `border-separate` with a zero spacing, rather than `border-collapse`: a
 * collapsed table hands its border to the cells, and the outer radius on the
 * wrapper then gets a square corner poking through it.
 */

export function Table(props: { class?: string; children: ComponentProps<"table">["children"] }) {
  return (
    <div
      class={`border-border overflow-x-auto rounded-sm border${props.class ? ` ${props.class}` : ""}`}
    >
      <table class="w-full border-separate border-spacing-0 text-left">{props.children}</table>
    </div>
  );
}

export type ThProps = ComponentProps<"th">;

/**
 * A column head. `scope="col"` by default — without it a screen reader has to
 * guess which cells a header governs, and in a wide table it guesses wrong.
 */
export function Th(props: ThProps) {
  const [own, rest] = splitProps(props, ["class"]);
  return (
    <th
      scope="col"
      {...rest}
      class={`font-body border-border text-gold border-b px-4 py-3 text-left text-[0.72rem] font-normal tracking-[0.1em] whitespace-nowrap uppercase${
        own.class ? ` ${own.class}` : ""
      }`}
    />
  );
}

export type TdProps = ComponentProps<"td"> & {
  /** Figures: right-aligned, tabular, so the digits line up down the column. */
  numeric?: boolean;
};

export function Td(props: TdProps) {
  const [own, rest] = splitProps(props, ["numeric", "class"]);
  return (
    <td
      {...rest}
      class={`border-border/40 text-text border-b px-4 py-3 text-[0.86rem] ${
        own.numeric ? "text-right font-mono tabular-nums" : ""
      }${own.class ? ` ${own.class}` : ""}`}
    />
  );
}
