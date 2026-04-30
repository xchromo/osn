/**
 * Share-source attribution for events.
 *
 * The closed enum below is the canonical list of platforms an event
 * organiser will see in their attribution analytics. New platforms (e.g.
 * Zap, future OSN-native shares) extend this union — adding a value is a
 * one-line change here plus the matching constant in the frontend mirror
 * at `pulse/app/src/lib/shareSource.ts`.
 *
 * Three layers consume this:
 *   1. The Effect Schema literal (`ShareSourceSchema`) — service-layer
 *      validation in `services/rsvps.ts`.
 *   2. The TypeBox literal builder (`shareSourceTypeBoxUnion`) — HTTP
 *      boundary in `routes/events.ts`. TypeBox-only at the boundary,
 *      Effect Schema-only in services, per `[[schema-layers]]`.
 *   3. The metric attribute union (`ShareSourceAttr`) — bounded
 *      cardinality input to the share / exposure / attribution counters
 *      in `metrics.ts`.
 */

import { Schema } from "effect";
import { t } from "elysia";

export const SHARE_SOURCES = [
  "instagram",
  "facebook",
  "tiktok",
  "x",
  "whatsapp",
  "copy_link",
  "other",
] as const;

export type ShareSource = (typeof SHARE_SOURCES)[number];

const SHARE_SOURCE_SET: ReadonlySet<string> = new Set(SHARE_SOURCES);

export const isShareSource = (value: unknown): value is ShareSource =>
  typeof value === "string" && SHARE_SOURCE_SET.has(value);

/** Effect Schema literal — for service-layer decode. */
export const ShareSourceSchema = Schema.Literal(...SHARE_SOURCES);

/**
 * TypeBox union over the share-source enum. Built fresh per call so the
 * route file can use it inline without sharing a mutable singleton with
 * other routes (TypeBox schemas are reference-tracked by Elysia for
 * type inference).
 */
export const shareSourceTypeBoxUnion = () =>
  t.Union([
    t.Literal("instagram"),
    t.Literal("facebook"),
    t.Literal("tiktok"),
    t.Literal("x"),
    t.Literal("whatsapp"),
    t.Literal("copy_link"),
    t.Literal("other"),
  ]);
