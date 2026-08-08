import { cleanup, render } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../styles/global.css";
import { EventCard } from "./EventCard";
import { hasHouseholdResponded, SWEEP_DURATION_MS, TOTAL_DURATION_MS } from "./rsvp-responded";
import { SAVED_DWELL_MS } from "./rsvp-saved";
import { RsvpModal } from "./RsvpModal";
import type { EventSummary, FamilyMember, RsvpSummary } from "./types";

/**
 * The `RsvpModal` → `EventCard` seam, driven end to end on REAL timers with the
 * REAL stylesheet, and measured rather than class-checked.
 *
 * `rsvp-confirmation.integration.test.tsx` owns the same seam in happy-dom, on
 * fake timers, asserting which classes are present at each beat. That is the
 * right tool for the ordering contract ("the fill must not turn on while the
 * sheet is still over the button") and the wrong one for the property a guest
 * actually reports: what the button is painted, seconds after the save.
 *
 * The difference matters here specifically because the real flow is nothing
 * like driving `justResponded` by hand (which is all `EventCard.browser.test.tsx`
 * does). On the real path the reply is recorded, the sheet dwells over the
 * button for `SAVED_DWELL_MS` with `responded` already true, and only THEN does
 * the celebration cue fire as the sheet unmounts — three state changes across
 * two components and two timers, with a CSS transition hanging off the last one.
 *
 * The card also renders inside the events section's themed wrapper here, with a
 * leftover inline `transform` of the kind `UnlockReveal.motion` leaves behind on
 * every `[data-event-card]`. A transformed ancestor creates a containing block
 * and a stacking context, so it is not inert scenery — it is the environment the
 * confirmation actually paints in.
 */

const event: EventSummary = {
  id: "event-1",
  name: "Mehndi",
  description: "Henna evening",
  startAt: "2026-09-18T16:00:00+10:00",
  endAt: "2026-09-18T22:00:00+10:00",
  timezone: "Australia/Sydney",
  address: "12 Banksia Lane",
  dressCodeDescription: null,
  dressCodePalette: null,
  pinterestUrl: null,
  mapsUrl: null,
  sortOrder: 0,
};

const priya: FamilyMember = {
  guestId: "guest-priya",
  firstName: "Priya",
  lastName: "Sharma",
  eventIds: ["event-1"],
};

const raj: FamilyMember = {
  guestId: "guest-raj",
  firstName: "Raj",
  lastName: "Sharma",
  eventIds: ["event-1"],
};

const row = (guestId: string): RsvpSummary => ({
  guestId,
  eventId: "event-1",
  status: "attending",
  dietary: "",
});

/**
 * `InvitePage`'s wiring around the two real components, inside the events
 * section's themed + transformed wrapper. Kept out of `InvitePage` itself
 * because both design packs `vi.mock` `RsvpModal` at module level.
 */
function Harness(props: { members?: FamilyMember[] }) {
  const members = props.members ?? [priya];
  const [open, setOpen] = createSignal(false);
  const [justResponded, setJustResponded] = createSignal(false);
  const [rsvps, setRsvps] = createSignal<RsvpSummary[]>([]);

  return (
    <section style={{ "background-color": "var(--invite-section-bg, transparent)" }}>
      {/* The inline transform Motion One leaves on each card wrapper. */}
      <div data-event-card style={{ transform: "translateY(0px)", opacity: "1" }}>
        <EventCard
          event={event}
          responded={hasHouseholdResponded(event, members, rsvps())}
          justResponded={justResponded()}
          // Mirrors `InvitePage`: while the sheet is open it covers this button,
          // so the card must not put its mark up yet. Without this the reply is
          // recorded (`responded` true) `SAVED_DWELL_MS` before the sheet closes
          // and the fill sweeps in behind it, unseen.
          covered={open()}
          onCelebrated={() => setJustResponded(false)}
          onRespond={() => setOpen(true)}
          onDetails={() => {}}
        />
      </div>
      <Show when={open()}>
        <RsvpModal
          event={event}
          members={members}
          existingRsvps={rsvps()}
          apiUrl="https://api.test"
          onClose={() => setOpen(false)}
          onSubmitted={(updated: RsvpSummary[]) => setRsvps(updated)}
          onConfirmed={() => setJustResponded(true)}
        />
      </Show>
    </section>
  );
}

