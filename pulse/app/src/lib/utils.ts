export function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function toDatetimeLocal(date: Date): string {
  // Round up to next minute so the default start time is always slightly in the future
  const rounded = new Date(Math.ceil(date.getTime() / 60000) * 60000);
  return `${rounded.getFullYear()}-${pad(rounded.getMonth() + 1)}-${pad(rounded.getDate())}T${pad(rounded.getHours())}:${pad(rounded.getMinutes())}`;
}

export interface PhotonFeature {
  geometry: {
    coordinates: [number, number]; // [longitude, latitude] — GeoJSON order
  };
  properties: {
    name?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

export function composeLabel(p: PhotonFeature["properties"]): string {
  return [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(", ");
}

/** Returns true when end is set and is not strictly after start (form validation). */
export function isEndBeforeOrAtStart(start: string, end: string): boolean {
  return !!end && end <= start;
}

/**
 * Given a start datetime-local string and a duration in hours, returns
 * the corresponding end datetime-local string. Returns an empty string
 * if `start` cannot be parsed, so the caller can leave `endTime` empty
 * rather than emitting "Invalid Date".
 */
export function deriveEndFromDuration(start: string, hours: number): string {
  if (!start) return "";
  const startDate = new Date(start);
  if (isNaN(startDate.getTime())) return "";
  const end = new Date(startDate.getTime() + hours * 60 * 60 * 1000);
  return toDatetimeLocal(end);
}

/**
 * Soft-finished threshold, in hours, for events without an explicit
 * `endTime`. The server auto-closes such events after 48h (see
 * `MAX_EVENT_DURATION_HOURS` in `pulse/api/src/lib/limits.ts`); between
 * 8h and 48h past `startTime` the client surfaces them as "maybe
 * finished" so guests aren't left wondering.
 */
export const POTENTIALLY_FINISHED_AFTER_HOURS = 8;

/**
 * Returns true when an event is still server-side "ongoing" but has
 * been running long enough (with no explicit `endTime`) that it's
 * probably actually over. Client-only display signal — the server still
 * reports `status: "ongoing"`.
 */
export function isPotentiallyFinished(event: {
  status: string;
  startTime: string | Date;
  endTime: string | Date | null;
}): boolean {
  if (event.status !== "ongoing") return false;
  if (event.endTime) return false;
  const startMs = new Date(event.startTime).getTime();
  if (isNaN(startMs)) return false;
  return Date.now() - startMs >= POTENTIALLY_FINISHED_AFTER_HOURS * 60 * 60 * 1000;
}

/**
 * Decodes a JWT payload without verifying the signature.
 * Safe for display-only purposes — the server verifies the signature on every write.
 */
function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(accessToken.split(".")[1]!)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extracts the `sub` (profile ID) claim from an access token. */
export function getProfileIdFromToken(accessToken: string | null): string | null {
  return getTokenClaims(accessToken).profileId;
}

export interface TokenClaims {
  profileId: string | null;
  email: string | null;
  handle: string | null;
  displayName: string | null;
}

/** Decodes all OSN claims from an access token in one pass. */
export function getTokenClaims(accessToken: string | null): TokenClaims {
  const payload = decodeJwtPayload(accessToken ?? "");
  return {
    profileId: typeof payload?.sub === "string" ? payload.sub : null,
    email: typeof payload?.email === "string" ? payload.email : null,
    handle: typeof payload?.handle === "string" ? payload.handle : null,
    displayName: typeof payload?.displayName === "string" ? payload.displayName : null,
  };
}

/**
 * Derives a display name from an access token.
 * Prefers the `displayName` claim, falls back to `@handle`, then to the email local-part.
 */
export function getDisplayNameFromToken(accessToken: string | null): string | null {
  if (!accessToken) return null;
  const { displayName, handle, email } = getTokenClaims(accessToken);
  if (displayName) return displayName;
  if (handle) return `@${handle}`;
  if (email) return email.split("@")[0] ?? null;
  return null;
}

/** Extracts the `handle` claim from an access token, without the @ sigil. */
export function getHandleFromToken(accessToken: string | null): string | null {
  return getTokenClaims(accessToken).handle;
}
