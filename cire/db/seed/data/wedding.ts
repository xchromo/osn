// Canonical sample-wedding row for the local dev / test seed. The SQL generator
// and setup.ts#seedBootstrapWedding both derive the same row from here. See
// ./events.ts for the full single-source-of-truth rationale.
//
// `id` mirrors @cire/db's BOOTSTRAP_WEDDING_ID; `ownerOsnProfileId` mirrors
// setup.ts's DEV_OWNER_PROFILE_ID. Deployed tiers never seed this — migration
// 0015 drops the orphaned row and real OSN users create their own weddings.

import { BOOTSTRAP_WEDDING_ID } from "../../src/schema";

export const wedding = {
  id: BOOTSTRAP_WEDDING_ID,
  slug: "cire-wedding",
  displayName: "Cire Wedding",
  ownerOsnProfileId: "usr_dev_bootstrap_owner",
  codeStyle: "secure",
} as const;
