// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Re-ordering the schedule — the two input paths, kept apart from the main
 * EventsEditor suite because the pointer path needs geometry faked in.
 *
 * happy-dom does no layout: every `getBoundingClientRect()` is zeroes, so
 * solid-dnd's `closestCenter` would see every row's centre at (0,0) and pick a
 * collision arbitrarily. `stubRowGeometry` gives the rows real stacked rects so a
 * synthetic pointer drag resolves to a genuine drop target — which makes this an
 * end-to-end check of solid-dnd itself (sensor → collision → `onDragEnd`), not
 * just of our handler.
 */

const authFetchMock = vi.fn();

vi.mock("@shared/rp-auth/solid", () => ({
  useAuth: () => ({ authFetch: authFetchMock }),
}));

vi.mock("solid-toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/api", () => ({
  apiUrl: (path: string) => `https://api.test${path}`,
  isAuthExpired: () => false,
  redirectToLogin: () => {},
}));

import { __resetEventsCache } from "../lib/events-store";
import { __resetGuestsCache } from "../lib/guests-store";
import EventsEditor from "./EventsEditor";

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const baseEvent = {
  slug: "",
  endAt: "",
  timezone: "Australia/Sydney",
  address: null,
  description: "",
  dressCodeDescription: null,
  dressCodePalette: null,
  pinterestUrl: null,
  mapsUrl: null,
  imageUrl: null,
  imageCrop: null,
};

const EVENTS = [
  {
    ...baseEvent,
    id: "evt_1",
    name: "Ceremony",
    sortOrder: 0,
    startAt: "2026-11-14T15:00:00+11:00",
  },
  {
    ...baseEvent,
    id: "evt_2",
    name: "Reception",
    sortOrder: 1,
    startAt: "2026-11-14T18:00:00+11:00",
  },
  { ...baseEvent, id: "evt_3", name: "Brunch", sortOrder: 2, startAt: "2026-11-15T10:00:00+11:00" },
];

const ROW_HEIGHT = 100;

/** Give each event row a real stacked bounding box so collision detection works.
 *  Rects are derived from the row's CURRENT DOM position, so they stay correct
 *  after a reorder moves the nodes. */
function stubRowGeometry() {
  const rows = () => [...document.querySelectorAll("li")];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      const index = rows().indexOf(this as HTMLLIElement);
      if (index === -1) return new DOMRect(0, 0, 0, 0);
      return new DOMRect(0, index * ROW_HEIGHT, 500, ROW_HEIGHT);
    },
  );
}

/** The visible event names, in rendered order. */
function renderedOrder() {
  return [...document.querySelectorAll("li")].map(
    (li) => li.querySelector("p")?.textContent?.trim() ?? "",
  );
}

function grip(name: string) {
  return screen.getByRole("button", { name: new RegExp(`Reorder ${name}`, "i") });
}

beforeEach(() => {
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: vi.fn().mockReturnValue(true),
  });
  authFetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/events")) return Promise.resolve(json(EVENTS));
    if (String(url).endsWith("/guests")) return Promise.resolve(json([]));
    return Promise.resolve(json({}));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authFetchMock.mockReset();
  __resetGuestsCache();
  __resetEventsCache();
});

async function mounted() {
  render(() => <EventsEditor weddingId="wed_a" />);
  await waitFor(() => expect(screen.getByText("Brunch")).toBeTruthy());
  expect(renderedOrder()).toEqual(["Ceremony", "Reception", "Brunch"]);
}

