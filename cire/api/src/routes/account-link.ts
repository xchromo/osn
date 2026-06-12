import { Data, Effect, Schema } from "effect";
import { Hono } from "hono";

import type { AppVariables } from "../app";
import { DbService } from "../db";
import { LinkAccountBody } from "../schemas/account-link";
import { accountLinkService } from "../services/account-link";

export const accountLinkRoute = new Hono<{ Variables: AppVariables }>();

/** Transport failure resolving the OSN account id over ARC (osn-api down / 5xx). */
class OsnAccountLookupError extends Data.TaggedError("OsnAccountLookupError")<{
  reason: string;
}> {}

/**
 * POST /api/account/link — attach an invitee to the caller's OSN account.
 *
 * Dual-credential: the guest session cookie (sets `familyId`) proves the
 * household; the OSN access token (sets `osnProfileId`, via the POST-only
 * `osnAuth` gate) proves the OSN identity. We resolve the profile to its
 * account id server-to-server (ARC) so account-level linking lets any of the
 * user's OSN profiles later see the invitation in Pulse.
 */
accountLinkRoute.post("/", async (c) => {
  const familyId = c.var.familyId;
  const osnProfileId = c.var.osnProfileId;
  // Both middlewares run on this route; the guards are runtime safety nets.
  if (!familyId || !osnProfileId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const resolveAccount = c.var.resolveOsnAccountId;
  if (!resolveAccount) {
    // Deployment has no ARC key configured — linking is disabled, not broken.
    return c.json({ error: "Account linking is not available" }, 503);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = null;
  }

  return Effect.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(LinkAccountBody)(raw);

      const resolution = yield* Effect.tryPromise({
        try: () => resolveAccount(osnProfileId),
        catch: (cause) => new OsnAccountLookupError({ reason: String(cause) }),
      });
      if (!resolution.ok) {
        // Token verified but the profile no longer exists in OSN (deleted
        // between issuance and now). Rare; distinct from a transport failure.
        return c.json({ error: "OSN profile not found" }, 404);
      }

      const link = yield* accountLinkService.link({
        familyId,
        guestId: body.guestId,
        osnAccountId: resolution.accountId,
        osnProfileId,
      });
      return c.json({ linked: true, guestId: link.guestId }, 201);
    }).pipe(
      Effect.provideService(DbService, c.var.db),
      Effect.catchTags({
        ParseError: () => Effect.succeed(c.json({ error: "Missing or invalid fields" }, 400)),
        GuestNotInFamily: () =>
          Effect.succeed(c.json({ error: "Guest does not belong to this family" }, 403)),
        AccountLinkConflict: () => Effect.succeed(c.json({ error: "already_linked" }, 409)),
        OsnAccountLookupError: (err) =>
          Effect.logError("osn account lookup failed", { reason: err.reason }).pipe(
            Effect.as(c.json({ error: "OSN account lookup failed" }, 502)),
          ),
        AccountLinkWriteError: () =>
          Effect.succeed(c.json({ error: "Could not link account" }, 500)),
      }),
    ),
  );
});

/**
 * GET /api/account/link — link status for every invitee in the household.
 * Guest-session only. Returns presence + linked-at; never the OSN account id
 * (S2S-only) nor the profile id (kept minimal).
 */
accountLinkRoute.get("/", async (c) => {
  const familyId = c.var.familyId;
  if (!familyId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return Effect.runPromise(
    accountLinkService.listByFamily(familyId).pipe(
      Effect.provideService(DbService, c.var.db),
      Effect.map((links) =>
        c.json({
          links: links.map((l) => ({ guestId: l.guestId, linkedAt: l.linkedAt.getTime() })),
        }),
      ),
    ),
  );
});

/**
 * DELETE /api/account/link/:guestId — remove an invitee's link. Guest-session
 * only, scoped to the caller's household. Idempotent.
 */
accountLinkRoute.delete("/:guestId", async (c) => {
  const familyId = c.var.familyId;
  if (!familyId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const guestId = c.req.param("guestId");
  return Effect.runPromise(
    accountLinkService.unlink({ familyId, guestId }).pipe(
      Effect.provideService(DbService, c.var.db),
      Effect.as(c.json({ linked: false, guestId })),
      Effect.catchTag("AccountLinkWriteError", () =>
        Effect.succeed(c.json({ error: "Could not unlink account" }, 500)),
      ),
    ),
  );
});
