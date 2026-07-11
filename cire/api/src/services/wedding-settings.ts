import { weddings } from "@cire/db";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";

import { DbService, dbQuery } from "../db";
import { metricWeddingSettingsSaved } from "../metrics";
import type { UpdateSettingsBody } from "../schemas/settings";

/** The wedding profile as the Settings surface reads/writes it. Superset of
 *  `WeddingSummary` (the list shape) — everything an organiser edits here.
 *  Deliberately location-free: location is EVENT-scoped (a wedding can span
 *  countries), so the geocoded point + pricing region live on `events` and are
 *  edited via the event-location service. */
export type WeddingProfile = {
  id: string;
  slug: string;
  displayName: string;
  weddingDate: string | null;
  guestCountEstimate: number | null;
  currency: string;
  budgetTotalMinor: number | null;
};

export class WeddingNotFound extends Data.TaggedError("WeddingNotFound")<{
  readonly weddingId: string;
}> {}

/** The requested slug is already taken by another wedding (slug is globally
 *  unique — it's the guest invite URL). */
export class SlugTaken extends Data.TaggedError("SlugTaken")<{
  readonly weddingId: string;
}> {}

export class SettingsWriteError extends Data.TaggedError("SettingsWriteError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

const PROFILE_COLUMNS = {
  id: weddings.id,
  slug: weddings.slug,
  displayName: weddings.displayName,
  weddingDate: weddings.weddingDate,
  guestCountEstimate: weddings.guestCountEstimate,
  currency: weddings.currency,
  budgetTotalMinor: weddings.budgetTotalMinor,
};

export const weddingSettingsService = {
  /**
   * The wedding's profile. The caller has already passed a per-`:weddingId`
   * authz gate, so a miss means the row vanished between the gate and this
   * read — surfaced as the same 404.
   */
  get(weddingId: string): Effect.Effect<WeddingProfile, WeddingNotFound, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const [row] = yield* dbQuery(() =>
        db.select(PROFILE_COLUMNS).from(weddings).where(eq(weddings.id, weddingId)).limit(1).all(),
      );
      if (!row) return yield* new WeddingNotFound({ weddingId });
      return row;
    }).pipe(Effect.withSpan("cire.wedding_settings.get"));
  },

  /**
   * Apply a validated settings patch (PATCH semantics: only provided fields
   * change; explicit `null` clears a nullable column). The patch has already
   * passed the schema boundary, so every value is shape-valid — this enforces
   * only the DB-level slug uniqueness.
   */
  update(
    weddingId: string,
    patch: UpdateSettingsBody,
  ): Effect.Effect<WeddingProfile, WeddingNotFound | SlugTaken | SettingsWriteError, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const current = yield* weddingSettingsService.get(weddingId);

      const next: WeddingProfile = {
        ...current,
        ...(patch.displayName !== undefined && { displayName: patch.displayName }),
        ...(patch.slug !== undefined && { slug: patch.slug }),
        ...(patch.weddingDate !== undefined && { weddingDate: patch.weddingDate }),
        ...(patch.guestCountEstimate !== undefined && {
          guestCountEstimate: patch.guestCountEstimate,
        }),
        ...(patch.currency !== undefined && { currency: patch.currency }),
        ...(patch.budgetTotalMinor !== undefined && { budgetTotalMinor: patch.budgetTotalMinor }),
      };

      yield* Effect.tryPromise({
        try: () =>
          Promise.resolve(
            db
              .update(weddings)
              .set({
                slug: next.slug,
                displayName: next.displayName,
                weddingDate: next.weddingDate,
                guestCountEstimate: next.guestCountEstimate,
                currency: next.currency,
                budgetTotalMinor: next.budgetTotalMinor,
                updatedAt: new Date(),
              })
              .where(eq(weddings.id, weddingId))
              .run(),
          ),
        catch: (cause) =>
          // The only UNIQUE constraint this write can trip is the slug's (id is
          // the untouched WHERE key), so a UNIQUE failure IS a slug collision.
          String(cause).includes("UNIQUE")
            ? new SlugTaken({ weddingId })
            : new SettingsWriteError({ reason: "update", cause }),
      });

      return next;
    }).pipe(
      Effect.tap(() => Effect.sync(() => metricWeddingSettingsSaved("ok"))),
      Effect.tapErrorTag("SettingsWriteError", () =>
        Effect.sync(() => metricWeddingSettingsSaved("error")),
      ),
      Effect.withSpan("cire.wedding_settings.update"),
    );
  },
};
