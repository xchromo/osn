import { describe, it, expect } from "bun:test";

import {
  BOOTSTRAP_WEDDING_ID,
  families,
  registryClaims,
  registryContributions,
  registryItems,
} from "@cire/db";
import { Effect, Logger, LogLevel } from "effect";

import type { Db } from "../db";
import { DbService } from "../db";
import { TestDbLayer } from "../db/test-layer";
import { effWith } from "../test-helpers";
import { MAX_GIFT_EXPORT_ROWS, giftExportService } from "./gift-export";

const withDb = effWith(TestDbLayer);

/** Split a CSV document into lines (CRLF, per RFC 4180). */
const lines = (csv: string) => csv.split("\r\n");

/** Fixed clock for the seeds — column order is asserted, so it must be stable. */
const at = (minutes: number) => new Date(Date.UTC(2026, 7, 20, 10, minutes, 0));

/**
 * One household and one gift-list item on the bootstrap wedding.
 *
 * The seed's own families carry generated ids (`setup.ts` uses
 * `crypto.randomUUID()`), so a test that needs to name a family in an assertion
 * has to insert its own.
 */
function seedHousehold(db: Db) {
  db.insert(families)
    .values({
      id: "fam_gifts",
      weddingId: BOOTSTRAP_WEDDING_ID,
      publicId: "GIFT-AAA-0001",
      familyName: "Marchetti",
      createdAt: at(0),
      updatedAt: at(0),
    })
    .run();
  db.insert(registryItems)
    .values({
      id: "ritem_pan",
      weddingId: BOOTSTRAP_WEDDING_ID,
      title: "Copper Pan",
      createdAt: at(0),
      updatedAt: at(0),
    })
    .run();
}

