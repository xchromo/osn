/**
 * Pulse API domain metrics.
 *
 * Single source of truth — every counter/histogram for Pulse lives here.
 * Handlers and services import the recording helpers (`metric*`) and call
 * them at the relevant points. Raw OTel instruments are never used.
 *
 * See `CLAUDE.md` "Observability" section for the full rules.
 */

import {
  createCounter,
  createHistogram,
  LATENCY_BUCKETS_SECONDS,
} from "@shared/observability/metrics";
import type { EventStatus, Result } from "@shared/observability/metrics";

/** Canonical metric name consts — grep-able, refactor-safe. */
export const PULSE_METRICS = {
  eventsCreated: "pulse.events.created",
  eventsUpdated: "pulse.events.updated",
  eventsDeleted: "pulse.events.deleted",
  eventsListed: "pulse.events.listed",
  eventsCreateDuration: "pulse.events.create.duration",
  eventStatusTransitions: "pulse.events.status_transitions",
  eventValidationFailures: "pulse.events.validation.failures",
} as const;

// ---------------------------------------------------------------------------
// Attribute shapes — bounded string-literal unions ONLY.
// TypeScript rejects unknown keys, so cardinality is enforced at compile time.
// ---------------------------------------------------------------------------

type EventsCreatedAttrs = {
  /** Event category if set, else "uncategorized". Bounded in practice (~20 categories). */
  category: string;
  /** Whether the event had an explicit end time. */
  has_end_time: "true" | "false";
};

type EventsSimpleAttrs = {
  result: Result;
};

type EventsListedAttrs = {
  scope: "all" | "today";
  result_empty: "true" | "false";
};

type EventsStatusTransitionAttrs = {
  from: EventStatus;
  to: EventStatus;
};

type EventsValidationFailureAttrs = {
  operation: "create" | "update";
  reason: "schema" | "past_start_time";
};

// ---------------------------------------------------------------------------
// Counters / histograms
// ---------------------------------------------------------------------------

const eventsCreated = createCounter<EventsCreatedAttrs>({
  name: PULSE_METRICS.eventsCreated,
  description: "Events successfully created",
  unit: "{event}",
});

const eventsUpdated = createCounter<EventsSimpleAttrs>({
  name: PULSE_METRICS.eventsUpdated,
  description: "Event updates, by outcome",
  unit: "{event}",
});

const eventsDeleted = createCounter<EventsSimpleAttrs>({
  name: PULSE_METRICS.eventsDeleted,
  description: "Event deletions, by outcome",
  unit: "{event}",
});

const eventsListed = createCounter<EventsListedAttrs>({
  name: PULSE_METRICS.eventsListed,
  description: "Event list queries, by scope and whether any results were returned",
  unit: "{query}",
});

const eventsCreateDuration = createHistogram<EventsSimpleAttrs>({
  name: PULSE_METRICS.eventsCreateDuration,
  description: "createEvent service latency (includes DB insert + re-read)",
  unit: "s",
  boundaries: LATENCY_BUCKETS_SECONDS,
});

const eventStatusTransitions = createCounter<EventsStatusTransitionAttrs>({
  name: PULSE_METRICS.eventStatusTransitions,
  description: "Event auto-status transitions (on-read lifecycle)",
  unit: "{transition}",
});

const eventValidationFailures = createCounter<EventsValidationFailureAttrs>({
  name: PULSE_METRICS.eventValidationFailures,
  description: "Event create/update validation failures",
  unit: "{failure}",
});

// ---------------------------------------------------------------------------
// Public recording helpers — the ONLY way Pulse code should emit metrics.
// ---------------------------------------------------------------------------

export const metricEventCreated = (category: string | null, hasEndTime: boolean): void =>
  eventsCreated.inc({
    category: category ?? "uncategorized",
    has_end_time: hasEndTime ? "true" : "false",
  });

export const metricEventUpdated = (result: Result): void => eventsUpdated.inc({ result });

export const metricEventDeleted = (result: Result): void => eventsDeleted.inc({ result });

export const metricEventsListed = (scope: "all" | "today", resultCount: number): void =>
  eventsListed.inc({ scope, result_empty: resultCount === 0 ? "true" : "false" });

export const metricEventCreateDuration = (durationSeconds: number, result: Result): void =>
  eventsCreateDuration.record(durationSeconds, { result });

export const metricEventStatusTransition = (from: EventStatus, to: EventStatus): void =>
  eventStatusTransitions.inc({ from, to });

export const metricEventValidationFailure = (
  operation: "create" | "update",
  reason: "schema" | "past_start_time",
): void => eventValidationFailures.inc({ operation, reason });
