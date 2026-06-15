import { weddingInviteCustomisations, weddings } from "@cire/db";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";

import { DbService, dbQuery } from "../db";
import type { InviteImageSlot, InviteTextBody } from "../schemas/invite";
import { deleteAsset, storeAsset } from "./invite-assets";
import type { AssetsR2Service } from "./invite-assets";

export class WeddingNotFound extends Data.TaggedError("WeddingNotFound")<{
  readonly slug?: string;
}> {}

/**
 * The customisation as the invite renders it. Text fields are the raw stored
 * overrides (`null` ⇒ the guest site / organiser preview falls back to the
 * built-in default copy). Image fields are ready-to-use URL *paths* — clients
 * prepend their API origin — carrying a `?v=` cache-buster keyed to the row's
 * `updatedAt` so a re-uploaded image isn't served stale.
 */
export interface InviteCustomisation {
  hero: { title: string | null; subtitle: string | null; imageUrl: string | null };
  story: {
    eyebrow: string | null;
    heading: string | null;
    body: string | null;
    imageUrl: string | null;
  };
}

const EMPTY: InviteCustomisation = {
  hero: { title: null, subtitle: null, imageUrl: null },
  story: { eyebrow: null, heading: null, body: null, imageUrl: null },
};

/** Public path the invite image is served from. Clients prepend the API origin. */
function imagePath(slug: string, slot: InviteImageSlot, version: number): string {
  return `/api/invite/${encodeURIComponent(slug)}/image/${slot}?v=${version}`;
}

