import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../styles/global.css";
import { noteClaimed } from "../../components/claim-session";
import { SWEEP_DURATION_MS, TOTAL_DURATION_MS } from "../../components/rsvp-responded";
import { SAVED_DWELL_MS } from "../../components/rsvp-saved";
import type { ClaimResult } from "../../components/types";
import { Z_LAYER } from "../../lib/z-index";
import { noSession, withSession } from "../../test-support/claim-fetch";
import InvitePage from "./InvitePage";

/**
 * The whole invite page, in a real browser, with a real RSVP save measured on
 * the Respond button afterwards.
 *
 * `InvitePage.test.tsx` mocks `RsvpModal`, `motion`, `UnlockReveal.motion`,
 * `solid-toast` and `PulseAccountLink` — necessarily, to assert the page's
 * wiring in isolation. That leaves nothing anywhere in the suite that exercises
 * the confirmation inside the page it actually ships in: the themed events
 * `<section>`, the Motion-One-animated `[data-event-card]` wrappers each with a
 * leftover inline `transform`, and the modal overlay that unmounts on top of it
 * all.
 *
 * Only `PulseAccountLink` and the OSN `AuthProvider` are stubbed here — they
 * reach the account API and have their own tests. Everything the confirmation
 * and the toast touch is the real thing.
 */

vi.mock("../../components/PulseAccountLink", () => ({
  PulseAccountLink: () => <div data-testid="pulse-account-link-stub" />,
}));

vi.mock("@shared/rp-auth/solid", () => ({
  AuthProvider: (props: { children: unknown }) => props.children,
}));

/** Two members on one event, so a partial save is possible. */
const claim: ClaimResult = {
  publicId: "SHARMA-JOY-RK97",
  familyName: "Sharma",
  members: [
    { guestId: "guest-priya", firstName: "Priya", lastName: "Sharma", eventIds: ["event-1"] },
    { guestId: "guest-raj", firstName: "Raj", lastName: "Sharma", eventIds: ["event-1"] },
  ],
  events: [
    {
      id: "event-1",
      name: "Mehndi",
      description: "Henna evening",
      startAt: "2026-09-18T16:00:00+10:00",
      endAt: "2026-09-18T22:00:00+10:00",
      timezone: "Australia/Sydney",
      address: "Sharma Residence",
      dressCodeDescription: null,
      dressCodePalette: null,
      pinterestUrl: null,
      mapsUrl: null,
      sortOrder: 0,
      imageUrl: null,
    },
  ],
  rsvps: [],
};

