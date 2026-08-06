// IANA timezone helpers, shared by the two places the portal asks an organiser
// "which zone is this in?" — the settings panel's RSVP-by deadline and the
// events editor's per-event zone.
//
// The events editor used to ask for a raw UTC offset from a fixed ten-item list
// alongside a free-text IANA name, which is two ways of saying the same thing
// and one of them is a trap: an offset is a fact ABOUT a zone on a particular
// date, not a property of the event, so "+10:00" typed for a Sydney wedding in
// November is simply wrong and nothing catches it. The zone is now the only
// thing an organiser picks, and {@link zoneOffset} derives the offset from it —
// DST-correctly, for that event's own date.

/** The organiser's own zone, used to seed a new event / stamp a deadline they
 *  have just picked. A browser that won't name its zone (ancient/locked-down)
 *  falls back to UTC — the same default the API applies to a zone-less value. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Zone-name formatters, cached by zone (P-I3). Construction is the expensive
 *  part; only successful lookups are stored, so an unresolvable zone costs a
 *  throwaway construction and can't grow the map. */
const zoneNameFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneNameFormatter(zone: string): Intl.DateTimeFormat | null {
  const cached = zoneNameFormatters.get(zone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat("en-AU", { timeZone: zone, timeZoneName: "short" });
    zoneNameFormatters.set(zone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

/** "Australia/Sydney" → "Australia/Sydney (AEST)" where the runtime can name
 *  the abbreviation, so the hint says something an organiser recognises. */
export function describeTimeZone(zone: string, on: string | null): string {
  const at = on ? new Date(`${on}T12:00:00Z`) : new Date();
  if (Number.isNaN(at.getTime())) return zone;
  const short = zoneNameFormatter(zone)
    ?.formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  return short && short !== zone ? `${zone} (${short})` : zone;
}

// ── Offsets ──────────────────────────────────────────────────────────────────

/** Same cache-by-zone shape as the abbreviation formatters above, for the
 *  `longOffset` ("GMT+11:00") style. Separate map: a formatter carries its
 *  `timeZoneName` option, so the two styles can't share one instance. */
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(zone: string): Intl.DateTimeFormat | null {
  const cached = offsetFormatters.get(zone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: "longOffset",
    });
    offsetFormatters.set(zone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

/** Minutes east of UTC that `zone` is on at the given INSTANT, or null when the
 *  runtime can't resolve the zone. `longOffset` renders "GMT+11:00", "GMT-05:00"
 *  or a bare "GMT" at zero; an older runtime that only manages "GMT+11" parses
 *  too (the minutes group is optional). */
function offsetMinutesAt(zone: string, at: Date): number | null {
  const name = offsetFormatter(zone)
    ?.formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  if (!name) return null;
  if (name === "GMT" || name === "UTC") return 0;
  const m = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(name);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

/** `±HH:MM` for a count of minutes east of UTC. Zero renders `+00:00` (not
 *  `Z`) — the events editor's canonical Start/End shape spells the offset out,
 *  and `isIsoTimestamp` accepts both. */
function formatOffsetMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * The UTC offset (`+HH:MM` / `-HH:MM`) that `zone` is on for the WALL-CLOCK
 * `date` (`YYYY-MM-DD`) + `time` (`HH:MM`) given — the answer to "the ceremony
 * is at 3pm in Sydney on 14 November; what offset does that timestamp carry?".
 * Returns null when the date/time is incomplete or the zone is unresolvable,
 * so the caller can keep whatever offset the stored value already had.
 *
 * Two passes, because the input is a wall-clock time and the zone's offset is
 * what we're trying to find: read the offset at the naive UTC reading of that
 * wall time, subtract it to get a much better instant, then read the offset
 * THERE. The second reading is the correct one on every day except the couple
 * of hours around a DST transition, where the wall time is ambiguous or
 * non-existent and any answer is a choice — this one takes the post-shift zone,
 * matching what `Temporal`'s `compatible` disambiguation would pick.
 */
export function zoneOffset(zone: string, date: string, time: string): string | null {
  if (!zone.trim()) return null;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})/.exec(time.trim());
  if (!d || !t) return null;
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(naive)) return null;
  const first = offsetMinutesAt(zone, new Date(naive));
  if (first === null) return null;
  const second = offsetMinutesAt(zone, new Date(naive - first * 60_000));
  return formatOffsetMinutes(second ?? first);
}

// ── The dropdown's option list ───────────────────────────────────────────────

/**
 * The zones offered when the runtime can't enumerate its own tz database
 * (`Intl.supportedValuesOf` is ES2022; every browser we target has it, but a
 * dropdown with no options would be a dead end, so this is the floor). Broad
 * rather than Australia-only: the portal is not a single-wedding product.
 */
const FALLBACK_ZONES = [
  "Pacific/Auckland",
  "Australia/Sydney",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
] as const;

/** Lazily-resolved tz database. Deliberately not computed at module scope: this
 *  module is imported by a SolidJS island, so its top level also runs during
 *  Astro's SSR, and a several-hundred-entry list built there is pure waste for
 *  a page that may never open the drawer. */
let supportedZones: string[] | null = null;

function allZones(): string[] {
  if (supportedZones) return supportedZones;
  const supportedValuesOf = (Intl as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  let zones: string[] = [];
  try {
    zones = supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  supportedZones = zones.length > 0 ? zones : [...FALLBACK_ZONES];
  return supportedZones;
}

/** One `<optgroup>` of the timezone dropdown. */
export interface TimeZoneGroup {
  label: string;
  zones: string[];
}

/** Zones whose id carries no "Region/" prefix (`UTC`, `GMT`) — grouped under a
 *  name of their own rather than dropped or filed under an empty heading. */
const UNGROUPED_LABEL = "UTC";

/**
 * The dropdown's options, grouped by region so a several-hundred-entry list
 * stays navigable. `current` (the value already on the record) is always
 * present even when the runtime doesn't know it — an imported wedding may carry
 * a zone this browser's tz database has since renamed, and a `<select>` whose
 * value isn't in its options silently shows the FIRST option instead, which
 * would look like the portal quietly moved the wedding to another continent.
 * It leads the list, under a "Current" heading, when it isn't a known zone.
 */
export function timeZoneGroups(current?: string | null): TimeZoneGroup[] {
  const zones = allZones();
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const slash = zone.indexOf("/");
    const label = slash === -1 ? UNGROUPED_LABEL : zone.slice(0, slash).replaceAll("_", " ");
    const list = groups.get(label);
    if (list) list.push(zone);
    else groups.set(label, [zone]);
  }
  const ordered = Array.from(groups, ([label, list]) => ({
    label,
    zones: list.toSorted((a, b) => a.localeCompare(b)),
  })).toSorted((a, b) => a.label.localeCompare(b.label));

  const value = current?.trim();
  if (value && !zones.includes(value)) {
    return [{ label: "Current", zones: [value] }, ...ordered];
  }
  return ordered;
}
