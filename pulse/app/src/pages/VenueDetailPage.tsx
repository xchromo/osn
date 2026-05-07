import { Card } from "@osn/ui/ui/card";
import { A, useParams } from "@solidjs/router";
import { createMemo, createResource, For, Show } from "solid-js";

import { VenueEventCarousel } from "../components/VenueEventCarousel";
import { VenueLineupTimeline } from "../components/VenueLineupTimeline";
import {
  fetchEventLineup,
  fetchVenue,
  fetchVenueEvents,
  parseVenueHours,
  type VenueEvent,
} from "../lib/venues";

import "./venue.css";

const WEEKDAY_LABEL: Record<string, string> = {
  "1": "Mon",
  "2": "Tue",
  "3": "Wed",
  "4": "Thu",
  "5": "Fri",
  "6": "Sat",
  "7": "Sun",
};

const WEEKDAY_ORDER = ["1", "2", "3", "4", "5", "6", "7"] as const;

/**
 * Picks the next club night to feature in the timeline. Prefers
 * "ongoing", then the soonest "upcoming", then the most-recent
 * "finished" so the page never goes blank when the next night isn't
 * announced yet.
 */
function pickFeaturedEvent(events: VenueEvent[]): VenueEvent | null {
  if (events.length === 0) return null;
  const ongoing = events.find((e) => e.status === "ongoing");
  if (ongoing) return ongoing;
  const upcoming = events
    .filter((e) => e.status === "upcoming")
    .toSorted((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  if (upcoming.length > 0) return upcoming[0]!;
  return (
    events
      .filter((e) => e.status === "finished")
      .toSorted((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0] ??
    events[0]!
  );
}

function formatNightDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function VenueDetailPage() {
  const params = useParams<{ id: string }>();

  const [venue] = createResource(() => params.id, fetchVenue);
  const [events] = createResource(
    () => params.id,
    (id) => fetchVenueEvents(id, "all"),
  );

  const featuredEvent = createMemo(() => {
    const all = events();
    if (!all) return null;
    // Hide the past night unless it's the only thing we have — see
    // pickFeaturedEvent.
    const upcomingPlusOngoing = all.filter(
      (e) => e.status === "upcoming" || e.status === "ongoing",
    );
    return pickFeaturedEvent(upcomingPlusOngoing.length > 0 ? upcomingPlusOngoing : all);
  });

  const upcomingEvents = createMemo(() => {
    const all = events();
    if (!all) return [];
    return all
      .filter((e) => e.status === "upcoming" || e.status === "ongoing")
      .toSorted((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  });

  const lineupSource = createMemo(() => {
    const v = venue();
    const e = featuredEvent();
    if (!v || !e) return null;
    return { venueId: v.id, eventId: e.id };
  });

  const [lineup] = createResource(lineupSource, (s) =>
    s ? fetchEventLineup(s.venueId, s.eventId) : Promise.resolve([]),
  );

  const hours = createMemo(() => {
    const v = venue();
    return v ? parseVenueHours(v.hours) : null;
  });

  return (
    <main class="mx-auto max-w-3xl px-4 py-6">
      <div class="mb-4">
        <A href="/" class="text-primary text-sm hover:underline">
          ← Back to events
        </A>
      </div>

      <Show when={venue.loading}>
        <p class="text-muted-foreground py-16 text-center">Loading…</p>
      </Show>

      <Show when={!venue.loading && venue() === null}>
        <p class="text-destructive py-16 text-center">Venue not found.</p>
      </Show>

      <Show when={venue()}>
        {(v) => (
          <article class="flex flex-col gap-6">
            {/* Hero */}
            <Card class="overflow-hidden">
              <Show when={v().heroImageUrl}>
                <img class="h-64 w-full object-cover" src={v().heroImageUrl!} alt={v().name} />
              </Show>
              <div class="p-5">
                <p class="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
                  {v().kind}
                  <Show when={v().capacity}>{(c) => <> · Capacity {c()}</>}</Show>
                </p>
                <h1 class="mt-1 text-3xl">{v().name}</h1>
                <Show when={[v().address, v().city, v().country].filter(Boolean).join(", ")}>
                  {(loc) => <p class="text-muted-foreground mt-1 text-sm">{loc()}</p>}
                </Show>
                <Show when={v().description}>
                  <p class="text-foreground mt-3 text-sm whitespace-pre-wrap">{v().description}</p>
                </Show>
                <div class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <Show when={v().websiteUrl}>
                    {(url) => (
                      <a
                        href={url()}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-primary hover:underline"
                      >
                        Website
                      </a>
                    )}
                  </Show>
                  <Show when={v().instagramHandle}>
                    {(handle) => (
                      <a
                        href={`https://instagram.com/${handle()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-primary hover:underline"
                      >
                        @{handle()}
                      </a>
                    )}
                  </Show>
                </div>
              </div>
            </Card>

            {/* Hours */}
            <Show when={hours()}>
              {(h) => (
                <Card class="p-5">
                  <p class="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
                    Hours
                  </p>
                  <ul class="mt-2 grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-2">
                    <For each={WEEKDAY_ORDER}>
                      {(day) => {
                        const slot = h()[day];
                        return (
                          <li class="flex items-baseline gap-3">
                            <span class="text-muted-foreground w-10 font-mono text-xs uppercase">
                              {WEEKDAY_LABEL[day]}
                            </span>
                            <span class="font-mono text-xs tabular-nums">
                              {slot ? `${slot.open} – ${slot.close}` : "Closed"}
                            </span>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Card>
              )}
            </Show>

            {/* Tonight's lineup */}
            <Show when={featuredEvent()}>
              {(e) => (
                <section class="flex flex-col gap-2">
                  <p class="text-muted-foreground text-xs">
                    {e().status === "ongoing" ? "Tonight" : "Next night"} ·{" "}
                    {formatNightDate(e().startTime, v().timezone)}
                  </p>
                  <VenueLineupTimeline
                    slots={lineup() ?? []}
                    timezone={v().timezone}
                    heading={e().title}
                  />
                </section>
              )}
            </Show>

            {/* Programme carousel */}
            <Show when={!events.loading}>
              <VenueEventCarousel events={upcomingEvents()} heading={`Upcoming at ${v().name}`} />
            </Show>
          </article>
        )}
      </Show>
    </main>
  );
}
