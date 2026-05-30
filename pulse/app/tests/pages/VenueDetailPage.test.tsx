// @vitest-environment happy-dom
import { cleanup, render as _baseRender, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wrapRouter } from "../helpers/router";

vi.mock("@solidjs/router", async () => {
  const actual = await vi.importActual<typeof import("@solidjs/router")>("@solidjs/router");
  return {
    ...actual,
    useParams: () => ({ orgHandle: "tpf-collective", venueHandle: "the-pickle-factory" }),
  };
});

const fetchVenue = vi.fn();
const fetchVenueEvents = vi.fn();
const fetchEventLineup = vi.fn();

vi.mock("../../src/lib/venues", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/lib/venues")>("../../src/lib/venues");
  return {
    ...actual,
    fetchVenue: (...args: unknown[]) => fetchVenue(...args),
    fetchVenueEvents: (...args: unknown[]) => fetchVenueEvents(...args),
    fetchEventLineup: (...args: unknown[]) => fetchEventLineup(...args),
  };
});

import { VenueDetailPage } from "../../src/pages/VenueDetailPage";

const render: typeof _baseRender = ((factory: () => JSX.Element) =>
  _baseRender(wrapRouter(factory))) as unknown as typeof _baseRender;

const VENUE = {
  id: "ven_pf",
  orgHandle: "tpf-collective",
  handle: "the-pickle-factory",
  name: "The Pickle Factory",
  kind: "club",
  description: "A 250-cap basement room.",
  address: "13 The Oval",
  city: "London",
  country: "UK",
  latitude: 51.53,
  longitude: -0.05,
  capacity: 250,
  hours: JSON.stringify({ "5": { open: "22:00", close: "04:00" }, "1": null }),
  heroImageUrl: "https://example.com/hero.jpg",
  websiteUrl: "https://example.com",
  instagramHandle: "thepicklefactory",
  timezone: "Europe/London",
};

const EVENT_UPCOMING = {
  id: "evt_friday",
  title: "Friday Residency",
  description: "Vinyl only",
  startTime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  endTime: new Date(Date.now() + 2 * 86_400_000 + 7 * 3600_000).toISOString(),
  status: "upcoming" as const,
  imageUrl: "https://example.com/friday.jpg",
  category: "nightlife",
  priceAmount: 1500,
  priceCurrency: "GBP",
  venueId: "ven_pf",
  createdByName: "Alice",
};

const SLOTS = [
  {
    id: "lnp_1",
    eventId: "evt_friday",
    artistName: "Mara Reso",
    role: "resident" as const,
    slotStart: "2030-06-07T22:00:00.000Z",
    slotEnd: "2030-06-07T23:30:00.000Z",
    orderIndex: 0,
  },
  {
    id: "lnp_2",
    eventId: "evt_friday",
    artistName: "Anu",
    role: "headliner" as const,
    slotStart: "2030-06-07T23:30:00.000Z",
    slotEnd: "2030-06-08T01:00:00.000Z",
    orderIndex: 1,
  },
];

describe("VenueDetailPage", () => {
  beforeEach(() => {
    fetchVenue.mockReset();
    fetchVenueEvents.mockReset();
    fetchEventLineup.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the venue header, lineup timeline, and carousel", async () => {
    fetchVenue.mockResolvedValue(VENUE);
    fetchVenueEvents.mockResolvedValue([EVENT_UPCOMING]);
    fetchEventLineup.mockResolvedValue(SLOTS);

    const { findByText, findAllByText } = render(() => <VenueDetailPage />);

    expect(await findByText("The Pickle Factory")).toBeTruthy();
    // Title appears in both the timeline heading and the carousel card.
    expect((await findAllByText(/Friday Residency/)).length).toBeGreaterThan(0);
    expect(await findByText("Mara Reso")).toBeTruthy();
    expect(await findByText("Anu")).toBeTruthy();
    expect(await findByText("Headliner")).toBeTruthy();
  });

  it("renders 'Venue not found' when the venue API returns null", async () => {
    fetchVenue.mockResolvedValue(null);
    fetchVenueEvents.mockResolvedValue([]);
    fetchEventLineup.mockResolvedValue([]);

    const { findByText } = render(() => <VenueDetailPage />);
    await waitFor(() => {
      expect(findByText(/Venue not found/)).toBeTruthy();
    });
  });

  it("falls back to 'Lineup to be announced.' when the event has no slots", async () => {
    fetchVenue.mockResolvedValue(VENUE);
    fetchVenueEvents.mockResolvedValue([EVENT_UPCOMING]);
    fetchEventLineup.mockResolvedValue([]);

    const { findByText } = render(() => <VenueDetailPage />);
    expect(await findByText(/Lineup to be announced/)).toBeTruthy();
  });
});
