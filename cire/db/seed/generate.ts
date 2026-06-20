#!/usr/bin/env bun
// Generate cire/db/seed/dev-seed.sql from the canonical seed data in
// ./data/. This is the ONLY way dev-seed.sql should change — edit the TS
// modules under ./data/, then run `bun run --cwd cire/db seed:generate`.
//
//   bun run --cwd cire/db seed:generate   # rewrite dev-seed.sql in place
//   bun run --cwd cire/db seed:check      # exit 1 if dev-seed.sql is stale
//
// seed:check runs in CI (via seed.test.ts) so the committed SQL can never drift
// from the TS the test suite actually seeds from. The SQL is a pure artifact of
// this script — do not hand-edit it.

import { events, families, wedding } from "./data";

const OUT_PATH = new URL("./dev-seed.sql", import.meta.url).pathname;

// Single-quote a SQL string literal (escape embedded quotes).
function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function header(): string {
  return `-- Local D1 dev seed for \`bun run db:seed\`.
--
-- GENERATED FILE — do not edit by hand. Source of truth is
-- cire/db/seed/data/ (the same modules cire/api/src/db/setup.ts#seedDb seeds
-- the bun:sqlite test DB from). Regenerate with:
--   bun run --cwd cire/db seed:generate
-- CI runs \`seed:check\` (cire/db/seed/seed.test.ts) so this file can never
-- drift from the canonical data.
--
-- Idempotent — every INSERT uses \`OR IGNORE\` so re-running on top of an
-- existing seed is a no-op (PK / unique-index conflicts are skipped). To
-- pick up edits to existing rows, use \`bun run db:reset\` instead which
-- wipes local D1 state then re-pushes + re-seeds.`;
}

function divider(label: string): string {
  return `-- ────────────────────────────────────────────────────────────────────────────
-- ${label}
-- ────────────────────────────────────────────────────────────────────────────`;
}

function weddingBlock(): string {
  return `${divider("Sample wedding (local dev only)")}

-- Migration 0006 seeded \`wed_bootstrap\`, but migration 0015 deletes it (prod
-- starts clean — every real OSN user creates their own weddings). So the local
-- dev seed now owns its sample wedding row outright instead of relying on the
-- migration's seeded row. Owned by the fixed dev id \`${wedding.ownerOsnProfileId}\`
-- (DEV_OWNER_PROFILE_ID in cire/api/src/db/setup.ts) so a signed-in dev account
-- can own it; override the owner after seeding via CIRE_DEV_OWNER_PROFILE_ID
-- (see scripts/cire-db-seed.sh). The events/families below are FK-scoped to it.
INSERT OR IGNORE INTO weddings (id, slug, display_name, owner_osn_profile_id, code_style, created_at, updated_at)
VALUES (${sql(wedding.id)}, ${sql(wedding.slug)}, ${sql(wedding.displayName)}, ${sql(
    wedding.ownerOsnProfileId,
  )}, ${sql(wedding.codeStyle)}, unixepoch(), unixepoch());`;
}

function eventsBlock(): string {
  const list = Object.values(events);
  const rows = list
    .map((e) => {
      const palette = JSON.stringify(e.dressCodePalette);
      return `  (
    ${sql(e.id)}, ${sql(wedding.id)}, ${sql(e.slug)}, ${sql(e.name)},
    ${sql(e.date)}, ${sql(e.location)},
    ${sql(e.description)},
    ${sql(e.startAt)}, ${sql(e.endAt)}, ${sql(e.timezone)},
    ${sql(e.address)},
    ${sql(e.dressCodeDescription)},
    ${sql(palette)},
    ${sql(e.pinterestUrl)},
    ${sql(e.mapsUrl)},
    ${e.sortOrder}
  )`;
    })
    .join(",\n");

  return `${divider(`Events (${list.length}) — Oct–Nov 2026, Sydney`)}

-- All events/families are scoped to the sample wedding above (\`${wedding.id}\`).
-- The wedding_id column is NOT NULL with an FK, so the seed supplies it
-- explicitly.
INSERT OR IGNORE INTO events (
  id, wedding_id, slug, name, date, location, description,
  start_at, end_at, timezone, address,
  dress_code_description, dress_code_palette,
  pinterest_url, maps_url, sort_order
) VALUES
${rows};`;
}

function familiesBlock(): string {
  const rows = families
    .map(
      (f) =>
        `  (${sql(f.id)}, ${sql(wedding.id)}, ${sql(f.publicId)}, ${sql(
          f.familyName,
        )}, unixepoch() * 1000, unixepoch() * 1000)`,
    )
    .join(",\n");

  return `${divider(`Families (${families.length}) — stable UUIDs so dev links don't drift between seeds`)}

INSERT OR IGNORE INTO families (id, wedding_id, public_id, family_name, created_at, updated_at) VALUES
${rows};`;
}

function guestsBlock(): string {
  const lines: string[] = [];
  let count = 0;
  for (const family of families) {
    lines.push(`  -- ${family.familyName}`);
    for (const [index, guest] of family.guests.entries()) {
      count++;
      const trailing = isLastGuest(family, index) ? "" : ",";
      lines.push(
        `  (${sql(guest.id)}, ${sql(family.id)}, ${sql(guest.firstName)}, ${sql(
          guest.lastName,
        )}, ${index}, unixepoch() * 1000, unixepoch() * 1000)${trailing}`,
      );
    }
  }
  // The very last row must end with ';' not ','.
  const body = lines.join("\n").replace(/,?$/, ";");

  return `${divider(`Guests (${count})`)}

INSERT OR IGNORE INTO guests (id, family_id, first_name, last_name, sort_order, created_at, updated_at) VALUES
${body}`;
}

function isLastGuest(family: (typeof families)[number], index: number): boolean {
  const isLastFamily = families[families.length - 1] === family;
  return isLastFamily && index === family.guests.length - 1;
}

function eventSlugById(eventId: string): string {
  const match = Object.values(events).find((e) => e.id === eventId);
  return match ? match.slug : eventId;
}

function guestEventsBlock(): string {
  const allGuests = families.flatMap((f) => f.guests.map((g) => ({ family: f, guest: g })));
  const lines: string[] = [];
  allGuests.forEach(({ guest }, gi) => {
    const slugs = guest.events.map(eventSlugById).join(" + ");
    lines.push(`  -- ${guest.firstName}: ${slugs}`);
    guest.events.forEach((eventId, ei) => {
      const isLast = gi === allGuests.length - 1 && ei === guest.events.length - 1;
      lines.push(`  (${sql(guest.id)}, ${sql(eventId)})${isLast ? ";" : ","}`);
    });
  });

  return `${divider("Event invitations")}

INSERT OR IGNORE INTO guest_events (guest_id, event_id) VALUES
${lines.join("\n")}`;
}

export function renderDevSeedSql(): string {
  return `${[
    header(),
    weddingBlock(),
    eventsBlock(),
    familiesBlock(),
    guestsBlock(),
    guestEventsBlock(),
  ].join("\n\n")}\n`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const next = renderDevSeedSql();

  if (check) {
    const current = await Bun.file(OUT_PATH).text();
    if (current !== next) {
      process.stderr.write(
        "dev-seed.sql is out of date with cire/db/seed/data/.\n" +
          "Run `bun run --cwd cire/db seed:generate` and commit the result.\n",
      );
      process.exit(1);
    }
    process.stdout.write("dev-seed.sql is in sync with the canonical seed data.\n");
    return;
  }

  await Bun.write(OUT_PATH, next);
  process.stdout.write(`Wrote ${OUT_PATH}\n`);
}

if (import.meta.main) {
  void main();
}
