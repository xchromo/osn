import type { RsvpDeadline } from "./types";

/**
 * Guest-side rendering of the wedding's RSVP deadline.
 *
 * The API does the deciding: it resolves the organiser's date + zone into
 * `closesAt` (one instant) and a `closed` verdict, and it re-checks on every
 * write (403 `rsvp_closed`). These helpers only present that, plus one thing
 * the server can't do — re-derive `closed` as the clock moves, since a guest
 * can sit on a claimed invite for hours and the payload was computed once.
 */

/** Has the deadline passed? `null` (no deadline) is never closed. */
export function isRsvpClosed(deadline: RsvpDeadline | null | undefined, now: Date): boolean {
  if (!deadline) return false;
  const closesAt = Date.parse(deadline.closesAt);
  // An unparseable instant falls back to the server's own verdict rather than
  // guessing — and if that is missing too, the invite stays OPEN. Locking a
  // guest out on malformed data is the worse failure; the write path still
  // refuses a genuinely late reply.
  if (Number.isNaN(closesAt)) return deadline.closed;
  return now.getTime() > closesAt;
}

/**
 * The deadline day in words — "Sunday 1 September 2026" — read in the wedding's
 * OWN zone, so a guest in another country sees the date the couple wrote, not
 * the one their own clock would roll it to.
 */
export function formatDeadlineDay(deadline: RsvpDeadline): string {
  const at = Date.parse(`${deadline.date}T12:00:00Z`);
  if (Number.isNaN(at)) return deadline.date;
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: deadline.timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(at));
  } catch {
    // An unknown zone (a payload from a newer/other API) still renders a date.
    return deadline.date;
  }
}

/**
 * The line shown under the events heading: an invitation to reply while the
 * door is open, a statement of fact once it has shut. `null` ⇒ render nothing,
 * which is what a wedding with no deadline gets.
 *
 * Takes the verdict rather than a clock so the notice, the disabled Respond
 * buttons and the read-only sheet can't disagree — the caller derives `closed`
 * once (see `createRsvpClosed`) and everything hangs off it.
 */
export function deadlineNotice(
  deadline: RsvpDeadline | null | undefined,
  closed: boolean,
): string | null {
  if (!deadline) return null;
  const day = formatDeadlineDay(deadline);
  return closed ? `RSVPs closed on ${day}.` : `Kindly respond by ${day}.`;
}
