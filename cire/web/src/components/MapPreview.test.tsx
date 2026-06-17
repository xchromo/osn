import { render, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, afterEach } from "vitest";

import { MapPreview } from "./MapPreview";
import type { EventSummary } from "./types";

const baseEvent: EventSummary = {
  id: "9f7a2c14-1b3d-4e5f-8a01-000000000001",
  name: "Mehndi",
  date: "2026-09-18",
  location: "The Sharma Residence",
  description: "An evening of henna",
  startAt: "2026-09-18T16:00:00+10:00",
  endAt: "2026-09-18T22:00:00+10:00",
  timezone: "Australia/Sydney",
  address: "12 Banksia Lane, Strathfield",
  dressCodeDescription: null,
  dressCodePalette: null,
  pinterestUrl: null,
  mapsUrl: null,
  sortOrder: 0,
};

describe("MapPreview", () => {
  afterEach(() => cleanup());

  it("links to a derived Google Maps search when only an address is present", () => {
    const { getByRole } = render(() => <MapPreview event={baseEvent} />);
    const link = getByRole("link") as HTMLAnchorElement;
    expect(link.href).toContain("https://www.google.com/maps/search/?api=1&query=");
    expect(link.href).toContain(encodeURIComponent("12 Banksia Lane, Strathfield"));
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  it("prefers an organiser-supplied mapsUrl", () => {
    const url = "https://maps.apple.com/?address=12+Banksia+Lane";
    const { getByRole } = render(() => <MapPreview event={{ ...baseEvent, mapsUrl: url }} />);
    expect((getByRole("link") as HTMLAnchorElement).href).toBe(url);
  });

  it("shows the venue line on the card", () => {
    const { getByText } = render(() => <MapPreview event={baseEvent} />);
    expect(getByText("12 Banksia Lane, Strathfield")).toBeTruthy();
    expect(getByText(/open in maps/i)).toBeTruthy();
  });

  it("renders nothing when there is no address, location, or mapsUrl", () => {
    const { container } = render(() => (
      <MapPreview event={{ ...baseEvent, address: null, location: "", mapsUrl: null }} />
    ));
    expect(container.querySelector("a")).toBeNull();
  });

  it("still renders when the address is absent but a mapsUrl is supplied", () => {
    const url = "https://maps.google.com/?q=somewhere";
    const { getByRole, getByText } = render(() => (
      <MapPreview event={{ ...baseEvent, address: null, location: "", mapsUrl: url }} />
    ));
    expect((getByRole("link") as HTMLAnchorElement).href).toBe(url);
    // No venue text to show — falls back to a neutral "View on map" label.
    expect(getByText("View on map")).toBeTruthy();
  });
});
