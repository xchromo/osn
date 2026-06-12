import { describe, it, expect } from "bun:test";

import { families, guests, weddings } from "@cire/db";
import { Effect } from "effect";

import { DbService, type Db } from "../db";
import { createDb } from "../db/setup";
import { accountLinkService } from "./account-link";

const now = new Date();

/** Bare two-family fixture across two weddings — no JSON seed needed. */
function fixture(): Db {
  const db = createDb(":memory:");
  const seedWedding = (id: string, slug: string) =>
    db
      .insert(weddings)
      .values({
        id,
        slug,
        displayName: id,
        ownerOsnProfileId: "usr_owner",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  const seedFamily = (id: string, weddingId: string, publicId: string) =>
    db
      .insert(families)
      .values({ id, weddingId, publicId, familyName: id, createdAt: now, updatedAt: now })
      .run();
  const seedGuest = (id: string, familyId: string) =>
    db
      .insert(guests)
      .values({
        id,
        familyId,
        firstName: id,
        lastName: "X",
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

  seedWedding("wed_a", "wed-a");
  seedWedding("wed_b", "wed-b");
  seedFamily("fam_a", "wed_a", "AAA-AAA-0001");
  seedFamily("fam_b", "wed_b", "BBB-BBB-0002");
  seedGuest("gst_a1", "fam_a");
  seedGuest("gst_a2", "fam_a");
  seedGuest("gst_b1", "fam_b");
  return db;
}

const run = <A, E>(db: Db, eff: Effect.Effect<A, E, DbService>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provideService(DbService, db)));

describe("accountLinkService.link", () => {
  it("derives the wedding id from the guest's family", async () => {
    const db = fixture();
    await run(
      db,
      accountLinkService.link({
        familyId: "fam_a",
        guestId: "gst_a1",
        osnAccountId: "acc_1",
        osnProfileId: "usr_1",
      }),
    );
    const links = await run(db, accountLinkService.listByAccount("acc_1"));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ guestId: "gst_a1", familyId: "fam_a", weddingId: "wed_a" });
  });

  it("fails GuestNotInFamily when the guest is in a different family", async () => {
    const db = fixture();
    const exit = await Effect.runPromiseExit(
      accountLinkService
        .link({
          familyId: "fam_a",
          guestId: "gst_b1",
          osnAccountId: "acc_1",
          osnProfileId: "usr_1",
        })
        .pipe(Effect.provideService(DbService, db)),
    );
    expect(exit._tag).toBe("Failure");
  });
});

describe("accountLinkService.listByAccount", () => {
  it("returns every linked invitee for an account across weddings", async () => {
    const db = fixture();
    await run(
      db,
      accountLinkService.link({
        familyId: "fam_a",
        guestId: "gst_a1",
        osnAccountId: "acc_shared",
        osnProfileId: "usr_1",
      }),
    );
    await run(
      db,
      accountLinkService.link({
        familyId: "fam_b",
        guestId: "gst_b1",
        osnAccountId: "acc_shared",
        osnProfileId: "usr_1",
      }),
    );

    const links = await run(db, accountLinkService.listByAccount("acc_shared"));
    expect(links.map((l) => l.weddingId).toSorted()).toEqual(["wed_a", "wed_b"]);
    expect(await run(db, accountLinkService.listByAccount("acc_none"))).toHaveLength(0);
  });
});

describe("accountLinkService.unlink", () => {
  it("is idempotent and household-scoped", async () => {
    const db = fixture();
    await run(
      db,
      accountLinkService.link({
        familyId: "fam_a",
        guestId: "gst_a1",
        osnAccountId: "acc_1",
        osnProfileId: "usr_1",
      }),
    );
    // Wrong family can't remove it.
    await run(db, accountLinkService.unlink({ familyId: "fam_b", guestId: "gst_a1" }));
    expect(await run(db, accountLinkService.listByFamily("fam_a"))).toHaveLength(1);

    // Correct family removes it; a second removal still succeeds.
    await run(db, accountLinkService.unlink({ familyId: "fam_a", guestId: "gst_a1" }));
    await run(db, accountLinkService.unlink({ familyId: "fam_a", guestId: "gst_a1" }));
    expect(await run(db, accountLinkService.listByFamily("fam_a"))).toHaveLength(0);
  });
});
