import { families, registryClaims, registryContributions, registryItems } from "@cire/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { Effect } from "effect";

import { DbService, dbQuery } from "../db";
import { serialiseCsv } from "../lib/csv";
import { minorToDecimal } from "../lib/money";

/**
 * Row ceiling on one gift export.
 *
 * The gift log is unbounded in principle — every household may claim every item
 * and send cash on top — and the portal answers that with paging
 * (`registryService.giftLog`). An export cannot page: the whole point of the
 * download is that it is the whole record. So it is bounded instead, well above
 * any real wedding (a 400-household guest list at ten gifts a household is
 * 4,000 rows), and a read that hits the ceiling is LOGGED rather than silently
 * truncated — a portability answer that quietly drops rows is worse than no
 * answer at all.
 */
export const MAX_GIFT_EXPORT_ROWS = 5000;

/** One gift, already flattened into the columns the CSV prints. */
interface GiftRow {
  kind: "Gift list" | "Cash gift";
  itemTitle: string | null;
  publicId: string;
  familyName: string;
  displayName: string | null;
  quantity: number | null;
  status: string;
  note: string | null;
  amountMinor: number | null;
  currency: string | null;
  primaryAmountMinor: number | null;
  primaryCurrency: string | null;
  fxRate: string | null;
  thankedAt: Date | null;
  createdAt: Date;
}

const iso = (at: Date | null): string => (at ? at.toISOString() : "");

/**
 * The couple's gift log as a CSV download — the third organiser export, and the
 * one that answers a data-portability request (C-L1). The portal shows this log
 * a page at a time and keeps it for a year; the export is how the couple take
 * the detail with them before the retention sweep folds it into totals.
 *
 * Reads the same two tables as `registryService.giftLog`, with the same shape
 * deliberately: the same `failed`-contributions exclusion (S-M2 — money that
 * never moved is not a gift, while a `refunded` gift did happen and stays
 * visible), the same LEFT join for cash gifts that have no item, and NO
 * host-family exclusion, because the export must contain exactly what the
 * portal shows and nothing else.
 *
 * Amounts are printed as bare major-unit decimals with the currency in its own
 * column — a spreadsheet can sum a number, not "$12.50" — and the primary
 * -currency columns carry the equivalent snapshotted at charge time, blank for a
 * gift that already arrived in the wedding's own currency.
 */
