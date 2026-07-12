import { describe, it, expect } from "bun:test";

import { BOOTSTRAP_WEDDING_ID, events, families, guests } from "@cire/db";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { DbService } from "../db";
import { TestDbLayer } from "../db/test-layer";
import type { ParsedFamily } from "../schemas/import";
import { effWith } from "../test-helpers";
import { diffAgainstDb } from "./import";
import { parseEventsCsv, parseGuestsCsv } from "./spreadsheet";
import { stateExportService } from "./state-export";

const withDb = effWith(TestDbLayer);

/** Split a CSV document into lines (CRLF, per RFC 4180). */
const lines = (csv: string) => csv.split("\r\n");

describe("stateExportService.eventsCsv", () => {
  it(
    "writes the exact import-template header row",
    withDb(
      Effect.gen(function* () {
        const csv = yield* stateExportService.eventsCsv(BOOTSTRAP_WEDDING_ID);
        // Byte-for-byte lockstep with the organiser template + parser — a
        // rename in lib/sheet-headers.ts must fail here.
        expect(lines(csv)[0]).toBe(
          "Event Name,Start,Timezone,End,Location,Address,Dress Code Description,Dress Code Palette,Pinterest URL,Maps URL",
        );
      }),
    ),
  );

  it(
    "exports one row per event in sortOrder order with palette cells in sheet format",
    withDb(
      Effect.gen(function* () {
        const db = yield* DbService;
        const seeded = db
          .select({ name: events.name, sortOrder: events.sortOrder })
          .from(events)
          .where(eq(events.weddingId, BOOTSTRAP_WEDDING_ID))
          .all()
          .toSorted((a, b) => a.sortOrder - b.sortOrder);

        const csv = yield* stateExportService.eventsCsv(BOOTSTRAP_WEDDING_ID);
        const rows = lines(csv).slice(1);
        expect(rows).toHaveLength(seeded.length);
        seeded.forEach((e, i) => {
          // Quoted-cell safe: just assert the row leads with the name.
          expect(rows[i]!.startsWith(e.name) || rows[i]!.startsWith(`"${e.name}`)).toBe(true);
        });
        // Palette cells (when present) use the sheet's Name:#rgb|Name:#rgb form,
        // never raw JSON.
        expect(csv).not.toContain('[{"name"');
      }),
    ),
  );

  it(
    "appends the Event ID column under fidelity=full",
    withDb(
      Effect.gen(function* () {
        const csv = yield* stateExportService.eventsCsv(BOOTSTRAP_WEDDING_ID, "full");
        expect(lines(csv)[0]!.endsWith(",Event ID")).toBe(true);
        const db = yield* DbService;
        const [anyEvent] = db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.weddingId, BOOTSTRAP_WEDDING_ID))
          .all();
        expect(csv).toContain(anyEvent!.id);
      }),
    ),
  );
});