const row = (guestId: string) => ({
  guestId,
  eventId: "event-1",
  status: "attending" as const,
  dietary: "",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function respondButton(): HTMLButtonElement {
  const card = [...document.querySelectorAll("[data-event-card]")].find((el) =>
    el.textContent?.includes("Mehndi"),
  ) as HTMLElement;
  return [...card.querySelectorAll("button")].find(
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

function fieldsetFor(name: string): HTMLElement {
  for (const l of document.querySelectorAll("legend")) {
    if ((l.textContent ?? "").includes(name)) return l.closest("fieldset") as HTMLElement;
  }
  throw new Error(`fieldset for ${name} not found`);
}

function answer(name: string) {
  const buttons = [...fieldsetFor(name).querySelectorAll("button")];
  (buttons.find((b) => b.textContent === "Attending") as HTMLButtonElement).click();
}

/**
 * The sheet's Save button, scoped to the dialog. NOT `document.querySelector(
 * "button[type=submit]")` — the login form stays in the layout after the invite
 * opens (only `display: none`), and its "Open Invitation" submit comes first in
 * the DOM, so an unscoped query silently clicks that instead and the RSVP is
 * never sent.
 */
function save() {
  (document.querySelector('[role="dialog"] button[type="submit"]') as HTMLButtonElement).click();
}

/**
 * The toast element carrying a given message, plus the `position: fixed`
 * container `solid-toast` mounts it in.
 */
function toastFor(message: string) {
  const el = [...document.querySelectorAll("div")].find((d) => d.textContent === message);
  if (!el) return null;
  let container: HTMLElement | null = el;
  while (container && getComputedStyle(container).position !== "fixed") {
    container = container.parentElement;
  }
  return { el, container };
}

/**
 * The nearest ancestor that would become the containing block for a
 * `position: fixed` descendant — a `transform`, `filter`, `perspective`,
 * `contain` or `will-change` on any ancestor does it, and it makes that
 * ancestor a stacking context too. This is the exact mechanism that broke the
 * toast: `<Toaster>` used to live inside the events section, which Motion One
 * leaves with an inline `transform`, so the toast was positioned against the
 * section and stacked inside it — below the page-level `z-100` modal, whatever
 * `z-index` the toast itself carried.
 *
 * Not asserted with `elementFromPoint`: the toast container is deliberately
 * `pointer-events: none`, so hit-testing sees straight through it to whatever
 * is behind and would report a "covered" toast that is painted perfectly well.
 */
function fixedContainingBlockAncestor(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (
      cs.transform !== "none" ||
      cs.filter !== "none" ||
      cs.perspective !== "none" ||
      cs.willChange.includes("transform") ||
      cs.contain.includes("paint") ||
      cs.contain.includes("layout")
    ) {
      return p;
    }
  }
  return null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SETTLED_MS = SAVED_DWELL_MS + SWEEP_DURATION_MS + 300;

/**
 * A returning guest: the session restores, so the invite opens with no unlock
 * choreography to wait through. Two preconditions `createSessionRestore`
 * enforces and it is easy to miss — the `cire_claimed` cookie hint
 * (`noteClaimed()`), and a `slug`, without which it skips the request entirely.
 */
function openRestored(rsvpResponses: Response[]) {
  noteClaimed();
  let call = 0;
  const inner = ((input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    // The theme revalidation. An empty body keeps the build-time theme.
    if (url.includes("/api/invite/")) return Promise.resolve(json({}));
    if (url.includes("/api/rsvp")) {
      return Promise.resolve(rsvpResponses[call++] ?? json({ rsvps: [] }));
    }
    return Promise.resolve(json({}, 404));
  }) as typeof fetch;
  vi.stubGlobal("fetch", withSession(claim, inner));
  return render(() => <InvitePage apiUrl="https://api.test" slug="cire-wedding" />);
}

/**
 * A FIRST-time guest, typing their code. Unlike {@link openRestored} this runs
 * the real `unlockRevealSequence`, which is the difference that matters: Motion
 * One animates the events `<section>` and every `[data-event-card]` and leaves
 * the final inline `transform` behind. A transformed ancestor becomes the
 * containing block for `position: fixed` descendants and creates a stacking
 * context — so anything fixed that lives inside that section (the `<Toaster>`
 * does) stops being positioned against the viewport.
 */
async function openByCode(rsvpResponses: Response[]) {
  let call = 0;
  const inner = ((input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/invite/")) return Promise.resolve(json({}));
    if (url.includes("/api/rsvp")) {
      return Promise.resolve(rsvpResponses[call++] ?? json({ rsvps: [] }));
    }
    if (url.includes("/api/claim")) return Promise.resolve(json(claim));
    return Promise.resolve(json({}, 404));
  }) as typeof fetch;
  // No `cire_claimed` hint and no session: the code form is the way in.
  vi.stubGlobal("fetch", noSession(inner));
  const view = render(() => <InvitePage apiUrl="https://api.test" slug="cire-wedding" />);

  const input = view.getByPlaceholderText(/PATEL-JOY/) as HTMLInputElement;
  fireEvent.input(input, { target: { value: "SHARMA-JOY-RK97" } });
  (
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Open Invitation",
    ) as HTMLButtonElement
  ).click();

  // The reveal choreography is ~1.2s of staggered animation before the cards
  // are settled and clickable.
  await waitFor(() => expect(respondButton()).toBeTruthy(), { timeout: 5000 });
  await wait(1500);
  return view;
}

describe("InvitePage — the RSVP confirmation in the page it ships in", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the Respond fill painted after a complete save", async () => {
    openRestored([json({ rsvps: [row("guest-priya"), row("guest-raj")] })]);
    await waitFor(() => expect(respondButton()).toBeTruthy(), { timeout: 3000 });

    expect(scaleX(fill())).toBe(0);

    respondButton().click();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    answer("Priya");
    answer("Raj");
    save();

    await wait(SETTLED_MS);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(scaleX(fill())).toBe(1);

    // The complaint, stated as an assertion: still filled seconds later.
    // +2000 is well past the 1400ms choreography; these are real sleeps, so the
    // margin is sized to the assertion rather than to rhetoric.
    await wait(TOTAL_DURATION_MS + 2000);
    expect(scaleX(fill())).toBe(1);
    expect(respondButton().querySelector("svg")).not.toBeNull();
  });

  it("shows the save toast where a guest can actually see it", async () => {
    openRestored([json({ rsvps: [row("guest-priya")] })]);
    await waitFor(() => expect(respondButton()).toBeTruthy(), { timeout: 3000 });

    respondButton().click();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    answer("Priya");
    save();

    // The toast fires the moment the save lands, while the sheet is still up for
    // its dwell — so it has to survive both the sheet's stacking context and its
    // backdrop.
    await wait(150);
    const toast = toastFor("Your RSVP for Mehndi has been recorded.");
    expect(toast, "no toast element in the DOM at all").toBeTruthy();
    const { el, container } = toast!;

    // The mechanism, first: nothing between the toast and <body> may establish a
    // containing block, or it is positioned against that ancestor and stacked
    // inside it — below the sheet, whatever z-index it carries.
    expect(
      fixedContainingBlockAncestor(container!),
      "the toast is trapped inside a transformed ancestor's stacking context",
    ).toBeNull();
    // Two-sided on purpose. `> MODAL` alone is satisfied by solid-toast's own
    // hardcoded inline `z-index: 9999`, which is what the layer prop has to
    // override — so a one-sided assertion passes while the toast sits ABOVE the
    // consent banner and dialog, the one thing that must never be buried.
    const painted = Number.parseInt(getComputedStyle(container!).zIndex, 10);
    expect(painted, "the toast stacks below the RSVP sheet").toBeGreaterThan(Z_LAYER.MODAL);
    expect(painted, "the toast stacks above the consent layers").toBeLessThan(Z_LAYER.CONSENT);

    // Painted, on screen, and anchored where `top-center` says.
    const rect = el.getBoundingClientRect();
    expect(rect.width, "toast has no box").toBeGreaterThan(0);
    expect(rect.top, "toast is off the top of the viewport").toBeGreaterThanOrEqual(0);
    expect(rect.bottom, "toast is below the fold").toBeLessThanOrEqual(window.innerHeight);
    expect(rect.top, "toast is not anchored to the viewport top").toBeLessThan(200);
  });

  it("keeps the fill painted on the first-visit path, after the reveal has run", async () => {
    await openByCode([json({ rsvps: [row("guest-priya"), row("guest-raj")] })]);

    respondButton().click();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    answer("Priya");
    answer("Raj");
    save();

    await wait(SETTLED_MS);
    expect(scaleX(fill())).toBe(1);
    await wait(TOTAL_DURATION_MS + 2000);
    expect(scaleX(fill())).toBe(1);
  });

  it("shows the save toast on the first-visit path too", async () => {
    // The path the restored test cannot cover: `unlockRevealSequence` has run,
    // so the events section carries Motion One's inline transform and anything
    // fixed inside it is no longer positioned against the viewport.
    await openByCode([json({ rsvps: [row("guest-priya")] })]);

    respondButton().click();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    answer("Priya");
    save();
    await wait(150);

    const toast = toastFor("Your RSVP for Mehndi has been recorded.");
    expect(toast, "no toast element in the DOM at all").toBeTruthy();
    const { el, container } = toast!;

    // The mechanism, first: nothing between the toast and <body> may establish a
    // containing block, or it is positioned against that ancestor and stacked
    // inside it — below the sheet, whatever z-index it carries.
    expect(
      fixedContainingBlockAncestor(container!),
      "the toast is trapped inside a transformed ancestor's stacking context",
    ).toBeNull();
    // Two-sided on purpose. `> MODAL` alone is satisfied by solid-toast's own
    // hardcoded inline `z-index: 9999`, which is what the layer prop has to
    // override — so a one-sided assertion passes while the toast sits ABOVE the
    // consent banner and dialog, the one thing that must never be buried.
    const painted = Number.parseInt(getComputedStyle(container!).zIndex, 10);
    expect(painted, "the toast stacks below the RSVP sheet").toBeGreaterThan(Z_LAYER.MODAL);
    expect(painted, "the toast stacks above the consent layers").toBeLessThan(Z_LAYER.CONSENT);

    // Painted, on screen, and anchored where `top-center` says.
    const rect = el.getBoundingClientRect();
    expect(rect.width, "toast has no box").toBeGreaterThan(0);
    expect(rect.top, "toast is off the top of the viewport").toBeGreaterThanOrEqual(0);
    expect(rect.bottom, "toast is below the fold").toBeLessThanOrEqual(window.innerHeight);
    expect(rect.top, "toast is not anchored to the viewport top").toBeLessThan(200);
  });
});
