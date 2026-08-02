import { describe, it, expect } from "bun:test";

import { BOOTSTRAP_WEDDING_ID, families, guests, guestEvents } from "@cire/db";
import { Effect, Layer } from "effect";

import { DbService } from "../db";
import type { Db } from "../db";
import { createDb, seedBootstrapWedding } from "../db/setup";
import type { ParsedEvent, ParsedFamily } from "../schemas/import";
import { applyImport, diffAgainstDb } from "./import";

/**
 * ROW IDENTITY in the reconcile diff — which desired row means which existing
 * row, and (the part these tests exist for) which existing rows are therefore
 * DELETIONS.
 *
 * The guest editor posts its whole draft as a DesiredState, so a deletion is
 * expressed by absence: the dropped row simply isn't there. Anything that makes
 * an existing guest unreachable to the removal scan, or lets a surviving desired
 * row adopt the dropped one, silently swallows the deletion — the organiser
 * deletes a guest, the plan says "0 removed", and the guest is back on reload.
 * That is the bug class pinned here.
 */

function freshDb(): { db: Db; layer: Layer.Layer<DbService> } {
  const db = createDb(":memory:");
  seedBootstrapWedding(db);
  return { db, layer: Layer.succeed(DbService, db) };
}

const CEREMONY: ParsedEvent = {
  name: "Ceremony",
  startAt: "2026-11-14T15:00:00+11:00",
  endAt: "",
  timezone: "Australia/Sydney",
  location: null,
  address: null,
  dressCodeDescription: null,
  dressCodePalette: [],
  pinterestUrl: null,
  mapsUrl: null,
  sortOrder: 0,
};

function guest(firstName: string, lastName: string, id?: string) {
  return {
    ...(id ? { id } : {}),
    firstName,
    lastName,
    nickname: null,
    eventNames: ["Ceremony"],
  };
}

/** Seed one household straight from a desired state, then read back its rows. */
async function seedHousehold(
  layer: Layer.Layer<DbService>,
  db: Db,
  familyName: string,
  members: { firstName: string; lastName: string }[],
) {
  const desired: ParsedFamily[] = [
    { familyName, guests: members.map((m) => guest(m.firstName, m.lastName)) },
  ];
  await Effect.runPromise(
    Effect.gen(function* () {
      const plan = yield* diffAgainstDb([CEREMONY], desired, BOOTSTRAP_WEDDING_ID);
      yield* applyImport("seed", plan, BOOTSTRAP_WEDDING_ID);
    }).pipe(Effect.provide(layer)),
  );
  const family = db.select().from(families).all()[0]!;
  const rows = db.select().from(guests).all();
  return { family, rows };
}

describe("diffAgainstDb — a guest whose first name collides with a sibling's", () => {
  /**
   * Two guests in one household CAN normalise to the same first name (a sheet
   * carrying "Sam" and "sam ", a household of two "Guest"s). The per-family
   * collection the removal scan reads used to be keyed by that normalised name,
   * so one of the two was shadowed out of it entirely: dropping that guest from
   * the desired state emitted NO removal at all, and the editor's delete was a
   * silent no-op.
   */
  it("emits a removal for the shadowed duplicate, not for its twin", async () => {
    const { db, layer } = freshDb();
    const { family, rows } = await seedHousehold(layer, db, "Sharma", [
      { firstName: "Sam", lastName: "Sharma" },
      { firstName: "sam ", lastName: "Lee" },
    ]);
    expect(rows).toHaveLength(2);
    const shadowed = rows.find((r) => r.lastName === "Sharma")!;
    const kept = rows.find((r) => r.lastName === "Lee")!;

    // The editor drops the FIRST Sam and keeps the second, ids and all.
    const desired: ParsedFamily[] = [
      {
        id: family.id,
        publicId: family.publicId,
        familyName: "Sharma",
        guests: [guest(kept.firstName, kept.lastName, kept.id)],
      },
    ];
    const plan = await Effect.runPromise(
      diffAgainstDb([{ ...CEREMONY }], desired, BOOTSTRAP_WEDDING_ID, {
        removeManual: true,
        matchByName: false,
      }).pipe(Effect.provide(layer)),
    );

    expect(plan.guestRemoves.map((g) => g.id)).toEqual([shadowed.id]);
  });

  it("re-importing a duplicate-name roster is a no-op, and each twin keeps its own links", async () => {
    const { db, layer } = freshDb();
    const { family } = await seedHousehold(layer, db, "Sharma", [
      { firstName: "Sam", lastName: "Sharma" },
      { firstName: "sam", lastName: "Lee" },
    ]);

    // Both were invited to the Ceremony, and both links must survive: the link
    // pass used to resolve BOTH parsed rows to one guest id, so one twin
    // collected two links and the other's was diffed away.
    expect(db.select().from(guestEvents).all()).toHaveLength(2);

    // The same sheet again — id-less, matched by name, exactly as a re-upload.
    const desired: ParsedFamily[] = [
      {
        familyName: family.familyName,
        guests: [guest("Sam", "Sharma"), guest("sam", "Lee")],
      },
    ];
    const plan = await Effect.runPromise(
      diffAgainstDb([{ ...CEREMONY }], desired, BOOTSTRAP_WEDDING_ID).pipe(Effect.provide(layer)),
    );

    expect(plan.guestRemoves).toHaveLength(0);
    expect(plan.guestCreates).toHaveLength(0);
    expect(plan.eventLinkCreates).toHaveLength(0);
    expect(plan.eventLinkRemoves).toHaveLength(0);
  });
});