describe("giftExportService.giftsCsv", () => {
  it(
    "writes the header alone when the wedding has no gifts",
    withDb(
      Effect.gen(function* () {
        const csv = yield* giftExportService.giftsCsv(BOOTSTRAP_WEDDING_ID);
        expect(lines(csv)).toEqual([
          "Kind,Item,Household Code,Household,Given As,Quantity,Status,Note,Amount,Currency,Amount In Your Currency,Your Currency,Exchange Rate,Thanked At,Received At",
        ]);
      }),
    ),
  );

  it(
    "merges claims and cash gifts newest-first, with amounts as bare decimals",
    withDb(
      Effect.gen(function* () {
        const db = yield* DbService;
        seedHousehold(db);
        db.insert(registryClaims)
          .values({
            id: "rclaim_pan",
            weddingId: BOOTSTRAP_WEDDING_ID,
            itemId: "ritem_pan",
            familyId: "fam_gifts",
            quantity: 2,
            status: "purchased",
            note: "Bought the pair",
            displayName: "Auntie Ros",
            createdAt: at(1),
            updatedAt: at(1),
          })
          .run();
        db.insert(registryContributions)
          .values({
            id: "rcon_cash",
            weddingId: BOOTSTRAP_WEDDING_ID,
            familyId: "fam_gifts",
            status: "succeeded",
            amountMinor: 12_500,
            currency: "AUD",
            message: "For the honeymoon",
            createdAt: at(2),
            updatedAt: at(2),
          })
          .run();

        const rows = lines(yield* giftExportService.giftsCsv(BOOTSTRAP_WEDDING_ID));
        expect(rows).toHaveLength(3);
        // Newest first: the cash gift landed a minute after the claim.
        expect(rows[1]).toBe(
          "Cash gift,,GIFT-AAA-0001,Marchetti,,,succeeded,For the honeymoon,125.00,AUD,,,,,2026-08-20T10:02:00.000Z",
        );
        expect(rows[2]).toBe(
          "Gift list,Copper Pan,GIFT-AAA-0001,Marchetti,Auntie Ros,2,purchased,Bought the pair,,,,,,,2026-08-20T10:01:00.000Z",
        );
      }),
    ),
  );

  it(
    "drops failed contributions but keeps refunded ones",
    withDb(
      Effect.gen(function* () {
        const db = yield* DbService;
        seedHousehold(db);
        db.insert(registryContributions)
          .values([
            {
              id: "rcon_failed",
              weddingId: BOOTSTRAP_WEDDING_ID,
              familyId: "fam_gifts",
              status: "failed",
              amountMinor: 5000,
              currency: "AUD",
              message: "Card declined here",
              createdAt: at(1),
              updatedAt: at(1),
            },
            {
              id: "rcon_refunded",
              weddingId: BOOTSTRAP_WEDDING_ID,
              familyId: "fam_gifts",
              status: "refunded",
              amountMinor: 5000,
              currency: "AUD",
              message: "Sent back later",
              createdAt: at(2),
              updatedAt: at(2),
            },
          ])
          .run();

        const csv = yield* giftExportService.giftsCsv(BOOTSTRAP_WEDDING_ID);
        expect(csv).toContain("Sent back later");
        expect(csv).not.toContain("Card declined here");
      }),
    ),
  );

  it(
    "reads the minor-unit exponent per currency and fills the FX columns",
    withDb(
      Effect.gen(function* () {
        const db = yield* DbService;
        seedHousehold(db);
        db.insert(registryContributions)
          .values({
            id: "rcon_yen",
            weddingId: BOOTSTRAP_WEDDING_ID,
            itemId: "ritem_pan",
            familyId: "fam_gifts",
            status: "succeeded",
            // JPY has no minor unit: 20000 minor units is ¥20,000, not ¥200.
            amountMinor: 20_000,
            currency: "JPY",
            primaryAmountMinor: 20_400,
            primaryCurrency: "AUD",
            fxRate: "0.0102",
            createdAt: at(1),
            updatedAt: at(1),
          })
          .run();

        const row = lines(yield* giftExportService.giftsCsv(BOOTSTRAP_WEDDING_ID))[1]!;
        const cells = row.split(",");
        expect(cells[1]).toBe("Copper Pan");
        expect(cells[8]).toBe("20000");
        expect(cells[9]).toBe("JPY");
        expect(cells[10]).toBe("204.00");
        expect(cells[11]).toBe("AUD");
        expect(cells[12]).toBe("0.0102");
      }),
    ),
  );

  it(
    "scopes the export to one wedding",
    withDb(
      Effect.gen(function* () {
        const db = yield* DbService;
        seedHousehold(db);
        db.insert(registryContributions)
          .values({
            id: "rcon_mine",
            weddingId: BOOTSTRAP_WEDDING_ID,
            familyId: "fam_gifts",
            status: "succeeded",
            amountMinor: 1000,
            currency: "AUD",
            message: "Ours",
            createdAt: at(1),
            updatedAt: at(1),
          })
          .run();

        const csv = yield* giftExportService.giftsCsv("wed_someone_else");
        expect(lines(csv)).toHaveLength(1);
      }),
    ),
  );

  it(
    "caps the export at the ceiling and warns rather than truncating in silence",
    withDb(
      Effect.gen(function* () {
        const db = yield* DbService;
        seedHousehold(db);
        const overflow = MAX_GIFT_EXPORT_ROWS + 1;
        // One statement per chunk keeps every insert under SQLite's 999
        // bound-variable ceiling.
        const chunk = 100;
        for (let start = 0; start < overflow; start += chunk) {
          const values = Array.from({ length: Math.min(chunk, overflow - start) }, (_, i) => ({
            id: `rcon_bulk_${start + i}`,
            weddingId: BOOTSTRAP_WEDDING_ID,
            familyId: "fam_gifts",
            status: "succeeded" as const,
            amountMinor: 100,
            currency: "AUD",
            createdAt: at(1),
            updatedAt: at(1),
          }));
          db.insert(registryContributions).values(values).run();
        }

        const warnings: string[] = [];
        const capture = Logger.replace(
          Logger.defaultLogger,
          Logger.make(({ logLevel, message }) => {
            if (logLevel === LogLevel.Warning) warnings.push(String(message));
          }),
        );
        const csv = yield* giftExportService
          .giftsCsv(BOOTSTRAP_WEDDING_ID)
          .pipe(Effect.provide(capture));

        expect(lines(csv)).toHaveLength(MAX_GIFT_EXPORT_ROWS + 1);
        expect(warnings.join(" ")).toContain("exceeds the export ceiling");
      }),
    ),
  );
});