function respondButton(): HTMLButtonElement {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Respond",
  ) as HTMLButtonElement;
}

function fill(): HTMLElement {
  return respondButton().querySelector("span[aria-hidden='true']") as HTMLElement;
}

function scaleX(el: HTMLElement): number {
  const raw = getComputedStyle(el).scale;
  if (raw === "none") return 1;
  return Number.parseFloat(raw.split(" ")[0]!);
}

function sheet(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function fieldsetFor(name: string): HTMLElement {
  for (const l of document.querySelectorAll("legend")) {
    if ((l.textContent ?? "").includes(name)) return l.closest("fieldset") as HTMLElement;
  }
  throw new Error(`fieldset for ${name} not found`);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Long enough for the sheet's dwell AND the sweep that starts when it leaves —
 * `SAVED_DWELL_MS` + `SWEEP_DURATION_MS` with room to spare. On real timers a
 * tighter wait catches the sweep mid-travel (~0.97) and reads as a failure.
 */
const SETTLED_MS = SAVED_DWELL_MS + SWEEP_DURATION_MS + 300;

/** Click "Attending" for one member, by name. */
function answer(name: string) {
  const buttons = [...fieldsetFor(name).querySelectorAll("button")];
  (buttons.find((b) => b.textContent === "Attending") as HTMLButtonElement).click();
}

function save() {
  (document.querySelector("button[type='submit']") as HTMLButtonElement).click();
}

function okFetchReturning(...rows: RsvpSummary[]) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ rsvps: rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("RSVP confirmation, end to end and painted", () => {
  // No fake timers here, so a leaked card from a previous test would still be
  // mounted (and still filled) when the next one queries for "Respond".
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("leaves the fill painted for the long haul after a complete save", async () => {
    vi.stubGlobal("fetch", okFetchReturning(row("guest-priya")));
    render(() => <Harness />);

    respondButton().click();
    await wait(0);
    answer("Priya");
    save();

    // The sheet dwells over the button with the reply already recorded. Nothing
    // may be animating underneath it yet.
    await wait(100);
    expect(sheet()).toBeTruthy();
    expect(scaleX(fill())).toBe(0);

    // Sheet gone, sweep played.
    await wait(SETTLED_MS);
    expect(sheet()).toBeNull();
    expect(scaleX(fill())).toBe(1);

    // Five seconds later — the beat the guest complaint is actually about.
    await wait(TOTAL_DURATION_MS + 5000);
    expect(scaleX(fill())).toBe(1);
    expect(respondButton().querySelector("svg")).not.toBeNull();
  });

  it("keeps the button plain after a partial save, then fills once the party is complete", async () => {
    // First save answers only Priya; the second adds Raj and completes the
    // party. The API returns the whole family's rows each time, as the real one
    // does.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ rsvps: [row("guest-priya")] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ rsvps: [row("guest-priya"), row("guest-raj")] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );
    render(() => <Harness members={[priya, raj]} />);

    respondButton().click();
    await wait(0);
    answer("Priya");
    save();
    await wait(SETTLED_MS);

    // A partial save is saved — but the button says nothing, because the
    // household has not finished answering for this event.
    expect(sheet()).toBeNull();
    expect(scaleX(fill())).toBe(0);
    expect(respondButton().querySelector("svg")).toBeNull();

    // Reopen, answer Raj (Priya stays prefilled), save again.
    respondButton().click();
    await wait(0);
    answer("Raj");
    save();
    await wait(SETTLED_MS);

    expect(scaleX(fill())).toBe(1);
    await wait(TOTAL_DURATION_MS + 3000);
    expect(scaleX(fill())).toBe(1);
    expect(respondButton().querySelector("svg")).not.toBeNull();
  });
});