describe("stateExportService.guestsCsv", () => {
  it(
    "writes the fixed + nickname headers then one column per event, and neutral fam-NNN ids",
    withDb(
      Effect.gen(function* () {
        const csv = yield* stateExportService.guestsCsv(BOOTSTRAP_WEDDING_ID);
        const header = lines(csv)[0]!;
        expect(
          header.startsWith(
            "Family ID,Family Name,Guest First Name,Guest Last Name,Guest Nickname,",
          ),
        ).toBe(true);
        // Standard fidelity: neutral grouping keys, NO claim codes, no UUIDs.
        expect(lines(csv)[1]!.startsWith("fam-001,")).toBe(true);
        const db = yield* DbService;
        const codes = db
          .select({ publicId: families.publicId })
          .from(families)
          .where(eq(families.weddingId, BOOTSTRAP_WEDDING_ID))
          .all();
        for (const c of codes) expect(csv).not.toContain(c.publicId);
      }),
    ),
  );

  it(
    "appends Family Code + Guest ID under fidelity=full and uses internal family ids",
    withDb(
      Effect.gen(function* () {
        const csv = yield* stateExportService.guestsCsv(BOOTSTRAP_WEDDING_ID, "full");
        expect(lines(csv)[0]!.endsWith(",Family Code,Guest ID")).toBe(true);
        const db = yield* DbService;
        const fams = db
          .select({ id: families.id, publicId: families.publicId })
          .from(families)
          .where(eq(families.weddingId, BOOTSTRAP_WEDDING_ID))
          .all();
        for (const f of fams) {
          expect(csv).toContain(f.id);
          expect(csv).toContain(f.publicId);
        }
      }),
    ),
  );

  it(
    "excludes host-preview families",
    withDb(
      Effect.gen(function* () {
        const db = yield* DbService;
        const now = new Date();
        db.insert(families)
          .values({
            id: "fam_host",
            weddingId: BOOTSTRAP_WEDDING_ID,
            publicId: "HOST-AAAA",
            familyName: "Wedding Host",
            kind: "host",
            createdAt: now,
            updatedAt: now,
          })
          .run();
        db.insert(guests)
          .values({
            id: "gst_host",
            familyId: "fam_host",
            firstName: "Hosty",
            lastName: "McHost",
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const csv = yield* stateExportService.guestsCsv(BOOTSTRAP_WEDDING_ID, "full");
        expect(csv).not.toContain("Hosty");
        expect(csv).not.toContain("HOST-AAAA");
      }),
    ),
  );
});

describe("round trip: export → parse → diff is a fixpoint", () => {
  const assertFixpoint = (fidelity: "import" | "full") =>
    withDb(
      Effect.gen(function* () {
        const eventsCsv = yield* stateExportService.eventsCsv(BOOTSTRAP_WEDDING_ID, fidelity);
        const guestsCsv = yield* stateExportService.guestsCsv(BOOTSTRAP_WEDDING_ID, fidelity);

        // The exported sheets must parse with the REAL import parser…
        const parsedEvents = yield* parseEventsCsv(eventsCsv);
        const parsedFamilies = yield* parseGuestsCsv(guestsCsv, parsedEvents);

        // …and reconciling them against the DB they came from must change
        // nothing: no creates, no removes, no guest/link deltas. (The diff
        // unconditionally emits an idempotent eventUpdate per matched event —
        // assert the values are identical instead of the list being empty.)
        const plan = yield* diffAgainstDb(
          parsedEvents,
          parsedFamilies as ParsedFamily[],
          BOOTSTRAP_WEDDING_ID,
        );
        expect(plan.eventCreates).toHaveLength(0);
        expect(plan.eventRemoves).toHaveLength(0);
        expect(plan.familyCreates).toHaveLength(0);
        expect(plan.familyRemoves).toHaveLength(0);
        expect(plan.guestCreates).toHaveLength(0);
        expect(plan.guestUpdates).toHaveLength(0);
        expect(plan.guestRemoves).toHaveLength(0);
        expect(plan.eventLinkCreates).toHaveLength(0);
        expect(plan.eventLinkRemoves).toHaveLength(0);
        expect(plan.warnings).toHaveLength(0);

        const db = yield* DbService;
        for (const eu of plan.eventUpdates) {
          const [row] = db.select().from(events).where(eq(events.id, eu.id)).all();
          expect(eu.event.name).toBe(row!.name);
          expect(eu.event.startAt).toBe(row!.startAt);
          expect(eu.event.endAt).toBe(row!.endAt);
          expect(eu.event.timezone).toBe(row!.timezone);
          expect(eu.event.address ?? null).toBe(row!.address);
          expect(eu.event.dressCodeDescription ?? null).toBe(row!.dressCodeDescription);
          expect(JSON.stringify(eu.event.dressCodePalette)).toBe(row!.dressCodePalette);
          expect(eu.event.sortOrder).toBe(row!.sortOrder);
        }
      }),
    );

  it("holds at import fidelity", assertFixpoint("import"));
  // fidelity=full adds the ID/code columns — the parser must accept-and-ignore
  // them (they are fixed columns, never mistaken for event columns).
  it("holds at full fidelity", assertFixpoint("full"));
});
