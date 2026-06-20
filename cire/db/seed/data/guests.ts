// Canonical dev/test seed families + guests — the SINGLE source of truth for
// the sample wedding's households. See ./events.ts for the full rationale; this
// module is consumed identically (setup.ts#seedDb for bun:sqlite, generate.ts
// for dev-seed.sql).
//
// `familyId` / guest `id` are stable UUIDs so the generated dev-seed.sql keeps
// the same primary keys across re-seeds (dev claim links don't drift, and the
// idempotent INSERT OR IGNORE re-runs cleanly). The in-process bun:sqlite seed
// (setup.ts) does NOT use these ids — it mints fresh crypto.randomUUID() per
// row, matching its historical behaviour — they exist for the SQL generator and
// for any consumer that needs a deterministic id. Each guest's `events` is a
// list of event ids (see ./events.ts).

import { events } from "./events";

export interface SeedGuest {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly events: readonly string[];
}

export interface SeedFamily {
  readonly id: string;
  readonly publicId: string;
  readonly familyName: string;
  readonly guests: readonly SeedGuest[];
}

export const families = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    publicId: "TESTONE-IVY-AA11",
    familyName: "Testfamily",
    guests: [
      {
        id: "b0000000-0000-4000-8000-000000000001",
        firstName: "Ada",
        lastName: "Testfamily",
        events: [events.catholic.id, events.hindu.id, events.reception.id],
      },
    ],
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    publicId: "TESTTWO-OAK-BB22",
    familyName: "Sampleton",
    guests: [
      {
        id: "b0000000-0000-4000-8000-000000000002",
        firstName: "Bo",
        lastName: "Sampleton",
        events: [events.hindu.id, events.reception.id],
      },
      {
        id: "b0000000-0000-4000-8000-000000000003",
        firstName: "Cleo",
        lastName: "Sampleton",
        events: [events.hindu.id, events.reception.id],
      },
      {
        id: "b0000000-0000-4000-8000-000000000004",
        firstName: "Dot",
        lastName: "Sampleton",
        events: [events.hindu.id],
      },
    ],
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    publicId: "TESTTRE-DEW-CC33",
    familyName: "Exampleton",
    guests: [
      {
        id: "b0000000-0000-4000-8000-000000000005",
        firstName: "Nori",
        lastName: "Exampleton",
        events: [events.catholic.id, events.hindu.id],
      },
    ],
  },
  {
    id: "a0000000-0000-4000-8000-000000000004",
    publicId: "TESTFOR-JOY-DD44",
    familyName: "Placeholder",
    guests: [
      {
        id: "b0000000-0000-4000-8000-000000000006",
        firstName: "Eli",
        lastName: "Placeholder",
        events: [
          events.catholic.id,
          events.mehendi.id,
          events.hindu.id,
          events.reception.id,
          events["kitchen-tea"].id,
        ],
      },
    ],
  },
] as const satisfies readonly SeedFamily[];
