import { type ComponentProps, splitProps } from "solid-js";

/**
 * A block that says something went wrong, or right, or is about to.
 *
 * The error tone alone was written out longhand thirteen times, which is how it
 * ended up with three different paddings. Four tones, all built the same way: a
 * faint tinted ground, a border of the same hue, and the text in it.
 *
 * ## `alert`
 *
 * Off by default. The role is a live region: assistive tech interrupts to read
 * it, which is right for a save that just failed and wrong for a standing note
 * that was on screen before the host arrived. Set it where the notice *appears*
 * in response to something the host did.
 */

export type NoticeTone = "error" | "warn" | "success" | "info";

const BASE = "font-body rounded-sm border p-4 text-[0.88rem] leading-relaxed";

const TONE: Readonly<Record<NoticeTone, string>> = {
  error: "border-error/20 bg-error/5 text-error",
  warn: "border-warn/20 bg-warn/5 text-warn",
  success: "border-success/20 bg-success/5 text-success",
  info: "border-border bg-surface/30 text-text-muted",
};

export type NoticeProps = ComponentProps<"div"> & {
  tone?: NoticeTone;
  /** Announce it the moment it appears. See the note above. */
  alert?: boolean;
};

export default function Notice(props: NoticeProps) {
  const [own, rest] = splitProps(props, ["tone", "alert", "class"]);
  return (
    <div
      role={own.alert ? "alert" : undefined}
      {...rest}
      class={`${BASE} ${TONE[own.tone ?? "info"]}${own.class ? ` ${own.class}` : ""}`}
    />
  );
}
