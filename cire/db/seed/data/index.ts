// Single source of truth for the Cire dev/test seed (sample wedding + events +
// families/guests). Both seed consumers derive from this barrel so they can
// never drift:
//   - cire/api/src/db/setup.ts#seedDb -> in-process bun:sqlite (dev + tests)
//   - cire/db/seed/generate.ts -> cire/db/seed/dev-seed.sql (local D1)
// See ./events.ts for the rationale and the regenerate/check workflow.

export { events } from "./events";
export type { DressCodeSwatch, SeedEvent, SeedEventSlug } from "./events";
export { families } from "./guests";
export type { SeedFamily, SeedGuest } from "./guests";
export { wedding } from "./wedding";
