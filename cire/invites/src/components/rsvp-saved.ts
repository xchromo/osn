/**
 * Timing contract for the RSVP sheet's confirmed state.
 *
 * ## Why a guest needs this at all
 *
 * A successful RSVP used to be invisible. `handleSubmit` called `onSubmitted`
 * and `onClose` back to back, so the sheet vanished the instant the POST
 * returned and the only evidence anything had happened was a sheet that was
 * no longer there — indistinguishable, to a guest, from a mis-tap that
 * dismissed it. The reply had been recorded and nothing said so.
 *
 * ## Where the confirmation itself lives now
 *
 * The Save button used to carry the confirmation — a gold sweep and a drawn
 * tick — but that button is gone the moment the sheet closes over it, which
 * is exactly when a guest would otherwise have time to register it. The
 * animated confirmation moved to the events section's Respond button, which
 * stays on screen after the sheet closes; see `rsvp-responded.ts` for that
 * choreography. What is left here is just the dwell: the Save button swaps
 * its label to "Saved", locks the sheet's controls, and holds briefly before
 * closing itself — long enough that the sheet still doesn't just vanish.
 *
 * ## Why the dwell is a BUDGET, not a fixed hold
 *
 * The dwell used to be a flat 900ms started when the server's 200 landed, so
 * what a guest actually waited through was `round-trip + 900ms`. Those two add
 * up: the POST is five sequential D1 round-trips behind a Worker, so a real
 * save routinely spent half a second on "Saving…" and then another nine tenths
 * of a second on a sheet that had already finished its job. Reported as "quite
 * a delay for the form to close after you click save", and it was.
 *
 * The fix is to stop treating the network wait as free. `savedDwellMs` spends a
 * total time-on-screen budget measured from the CLICK, so a slow reply eats
 * into the dwell rather than stacking on top of it, and the sheet closes at
 * roughly `SAVED_DWELL_MS` after the click however long the server took.
 *
 * The floor is what keeps that from collapsing into the original bug. A guest
 * whose reply took longer than the whole budget must still SEE the confirmed
 * state — "Saving…" is not a confirmation, and only the dwell shows "Saved" —
 * so the hold never drops below `SAVED_DWELL_MIN_MS` no matter how slow the
 * round-trip was. Below that floor the label swap reads as a flicker and the
 * sheet is back to vanishing.
 *
 * Nothing downstream is timed against these numbers: the Respond-button
 * celebration is measured from the moment the sheet uncovers that button (see
 * `rsvp-responded.ts`), and the toast is already up and stays up past the
 * close. So shortening the dwell shortens the wait and nothing else.
 */

/**
 * The confirmed state's total time-on-screen budget, measured from the moment
 * the guest clicks Save — not from the moment the server answers. Whatever the
 * request spent is deducted from it (see {@link savedDwellMs}), so this is also
 * the LONGEST the sheet can hold: an instant reply dwells for the full budget,
 * and any slower reply dwells for less.
 *
 * Tests advance fake timers by this constant to land the close, which stays
 * correct precisely because it is the maximum.
 */
export const SAVED_DWELL_MS = 600;

/**
 * The floor under {@link savedDwellMs} — the shortest the confirmed state is
 * ever held, applied when the request alone outran the budget above. Long
 * enough for the "Saved" label swap and the sheet's `role="status"` line to
 * register as a state rather than a flicker.
 */
export const SAVED_DWELL_MIN_MS = 300;

/**
 * How long to hold the confirmed state, given how long the submit itself took.
 *
 * `requestMs` is wall-clock from the guest's click to the reply landing — 0 for
 * the host preview, which never leaves the browser.
 */
export function savedDwellMs(requestMs: number): number {
  // NaN loses every comparison, so `Math.max` would pass it straight through to
  // `setTimeout` — where a NaN delay fires IMMEDIATELY, i.e. the sheet vanishes
  // with no confirmation at all. Guard it explicitly.
  if (!Number.isFinite(requestMs)) return SAVED_DWELL_MIN_MS;
  // Clamp at zero as well: `Date.now()` is wall-clock and can step backwards
  // (an NTP correction mid-request), and a negative measurement would otherwise
  // ADD to the dwell — the exact failure mode this budget exists to remove, and
  // it would break the invariant every other test leans on, that the budget is
  // the maximum.
  const spent = Math.max(0, requestMs);
  return Math.max(SAVED_DWELL_MIN_MS, SAVED_DWELL_MS - spent);
}
