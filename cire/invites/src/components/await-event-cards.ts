/**
 * Hold the unlock choreography until the event cards are actually in the DOM.
 *
 * The post-claim components — `EventCard` among them — are `lazy` (P-W1), so
 * they live in their own chunk. `InvitePage` warms that chunk at idle, but a
 * guest opening their invite for the first time on a phone can easily claim
 * before an idle callback has run, and then the chunk is still in flight when
 * the claim resolves. Solid renders `<Suspense fallback={null}>` — no cards —
 * and the reveal sequence animates an EMPTY section, finds nothing to stagger,
 * and finishes; the cards slam into the layout at full opacity whenever the
 * chunk lands. That is the "the events just appear, nothing animates" bug.
 *
 * Both waits are CAPPED. A reveal that waits forever on a chunk that never
 * arrives (offline mid-session, a stale deploy) is the invisible-invite failure
 * every other guard in this flow exists to prevent, so the caller reveals
 * anyway once the caps expire.
 */

/** Longest we wait on the post-claim chunk before revealing without its cards. */
export const CARD_CHUNK_TIMEOUT_MS = 1500;

/** Longest we then wait for SolidJS to paint the resolved cards into the DOM. */
export const CARD_RENDER_TIMEOUT_MS = 300;

/** How often we look for a rendered card while inside that render budget. */
const POLL_INTERVAL_MS = 16;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function awaitEventCards(
  /** The lazy component's loader — `EventCard.preload` in both design packs. */
  preload: () => Promise<void>,
  /** The events section, read lazily: it only exists once the claim renders. */
  getSection: () => HTMLElement | undefined,
): Promise<void> {
  // A rejected chunk is not an error here — the caller reveals without the
  // stagger, exactly as it does when the sequence itself fails to load.
  await Promise.race([preload().catch(() => {}), sleep(CARD_CHUNK_TIMEOUT_MS)]);

  // Resolving the chunk is not the same as having painted with it: Suspense
  // still has to re-render. Poll rather than guess a tick count, so a slow
  // device gets the frames it needs and a fast one loses nothing.
  for (let waited = 0; waited < CARD_RENDER_TIMEOUT_MS; waited += POLL_INTERVAL_MS) {
    if (getSection()?.querySelector("[data-event-card]")) return;
    // Sequential on purpose: this is a poll, so each wait has to follow the
    // check before it.
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_INTERVAL_MS);
  }
}
