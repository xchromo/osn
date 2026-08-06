/**
 * A thin bar: how much of a budget is spent, how many guests have replied, how
 * much of a checklist is done.
 *
 * Not `<progress>`. That element takes its bar and its track from the platform
 * and resists both to a different degree in every engine, and the one thing this
 * has to do is be the portal's gold on the portal's surface.
 *
 * `over` is the case the Budget module needs: a value past its maximum is still
 * drawn full, but in the error tone, so "spent everything" and "spent more than
 * everything" are not the same picture.
 */

/** Where the fill ends, as a percentage. Clamped, and safe for a zero maximum. */
export function meterPct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export default function Meter(props: {
  value: number;
  max: number;
  tone?: "gold" | "over";
  /** What the bar is measuring. Read instead of the bare number. */
  label: string;
}) {
  const pct = () => meterPct(props.value, props.max);
  return (
    <div
      class="bg-surface/60 h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={Math.round(pct())}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={props.label}
    >
      <div
        class={`h-full rounded-full transition-[width] duration-(--dur-slow) ease-(--ease-out) ${
          props.tone === "over" ? "bg-error/80" : "bg-gold"
        }`}
        style={{ width: `${pct()}%` }}
      />
    </div>
  );
}