export const giftExportService = {
  giftsCsv(weddingId: string): Effect.Effect<string, never, DbService> {
    return Effect.gen(function* () {
      const db = yield* DbService;
      // One over the ceiling, so the truncation warning below fires on the row
      // that would have been dropped rather than on the last one kept.
      const readAhead = MAX_GIFT_EXPORT_ROWS + 1;

      // The two reads are independently wedding-scoped — collapse them to one
      // D1 round-trip (RT-P-I1; matches the parallel shape in table-export.ts).
      const [claimRows, contributionRows] = yield* Effect.all(
        [
          dbQuery(() =>
            db
              .select({
                id: registryClaims.id,
                itemTitle: registryItems.title,
                publicId: families.publicId,
                familyName: families.familyName,
                displayName: registryClaims.displayName,
                quantity: registryClaims.quantity,
                status: registryClaims.status,
                note: registryClaims.note,
                thankedAt: registryClaims.thankedAt,
                createdAt: registryClaims.createdAt,
              })
              .from(registryClaims)
              .innerJoin(registryItems, eq(registryClaims.itemId, registryItems.id))
              .innerJoin(families, eq(registryClaims.familyId, families.id))
              .where(eq(registryClaims.weddingId, weddingId))
              .orderBy(desc(registryClaims.createdAt))
              .limit(readAhead)
              .all(),
          ),
          dbQuery(() =>
            db
              .select({
                id: registryContributions.id,
                itemTitle: registryItems.title,
                publicId: families.publicId,
                familyName: families.familyName,
                displayName: registryContributions.displayName,
                status: registryContributions.status,
                note: registryContributions.message,
                amountMinor: registryContributions.amountMinor,
                currency: registryContributions.currency,
                primaryAmountMinor: registryContributions.primaryAmountMinor,
                primaryCurrency: registryContributions.primaryCurrency,
                fxRate: registryContributions.fxRate,
                thankedAt: registryContributions.thankedAt,
                createdAt: registryContributions.createdAt,
              })
              .from(registryContributions)
              // LEFT: a general cash gift has no item, and an item deleted after
              // the fact sets `item_id` NULL rather than erasing the gift.
              .leftJoin(registryItems, eq(registryContributions.itemId, registryItems.id))
              .innerJoin(families, eq(registryContributions.familyId, families.id))
              .where(
                and(
                  eq(registryContributions.weddingId, weddingId),
                  ne(registryContributions.status, "failed"),
                ),
              )
              .orderBy(desc(registryContributions.createdAt))
              .limit(readAhead)
              .all(),
          ),
        ],
        { concurrency: 2 },
      );

      const claims: GiftRow[] = (
        claimRows as Array<{
          itemTitle: string;
          publicId: string;
          familyName: string;
          displayName: string | null;
          quantity: number;
          status: string;
          note: string | null;
          thankedAt: Date | null;
          createdAt: Date;
        }>
      ).map((r) => ({
        kind: "Gift list" as const,
        itemTitle: r.itemTitle,
        publicId: r.publicId,
        familyName: r.familyName,
        displayName: r.displayName,
        quantity: r.quantity,
        status: r.status,
        note: r.note,
        amountMinor: null,
        currency: null,
        primaryAmountMinor: null,
        primaryCurrency: null,
        fxRate: null,
        thankedAt: r.thankedAt,
        createdAt: r.createdAt,
      }));

      const contributions: GiftRow[] = (
        contributionRows as Array<{
          itemTitle: string | null;
          publicId: string;
          familyName: string;
          displayName: string | null;
          status: string;
          note: string | null;
          amountMinor: number;
          currency: string;
          primaryAmountMinor: number | null;
          primaryCurrency: string | null;
          fxRate: string | null;
          thankedAt: Date | null;
          createdAt: Date;
        }>
      ).map((r) => ({
        kind: "Cash gift" as const,
        itemTitle: r.itemTitle,
        publicId: r.publicId,
        familyName: r.familyName,
        displayName: r.displayName,
        quantity: null,
        status: r.status,
        note: r.note,
        amountMinor: r.amountMinor,
        currency: r.currency,
        primaryAmountMinor: r.primaryAmountMinor,
        primaryCurrency: r.primaryCurrency,
        fxRate: r.fxRate,
        thankedAt: r.thankedAt,
        createdAt: r.createdAt,
      }));

      // Newest first, the order the portal's log is read in. Sorted in place:
      // `merged` is built here and handed to nobody else, so this is not the
      // shared-array aliasing hazard oxlint's `no-array-sort` guards against.
      const merged: GiftRow[] = [...claims, ...contributions];
      merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      if (merged.length > MAX_GIFT_EXPORT_ROWS) {
        yield* Effect.logWarning("[gift-export] gift log exceeds the export ceiling").pipe(
          Effect.annotateLogs({
            weddingId,
            rows: merged.length,
            exportCap: MAX_GIFT_EXPORT_ROWS,
          }),
        );
      }

      const header = [
        "Kind",
        "Item",
        "Household Code",
        "Household",
        "Given As",
        "Quantity",
        "Status",
        "Note",
        "Amount",
        "Currency",
        "Amount In Your Currency",
        "Your Currency",
        "Exchange Rate",
        "Thanked At",
        "Received At",
      ];
      const rows = merged
        .slice(0, MAX_GIFT_EXPORT_ROWS)
        .map((g) => [
          g.kind,
          g.itemTitle ?? "",
          g.publicId,
          g.familyName,
          g.displayName ?? "",
          g.quantity === null ? "" : String(g.quantity),
          g.status,
          g.note ?? "",
          g.amountMinor === null || g.currency === null
            ? ""
            : minorToDecimal(g.amountMinor, g.currency),
          g.currency ?? "",
          g.primaryAmountMinor === null || g.primaryCurrency === null
            ? ""
            : minorToDecimal(g.primaryAmountMinor, g.primaryCurrency),
          g.primaryCurrency ?? "",
          g.fxRate ?? "",
          iso(g.thankedAt),
          iso(g.createdAt),
        ]);

      return serialiseCsv(header, rows);
    }).pipe(Effect.withSpan("cire.gift-export.giftsCsv"));
  },
};
