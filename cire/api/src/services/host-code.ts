import { events, families, guests, guestEvents } from "@cire/db";
import { and, eq } from "drizzle-orm";
import { Effect, Data } from "effect";

import { DbService, dbQuery } from "../db";
import { metricHostCodeEnsured } from "../metrics";

export class HostCodeError extends Data.TaggedError("HostCodeError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/** Display name for the synthetic host family + its single member. The web
 *  invite renders these only behind the "preview" banner, so they never reach
 *  a real guest. */
const HOST_FAMILY_NAME = "Host Preview";
const HOST_GUEST_FIRST = "Wedding";
const HOST_GUEST_LAST = "Host";

/**
 * Mint a `HOST-*` claim code. 96 bits of `crypto.randomUUID` entropy (two
 * UUIDs, dashes stripped, first 24 hex chars) — far stronger than the 32-bit
 * family code, because this one code unlocks every event in the wedding. The
 * `HOST-` prefix keeps it visually distinct from family codes and out of their
 * namespace. 29 chars total, within the guest input's 30-char cap.
 */
function mintHostPublicId(): string {
  const suffix = (crypto.randomUUID() + crypto.randomUUID())
    .replace(/-/g, "")
    .slice(0, 24)
    .toUpperCase();
  return `HOST-${suffix}`;
}

export const hostCodeService = {
  /**
   * Idempotently provision the host preview code for a wedding and return its
   * claim code. Find-or-creates the single host family + its one synthetic
   * guest, then (re-)links that guest to **every** event in the wedding so the
   * preview always reflects the current event list — including events added by
   * a later spreadsheet import (which deliberately skips host families).
   *
   * weddingId is caller-supplied and already ownership-checked by
   * `weddingOwner()` upstream; this method does not re-authorise.
   */
  ensureForWedding(
    weddingId: string,
  ): Effect.Effect<{ publicId: string }, HostCodeError, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const now = new Date();

      const write = (op: string, run: () => unknown | Promise<unknown>) =>
        Effect.tryPromise({
          try: () => Promise.resolve(run()),
          catch: (cause) => new HostCodeError({ reason: op, cause }),
        }).pipe(
          Effect.tapError((err) => Effect.logError("host-code write failed", { op: err.reason })),
        );

      // Find-or-create the single host family for this wedding.
      const [existing] = yield* dbQuery(() =>
        db
          .select({ id: families.id, publicId: families.publicId })
          .from(families)
          .where(and(eq(families.weddingId, weddingId), eq(families.kind, "host")))
          .all(),
      );

      let familyId: string;
      let publicId: string;
      if (existing) {
        familyId = existing.id;
        publicId = existing.publicId;
      } else {
        familyId = crypto.randomUUID();
        publicId = mintHostPublicId();
        yield* write("insert family", () =>
          db
            .insert(families)
            .values({
              id: familyId,
              weddingId,
              publicId,
              familyName: HOST_FAMILY_NAME,
              kind: "host",
              createdAt: now,
              updatedAt: now,
            })
            .run(),
        );
      }

      // Ensure the host family has exactly one member to carry event links.
      const [hostGuest] = yield* dbQuery(() =>
        db.select({ id: guests.id }).from(guests).where(eq(guests.familyId, familyId)).all(),
      );
      let hostGuestId: string;
      if (hostGuest) {
        hostGuestId = hostGuest.id;
      } else {
        hostGuestId = crypto.randomUUID();
        yield* write("insert guest", () =>
          db
            .insert(guests)
            .values({
              id: hostGuestId,
              familyId,
              firstName: HOST_GUEST_FIRST,
              lastName: HOST_GUEST_LAST,
              sortOrder: 0,
              createdAt: now,
              updatedAt: now,
            })
            .run(),
        );
      }

      // (Re-)link the host guest to every event in the wedding. Idempotent:
      // only the missing links are inserted, so repeated previews are cheap and
      // newly imported events get picked up on the next call.
      const eventRows = yield* dbQuery(() =>
        db.select({ id: events.id }).from(events).where(eq(events.weddingId, weddingId)).all(),
      );
      const existingLinks = yield* dbQuery(() =>
        db
          .select({ eventId: guestEvents.eventId })
          .from(guestEvents)
          .where(eq(guestEvents.guestId, hostGuestId))
          .all(),
      );
      const linked = new Set(existingLinks.map((l) => l.eventId));
      const missing = eventRows.filter((e) => !linked.has(e.id));
      yield* Effect.forEach(
        missing,
        (e) =>
          write("link event", () =>
            db
              .insert(guestEvents)
              .values({ guestId: hostGuestId, eventId: e.id })
              .onConflictDoNothing()
              .run(),
          ),
        { discard: true },
      );

      return { publicId };
    }).pipe(
      Effect.tap(() => Effect.sync(() => metricHostCodeEnsured("ok"))),
      Effect.tapError(() => Effect.sync(() => metricHostCodeEnsured("error"))),
      Effect.withSpan("cire.host_code.ensure"),
    );
  },
};