/** Trim, then collapse an all-whitespace/empty override to `null` (use default). */
function normaliseCopy(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export const inviteService = {
  /** Customisation for an organiser-owned wedding (weddingId already authorised). */
  getForWedding(
    weddingId: string,
    slug: string,
  ): Effect.Effect<InviteCustomisation, never, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const [row] = yield* dbQuery(() =>
        db
          .select()
          .from(weddingInviteCustomisations)
          .where(eq(weddingInviteCustomisations.weddingId, weddingId))
          .all(),
      );
      if (!row) return EMPTY;
      const version = row.updatedAt.getTime();
      return {
        hero: {
          title: row.heroTitle,
          subtitle: row.heroSubtitle,
          imageUrl: row.heroImageKey ? imagePath(slug, "hero", version) : null,
        },
        story: {
          eyebrow: row.storyEyebrow,
          heading: row.storyHeading,
          body: row.storyBody,
          imageUrl: row.storyImageKey ? imagePath(slug, "story", version) : null,
        },
      };
    }).pipe(Effect.withSpan("cire.invite.getForWedding"));
  },

  /** Slug for an organiser-owned wedding (weddingOwner already proved it exists). */
  weddingSlug(weddingId: string): Effect.Effect<string, WeddingNotFound, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const [row] = yield* dbQuery(() =>
        db.select({ slug: weddings.slug }).from(weddings).where(eq(weddings.id, weddingId)).all(),
      );
      if (!row) return yield* Effect.fail(new WeddingNotFound({}));
      return row.slug;
    });
  },

  /** Customisation for an owned wedding, resolving the slug itself (organiser GET). */
  getForWeddingId(
    weddingId: string,
  ): Effect.Effect<InviteCustomisation, WeddingNotFound, DbService> {
    return Effect.gen(function* () {
      const slug = yield* inviteService.weddingSlug(weddingId);
      return yield* inviteService.getForWedding(weddingId, slug);
    });
  },

  /** Public read by wedding slug — drives the guest site. 404 for unknown slug. */
  getForSlug(slug: string): Effect.Effect<InviteCustomisation, WeddingNotFound, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const [wedding] = yield* dbQuery(() =>
        db.select({ id: weddings.id }).from(weddings).where(eq(weddings.slug, slug)).all(),
      );
      if (!wedding) return yield* Effect.fail(new WeddingNotFound({ slug }));
      return yield* inviteService.getForWedding(wedding.id, slug);
    }).pipe(Effect.withSpan("cire.invite.getForSlug"));
  },

  /** Resolve the R2 key backing a slug's image slot (for serving). */
  imageKeyForSlug(
    slug: string,
    slot: InviteImageSlot,
  ): Effect.Effect<string | null, WeddingNotFound, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const [row] = yield* dbQuery(() =>
        db
          .select({
            heroImageKey: weddingInviteCustomisations.heroImageKey,
            storyImageKey: weddingInviteCustomisations.storyImageKey,
          })
          .from(weddingInviteCustomisations)
          .innerJoin(weddings, eq(weddings.id, weddingInviteCustomisations.weddingId))
          .where(eq(weddings.slug, slug))
          .all(),
      );
      // No customisation row yet is a legitimate "no image", not a 404 — only an
      // unknown slug is. Distinguish by checking the wedding exists separately.
      if (!row) {
        const [wedding] = yield* dbQuery(() =>
          db.select({ id: weddings.id }).from(weddings).where(eq(weddings.slug, slug)).all(),
        );
        if (!wedding) return yield* Effect.fail(new WeddingNotFound({ slug }));
        return null;
      }
      return slot === "hero" ? row.heroImageKey : row.storyImageKey;
    }).pipe(Effect.withSpan("cire.invite.imageKeyForSlug"));
  },

  /** Upsert the text overrides for a wedding. Empty/whitespace clears to default. */
  upsertText(weddingId: string, fields: InviteTextBody): Effect.Effect<void, never, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const values = {
        heroTitle: normaliseCopy(fields.heroTitle),
        heroSubtitle: normaliseCopy(fields.heroSubtitle),
        storyEyebrow: normaliseCopy(fields.storyEyebrow),
        storyHeading: normaliseCopy(fields.storyHeading),
        storyBody: normaliseCopy(fields.storyBody),
      };
      yield* dbQuery(() =>
        db
          .insert(weddingInviteCustomisations)
          .values({ weddingId, ...values, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: weddingInviteCustomisations.weddingId,
            set: { ...values, updatedAt: new Date() },
          })
          .run(),
      );
      yield* Effect.logInfo("invite text customisation saved", { weddingId });
    }).pipe(Effect.withSpan("cire.invite.upsertText"));
  },

  /**
   * Store an uploaded image for a slot and point the row at it, deleting the
   * superseded object best-effort. Returns the new public image path.
   */
  setImage(
    weddingId: string,
    slug: string,
    slot: InviteImageSlot,
    bytes: ArrayBuffer,
    contentType: string,
  ): Effect.Effect<string, never, DbService | AssetsR2Service> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const column =
        slot === "hero"
          ? weddingInviteCustomisations.heroImageKey
          : weddingInviteCustomisations.storyImageKey;

      const [existing] = yield* dbQuery(() =>
        db
          .select({ key: column })
          .from(weddingInviteCustomisations)
          .where(eq(weddingInviteCustomisations.weddingId, weddingId))
          .all(),
      );

      const newKey = yield* storeAsset(weddingId, slot, bytes, contentType);
      const now = new Date();
      const keyColumn = slot === "hero" ? "heroImageKey" : "storyImageKey";

      yield* dbQuery(() =>
        db
          .insert(weddingInviteCustomisations)
          .values({ weddingId, [keyColumn]: newKey, updatedAt: now })
          .onConflictDoUpdate({
            target: weddingInviteCustomisations.weddingId,
            set: { [keyColumn]: newKey, updatedAt: now },
          })
          .run(),
      );

      // Best-effort: orphaning the old object is recoverable; failing the upload
      // because cleanup hiccuped is not worth it.
      if (existing?.key) {
        yield* deleteAsset(existing.key).pipe(
          Effect.catchAll((e) =>
            Effect.logWarning("invite image cleanup failed", { weddingId, reason: e.reason }),
          ),
        );
      }

      yield* Effect.logInfo("invite image uploaded", { weddingId });
      return imagePath(slug, slot, now.getTime());
    }).pipe(Effect.withSpan("cire.invite.setImage"));
  },

  /** Clear a slot's image (reset to default) and delete the object best-effort. */
  removeImage(
    weddingId: string,
    slot: InviteImageSlot,
  ): Effect.Effect<void, never, DbService | AssetsR2Service> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      const column =
        slot === "hero"
          ? weddingInviteCustomisations.heroImageKey
          : weddingInviteCustomisations.storyImageKey;
      const keyColumn = slot === "hero" ? "heroImageKey" : "storyImageKey";

      const [existing] = yield* dbQuery(() =>
        db
          .select({ key: column })
          .from(weddingInviteCustomisations)
          .where(eq(weddingInviteCustomisations.weddingId, weddingId))
          .all(),
      );

      yield* dbQuery(() =>
        db
          .update(weddingInviteCustomisations)
          .set({ [keyColumn]: null, updatedAt: new Date() })
          .where(eq(weddingInviteCustomisations.weddingId, weddingId))
          .run(),
      );

      if (existing?.key) {
        yield* deleteAsset(existing.key).pipe(
          Effect.catchAll((e) =>
            Effect.logWarning("invite image cleanup failed", { weddingId, reason: e.reason }),
          ),
        );
      }
      yield* Effect.logInfo("invite image removed", { weddingId });
    }).pipe(Effect.withSpan("cire.invite.removeImage"));
  },
};
