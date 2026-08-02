import { describe, it, expect, beforeAll } from "bun:test";

import { BOOTSTRAP_WEDDING_ID, events, families, weddings } from "@cire/db";
import { events as eventsData } from "@cire/db/seed";
import { createRateLimiter } from "@shared/rate-limit";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { createApp } from "../app";
import { createDb, seedDb } from "../db/setup";
import { eff } from "../test-helpers";

interface FamilyMember {
  guestId: string;
  firstName: string;
  lastName: string;
  eventIds: string[];
}

interface ClaimOk {
  familyId: string;
  publicId: string;
  familyName: string;
  members: FamilyMember[];
  events: unknown[];
}

const db = createDb(":memory:");
const app = createApp(db, {
  claimLimiter: createRateLimiter({ maxRequests: 10_000, windowMs: 60_000 }),
});

beforeAll(() => {
  seedDb(db);
});

// Tests simulate the Cloudflare edge by setting `cf-connecting-ip` — the
// fail-closed limiter (C4) denies requests without a resolvable IP, so every
// rate-limited route needs one in tests.
const post = (body: unknown) =>
  Effect.promise(() =>
    app.fetch(
      new Request("http://localhost/api/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "203.0.113.7",
          Origin: "http://localhost:4321",
        },
        body: JSON.stringify(body),
      }),
    ),
  );

describe("POST /api/claim", () => {
  it(
    "returns 400 when fields are missing",
    eff(
      Effect.gen(function* () {
        const res = yield* post({});
        expect(res.status).toBe(400);
        const data = yield* Effect.promise(() => res.json<{ error: string }>());
        expect(data.error).toBe("Missing or invalid fields");
      }),
    ),
  );

  it(
    "returns 400 when publicId is empty",
    eff(
      Effect.gen(function* () {
        const res = yield* post({ publicId: "" });
        expect(res.status).toBe(400);
      }),
    ),
  );

  it(
    "returns 401 for an unknown publicId",
    eff(
      Effect.gen(function* () {
        const res = yield* post({ publicId: "FAKE-XYZ-9999" });
        expect(res.status).toBe(401);
        const data = yield* Effect.promise(() => res.json<{ error: string }>());
        expect(data.error).toBe("Invalid credentials");
      }),
    ),
  );

  it(
    "returns 200 with family details for valid publicId",
    eff(
      Effect.gen(function* () {
        const res = yield* post({ publicId: "TESTONE-IVY-AA11" });
        expect(res.status).toBe(200);
        const data = yield* Effect.promise(() => res.json<ClaimOk>());
        expect(data.familyName).toBe("Testfamily");
        expect(data.members).toHaveLength(1);
        expect(data.members[0]!.firstName).toBe("Ada");
        expect(typeof data.members[0]!.guestId).toBe("string");
        expect(data.members[0]!.eventIds.toSorted()).toEqual(
          [eventsData.catholic.id, eventsData.reception.id, eventsData.hindu.id].toSorted(),
        );
        expect(data.events).toHaveLength(3);
      }),
    ),
  );

  it(
    "returns all five events for the default demo code TESTFOR-JOY-DD44",
    eff(
      Effect.gen(function* () {
        const res = yield* post({ publicId: "TESTFOR-JOY-DD44" });
        expect(res.status).toBe(200);
        const data = yield* Effect.promise(() => res.json<ClaimOk>());
        expect(data.events.map((e) => e.id).toSorted()).toEqual(
          [
            eventsData.catholic.id,
            eventsData["kitchen-tea"].id,
            eventsData.mehendi.id,
            eventsData.hindu.id,
            eventsData.reception.id,
          ].toSorted(),
        );
        expect(data.events.find((e) => e.id === eventsData["kitchen-tea"].id)?.name).toBe(
          "Kitchen Tea",
        );
      }),
    ),
  );

  it(
    "returns 400 when the body is not valid JSON",
    eff(
      Effect.gen(function* () {
        const res = yield* Effect.promise(() =>
          app.fetch(
            new Request("http://localhost/api/claim", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "cf-connecting-ip": "203.0.113.7",
                Origin: "http://localhost:4321",
              },
              body: "{not-json",
            }),
          ),
        );
        expect(res.status).toBe(400);
        const data = yield* Effect.promise(() => res.json<{ error: string }>());
        expect(data.error).toBe("Missing or invalid fields");
      }),
    ),
  );

  it(
    "uppercases the publicId before lookup",
    eff(
      Effect.gen(function* () {
        const res = yield* post({ publicId: "testone-ivy-aa11" });
        expect(res.status).toBe(200);
        const data = yield* Effect.promise(() => res.json<ClaimOk>());
        expect(data.publicId).toBe("TESTONE-IVY-AA11");
      }),
    ),
  );

  it(
    "sets a Set-Cookie session header on a successful claim",
    eff(
      Effect.gen(function* () {
        const res = yield* post({ publicId: "TESTONE-IVY-AA11" });
        expect(res.status).toBe(200);
        const setCookie = res.headers.get("Set-Cookie");
        expect(setCookie).not.toBeNull();
        expect(setCookie).toContain("cire_session=");
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie).toContain("SameSite=Lax");
        expect(setCookie).toContain("Path=/");
        expect(setCookie!.includes("Domain=")).toBe(false);
      }),
    ),
  );

  it(
    "exposes familyId on the claim response",
    eff(
      Effect.gen(function* () {
        const res = yield* post({ publicId: "TESTONE-IVY-AA11" });
        expect(res.status).toBe(200);
        const data = yield* Effect.promise(() => res.json<ClaimOk>());
        expect(typeof data.familyId).toBe("string");
        expect(data.familyId.length).toBeGreaterThan(0);
      }),
    ),
  );
});

