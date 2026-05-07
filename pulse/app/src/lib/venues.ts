/**
 * REST wrappers for the venue endpoints. Raw fetch to match the rsvps
 * + series modules — Eden treaty types chain left-to-right and the
 * venue routes will likely grow as the surface expands (capacity
 * booking, follower lists, …) so we keep this decoupled until the
 * shape stabilises.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface VenueSummary {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
  /** JSON-encoded weekday hours map. Parsed by `parseVenueHours`. */
  hours: string | null;
  heroImageUrl: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  timezone: string;
}

export interface VenueEvent {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string | null;
  status: "upcoming" | "ongoing" | "maybe_finished" | "finished" | "cancelled";
  imageUrl: string | null;
  category: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  venueId: string | null;
  createdByName: string | null;
}

export type LineupRole = "headliner" | "support" | "resident" | "opener" | "guest";

export interface LineupSlot {
  id: string;
  eventId: string;
  artistName: string;
  role: LineupRole;
  slotStart: string;
  slotEnd: string;
  orderIndex: number;
}

/** Parsed weekday hours map. Keys are ISO weekday numbers (Mon = 1, Sun = 7). */
export type VenueHours = Record<string, { open: string; close: string } | null>;

export function parseVenueHours(raw: string | null): VenueHours | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VenueHours;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchVenue(id: string): Promise<VenueSummary | null> {
  const res = await fetch(`${BASE_URL}/venues/${id}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { venue?: VenueSummary };
  return body.venue ?? null;
}

export async function fetchVenueEvents(
  id: string,
  scope: "upcoming" | "past" | "all" = "upcoming",
): Promise<VenueEvent[]> {
  const res = await fetch(`${BASE_URL}/venues/${id}/events?scope=${scope}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { events?: VenueEvent[] };
  return body.events ?? [];
}

export async function fetchEventLineup(venueId: string, eventId: string): Promise<LineupSlot[]> {
  const res = await fetch(`${BASE_URL}/venues/${venueId}/events/${eventId}/lineup`);
  if (!res.ok) return [];
  const body = (await res.json()) as { slots?: LineupSlot[] };
  return body.slots ?? [];
}