describe("diffAgainstDb — matchByName: false (the editor front door)", () => {
  /**
   * The editor's draft is built from server rows, so it carries an id for every
   * row that exists. An id-less row therefore means "just added" — and adopting
   * a same-named existing row instead cancelled the deletion of that row AND
   * handed the new guest the deleted one's RSVPs.
   */
  it("a new guest with a deleted guest's name is a remove + create, not an update", async () => {
    const { db, layer } = freshDb();
    const { family, rows } = await seedHousehold(layer, db, "Sharma", [
      { firstName: "Ada", lastName: "Sharma" },
      { firstName: "Bob", lastName: "Sharma" },
    ]);
    const ada = rows.find((r) => r.firstName === "Ada")!;
    const bob = rows.find((r) => r.firstName === "Bob")!;

    // Delete Bob; add a different Bob (no id — a brand-new row).
    const desired: ParsedFamily[] = [
      {
        id: family.id,
        publicId: family.publicId,
        familyName: "Sharma",
        guests: [guest("Ada", "Sharma", ada.id), guest("Bob", "Newman")],
      },
    ];
    const plan = await Effect.runPromise(
      diffAgainstDb([{ ...CEREMONY }], desired, BOOTSTRAP_WEDDING_ID, {
        removeManual: true,
        matchByName: false,
      }).pipe(Effect.provide(layer)),
    );

    expect(plan.guestRemoves.map((g) => g.id)).toEqual([bob.id]);
    expect(plan.guestCreates.map((g) => g.lastName)).toEqual(["Newman"]);
  });

  it("a new household with a deleted household's name is a remove + create", async () => {
    const { db, layer } = freshDb();
    const { family } = await seedHousehold(layer, db, "Sharma", [
      { firstName: "Ada", lastName: "Sharma" },
    ]);

    const desired: ParsedFamily[] = [{ familyName: "Sharma", guests: [guest("Zoe", "Sharma")] }];
    const plan = await Effect.runPromise(
      diffAgainstDb([{ ...CEREMONY }], desired, BOOTSTRAP_WEDDING_ID, {
        removeManual: true,
        matchByName: false,
      }).pipe(Effect.provide(layer)),
    );

    expect(plan.familyRemoves.map((f) => f.id)).toEqual([family.id]);
    expect(plan.familyCreates).toHaveLength(1);
  });

  it("a CSV upload still matches by name (the flag defaults off)", async () => {
    const { db, layer } = freshDb();
    const { family } = await seedHousehold(layer, db, "Sharma", [
      { firstName: "Ada", lastName: "Sharma" },
    ]);

    // Same household + guest by NAME only, no ids anywhere — the sheet shape.
    const desired: ParsedFamily[] = [
      { familyName: "Sharma", guests: [guest("Ada", "Sharma-Lee")] },
    ];
    const plan = await Effect.runPromise(
      diffAgainstDb([{ ...CEREMONY }], desired, BOOTSTRAP_WEDDING_ID).pipe(Effect.provide(layer)),
    );

    expect(plan.familyCreates).toHaveLength(0);
    expect(plan.familyRemoves).toHaveLength(0);
    expect(plan.guestRemoves).toHaveLength(0);
    expect(plan.guestUpdates.map((g) => g.lastName)).toEqual(["Sharma-Lee"]);
    expect(db.select().from(families).all()[0]!.id).toBe(family.id);
  });
});

describe("diffAgainstDb — an existing row is claimed by at most one desired row", () => {
  /**
   * Two desired households that resolve to ONE existing row used to reconcile
   * against that row's guest list twice in a row, and the second pass removed
   * every guest the first pass had just matched.
   */
  it("a second household with the same name creates rather than re-claiming", async () => {
    const { db, layer } = freshDb();
    await seedHousehold(layer, db, "Smith", [
      { firstName: "Ada", lastName: "Smith" },
      { firstName: "Bob", lastName: "Smith" },
    ]);

    const desired: ParsedFamily[] = [
      { familyName: "Smith", guests: [guest("Ada", "Smith")] },
      { familyName: "Smith", guests: [guest("Bob", "Smith")] },
    ];
    const plan = await Effect.runPromise(
      diffAgainstDb([{ ...CEREMONY }], desired, BOOTSTRAP_WEDDING_ID, { removeManual: true }).pipe(
        Effect.provide(layer),
      ),
    );

    // The second "Smith" becomes its own household; Bob moves into it. What must
    // NOT happen is the pair of passes deleting each other's guests.
    expect(plan.familyCreates).toHaveLength(1);
    expect(plan.familyRemoves).toHaveLength(0);
    expect(plan.guestRemoves.map((g) => g.firstName)).toEqual(["Bob"]);
    expect(plan.guestCreates.map((g) => g.firstName)).toEqual(["Bob"]);
  });
});