describe("EventsEditor — re-ordering by keyboard", () => {
  it("moves a row down with ArrowDown from the focused grip", async () => {
    await mounted();

    fireEvent.keyDown(grip("Ceremony"), { key: "ArrowDown" });

    await waitFor(() => expect(renderedOrder()).toEqual(["Reception", "Ceremony", "Brunch"]));
    // The move is announced for screen readers.
    expect(screen.getByRole("status").textContent).toMatch(/Ceremony moved to position 2 of 3/i);
    // And it dirties the draft, so it can be saved.
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeTruthy();
  });

  it("moves a row up with ArrowUp", async () => {
    await mounted();

    fireEvent.keyDown(grip("Brunch"), { key: "ArrowUp" });

    await waitFor(() => expect(renderedOrder()).toEqual(["Ceremony", "Brunch", "Reception"]));
    expect(screen.getByRole("status").textContent).toMatch(/Brunch moved to position 2 of 3/i);
  });

  it("keeps focus on the moved row's grip so it can be moved again", async () => {
    await mounted();

    const handle = grip("Ceremony");
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    await waitFor(() => expect(renderedOrder()).toEqual(["Reception", "Ceremony", "Brunch"]));

    // `<For>` is keyed, so this is the SAME node moved to the new slot — and the
    // handler re-focuses it, because a DOM move doesn't reliably keep focus.
    expect(grip("Ceremony")).toBe(handle);
    expect(document.activeElement).toBe(handle);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    await waitFor(() => expect(renderedOrder()).toEqual(["Reception", "Brunch", "Ceremony"]));
  });

  it("ignores a move off either end of the list", async () => {
    await mounted();

    fireEvent.keyDown(grip("Ceremony"), { key: "ArrowUp" });
    fireEvent.keyDown(grip("Brunch"), { key: "ArrowDown" });

    expect(renderedOrder()).toEqual(["Ceremony", "Reception", "Brunch"]);
    // Nothing changed ⇒ the draft is still clean.
    expect(screen.queryByRole("button", { name: /Save changes/i })).toBeNull();
  });

  it("leaves other keys alone", async () => {
    await mounted();

    fireEvent.keyDown(grip("Ceremony"), { key: "ArrowLeft" });
    fireEvent.keyDown(grip("Ceremony"), { key: "Enter" });

    expect(renderedOrder()).toEqual(["Ceremony", "Reception", "Brunch"]);
  });
});

describe("EventsEditor — re-ordering by pointer drag", () => {
  /** Drive solid-dnd's pointer sensor: press the grip, move past the sensor's
   *  activation threshold onto the target row's centre, release. */
  function drag(handle: HTMLElement, toY: number) {
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    // First move activates the sensor (it has a small distance threshold).
    fireEvent(document, new PointerEvent("pointermove", { clientX: 10, clientY: 30 }));
    fireEvent(document, new PointerEvent("pointermove", { clientX: 10, clientY: toY }));
    fireEvent(document, new PointerEvent("pointerup", { clientX: 10, clientY: toY }));
  }

  it("drops a row onto a lower slot and commits the new order", async () => {
    await mounted();
    stubRowGeometry();

    // Drag Ceremony (row 0) down over Brunch's row (row 2, centre y=250).
    drag(grip("Ceremony"), 10 + 2 * ROW_HEIGHT);

    await waitFor(() => expect(renderedOrder()).toEqual(["Reception", "Brunch", "Ceremony"]));
    expect(screen.getByRole("status").textContent).toMatch(/Ceremony moved to position 3 of 3/i);
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeTruthy();
  });

  it("drops a row onto a higher slot", async () => {
    await mounted();
    stubRowGeometry();

    // Drag Brunch (row 2) up over Ceremony's row (row 0).
    drag(grip("Brunch"), 10 - 2 * ROW_HEIGHT);

    await waitFor(() => expect(renderedOrder()).toEqual(["Brunch", "Ceremony", "Reception"]));
  });

  it("a press with no movement leaves the order untouched", async () => {
    await mounted();
    stubRowGeometry();

    const handle = grip("Reception");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent(document, new PointerEvent("pointerup", { clientX: 10, clientY: 10 }));

    expect(renderedOrder()).toEqual(["Ceremony", "Reception", "Brunch"]);
    expect(screen.queryByRole("button", { name: /Save changes/i })).toBeNull();
  });
});