// S-C2: the per-IP limiter must gate the real endpoint, not just exist as a
// plugin — a refactor that drops `.use(rateLimitMiddleware(...))` from
// `createClaimRoutes` should fail here.
describe("POST /api/claim rate limiting (S-C2)", () => {
  it("returns 429 with Retry-After once the per-IP limit is exhausted", async () => {
    const rlApp = createApp(db, {
      claimLimiter: createRateLimiter({ maxRequests: 1, windowMs: 60_000 }),
    });
    const send = () =>
      rlApp.fetch(
        new Request("http://localhost/api/claim", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": "203.0.113.7",
            Origin: "http://localhost:4321",
          },
          body: JSON.stringify({ publicId: "FAKE-XYZ-9999" }),
        }),
      );

    const first = await send();
    expect(first.status).toBe(401); // unknown code — but it reached the handler

    const second = await send();
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("60");
  });
});

// migration 0019: each EventSummary carries imageUrl — the first-party path to
// the event's optional image (or null when none). The path's ?v= is the server-
// derived FNV digest of the R2 key, never the timestamp the wedding-slot images
// use (events have no updated_at).
describe("POST /api/claim event imageUrl (migration 0019)", () => {
  it("populates imageUrl for an event with a key, null for the rest", async () => {
    // Point one seeded event at an R2 key directly (no upload needed — the public
    // claim payload only needs the column populated).
    db.update(events)
      .set({ eventImageKey: "assets/wed_bootstrap/event-1234abcd" })
      .where(eq(events.id, eventsData.catholic.id))
      .run();

    const res = await app.fetch(
      new Request("http://localhost/api/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "203.0.113.7",
          Origin: "http://localhost:4321",
        },
        body: JSON.stringify({ publicId: "TESTFOR-JOY-DD44" }),
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      events: { id: string; imageUrl: string | null }[];
    };
    const withImage = data.events.find((e) => e.id === eventsData.catholic.id);
    expect(withImage?.imageUrl).toContain(
      `/api/invite/cire-wedding/event/${eventsData.catholic.id}/image`,
    );
    expect(withImage?.imageUrl).toMatch(/\?v=[0-9a-f]+$/);

    // An event without a key reports null (graceful no-image collapse).
    const noImage = data.events.find((e) => e.id === eventsData.reception.id);
    expect(noImage?.imageUrl).toBeNull();

    // Cleanup so other tests on the shared db see no image.
    db.update(events)
      .set({ eventImageKey: null })
      .where(eq(events.id, eventsData.catholic.id))
      .run();
  });

  // The claim response is the DELIVERY BOUNDARY for the RSVP deadline — the
  // guest site reads it from here, not from the public invite payload. The
  // service's own tests assert what `lookup` returns; this asserts what
  // actually crosses the wire, so a future reshaping of the route's response
  // can't silently stop the deadline reaching guests (the invite would go back
  // to offering an open RSVP form while the server still refused the write).
  it("carries the wedding's RSVP deadline on the claim response", async () => {
    db.update(weddings)
      .set({
        rsvpDeadline: "2999-09-01",
        rsvpDeadlineTimezone: "Australia/Sydney",
        updatedAt: new Date(),
      })
      .where(eq(weddings.id, BOOTSTRAP_WEDDING_ID))
      .run();

    const res = await Effect.runPromise(post({ publicId: "TESTONE-IVY-AA11" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      rsvpDeadline: { date: string; timezone: string; closesAt: string; closed: boolean } | null;
    };
    expect(data.rsvpDeadline).toEqual({
      date: "2999-09-01",
      timezone: "Australia/Sydney",
      // End of the 1st in Sydney — the instant the guest site locks on.
      closesAt: "2999-09-01T13:59:59.999Z",
      closed: false,
    });

    // Cleanup: the suite shares one db, and a leaked deadline would change what
    // every later claim reports.
    db.update(weddings)
      .set({ rsvpDeadline: null, rsvpDeadlineTimezone: null, updatedAt: new Date() })
      .where(eq(weddings.id, BOOTSTRAP_WEDDING_ID))
      .run();
  });

  it("reports no deadline when the wedding has none set", async () => {
    const res = await Effect.runPromise(post({ publicId: "TESTONE-IVY-AA11" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { rsvpDeadline: unknown };
    // Explicitly null on the wire, not absent — the guest site distinguishes
    // "no deadline" from "an older API that doesn't send the field" and treats
    // both as open, but only the first is a promise this endpoint makes.
    expect(data.rsvpDeadline).toBeNull();
  });
});

// ── GET /api/claim/session ────────────────────────────────────────────────────
// The restore read. Its whole job is to hand a household that ALREADY proved
// membership the same payload `POST /api/claim` gives, without a second code
// entry — so the tests below pin both halves: it returns the identical view,
// and it never becomes a second way IN.

describe("GET /api/claim/session", () => {
  const sessionApp = createApp(db, {
    claimLimiter: createRateLimiter({ maxRequests: 10_000, windowMs: 60_000 }),
    claimSessionLimiter: createRateLimiter({ maxRequests: 10_000, windowMs: 60_000 }),
  });

  const claimFor = async (publicId: string) => {
    const res = await sessionApp.fetch(
      new Request("http://localhost/api/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "203.0.113.9",
          Origin: "http://localhost:4321",
        },
        body: JSON.stringify({ publicId }),
      }),
    );
    const cookie = res.headers.get("Set-Cookie")!.split(";")[0]!;
    return { body: (await res.json()) as ClaimOk, cookie };
  };

  const getSession = (cookie?: string) =>
    sessionApp.fetch(
      new Request("http://localhost/api/claim/session", {
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          ...(cookie ? { Cookie: cookie } : {}),
        },
      }),
    );

  it("returns 401 with no session cookie", async () => {
    const res = await getSession();
    expect(res.status).toBe(401);
  });

  it("returns 401 for a bogus session token", async () => {
    const res = await getSession("cire_session=not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("returns the same invite the claim did, for a valid session", async () => {
    const { body: claimed, cookie } = await claimFor("TESTONE-IVY-AA11");

    const res = await getSession(cookie);
    expect(res.status).toBe(200);
    const restored = (await res.json()) as ClaimOk;

    expect(restored.familyId).toBe(claimed.familyId);
    expect(restored.publicId).toBe(claimed.publicId);
    expect(restored.familyName).toBe(claimed.familyName);
    expect(restored.members).toEqual(claimed.members);
    expect(restored.events).toEqual(claimed.events);
  });

  it("carries the closing section — the claim payload is its only delivery point (S-H1)", async () => {
    const { cookie } = await claimFor("TESTONE-IVY-AA11");
    const res = await getSession(cookie);
    const restored = (await res.json()) as { closing?: unknown };
    // Present as a shape (contents depend on the wedding's customisation row);
    // what matters is the restore does not silently drop the gated section.
    expect(restored.closing).toBeDefined();
  });

  it("accepts NO claim code — it is a restore, not a second credential surface", async () => {
    const { body: one } = await claimFor("TESTONE-IVY-AA11");
    const { cookie: cookieFour } = await claimFor("TESTFOR-JOY-DD44");

    // A caller holding family four's session cannot name family one, by query
    // string or by body: the route reads only the cookie-derived family id.
    const res = await sessionApp.fetch(
      new Request(`http://localhost/api/claim/session?publicId=TESTONE-IVY-AA11`, {
        headers: { "cf-connecting-ip": "203.0.113.9", Cookie: cookieFour },
      }),
    );
    expect(res.status).toBe(200);
    const restored = (await res.json()) as ClaimOk;
    expect(restored.familyId).not.toBe(one.familyId);
    expect(restored.publicId).toBe("TESTFOR-JOY-DD44");
  });

  it("401s and CLEARS the cookie once the family is deactivated", async () => {
    const { cookie, body } = await claimFor("TESTFOR-JOY-DD44");
    // Sanity: the session works before the withdrawal.
    expect((await getSession(cookie)).status).toBe(200);

    db.update(families)
      .set({ deactivatedAt: new Date() })
      .where(eq(families.id, body.familyId))
      .run();

    const res = await getSession(cookie);
    expect(res.status).toBe(401);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("cire_session=");
    expect(setCookie).toContain("Max-Age=0");

    // Restore the fixture for any later test in this file.
    db.update(families).set({ deactivatedAt: null }).where(eq(families.id, body.familyId)).run();
  });

  it("does not burn the claim endpoint's brute-force budget", async () => {
    // A tight claim limiter alongside a normal session limiter: the restore
    // must not be gated by the credential-surface budget, or a household
    // reloading its invite would 429 itself.
    const tightApp = createApp(db, {
      claimLimiter: createRateLimiter({ maxRequests: 1, windowMs: 60_000 }),
      claimSessionLimiter: createRateLimiter({ maxRequests: 100, windowMs: 60_000 }),
    });
    const claimRes = await tightApp.fetch(
      new Request("http://localhost/api/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "203.0.113.22",
          Origin: "http://localhost:4321",
        },
        body: JSON.stringify({ publicId: "TESTONE-IVY-AA11" }),
      }),
    );
    expect(claimRes.status).toBe(200);
    const cookie = claimRes.headers.get("Set-Cookie")!.split(";")[0]!;

    // The claim budget (1/min) is now spent — the restore is unaffected.
    for (let i = 0; i < 5; i++) {
      const res = await tightApp.fetch(
        new Request("http://localhost/api/claim/session", {
          headers: { "cf-connecting-ip": "203.0.113.22", Cookie: cookie },
        }),
      );
      expect(res.status).toBe(200);
    }
  });

  it("enforces its own limiter once that budget is spent", async () => {
    const cappedApp = createApp(db, {
      claimLimiter: createRateLimiter({ maxRequests: 10_000, windowMs: 60_000 }),
      claimSessionLimiter: createRateLimiter({ maxRequests: 2, windowMs: 60_000 }),
    });
    const req = () =>
      cappedApp.fetch(
        new Request("http://localhost/api/claim/session", {
          headers: { "cf-connecting-ip": "203.0.113.33" },
        }),
      );
    await req();
    await req();
    expect((await req()).status).toBe(429);
  });
});
