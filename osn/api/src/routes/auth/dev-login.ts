/**
 * Passkey-less sign-in for the `local` and `dev` tiers.
 *
 * A passkey is the only primary login factor, which makes any seeded fixture
 * account unreachable: nobody can enrol a WebAuthn credential on behalf of a
 * row a seed script wrote. This route mints a real OSN session for one fixed
 * principal, so everything downstream — the OIDC authorize/token chain, the
 * organiser portal, the vendor portal, `@osn/social` — runs completely
 * untouched. There is no bypass anywhere else in the stack.
 *
 * Two gates, both enforced in `build-deps.ts`, both fail-closed:
 *  - tier: `local` or `dev` only;
 *  - `DEV_LOGIN_SECRET`: unset ⇒ these routes are never mounted, so the
 *    surface answers 404 rather than a 401 that admits it exists.
 *
 * `GET` is the primary entry point on purpose. The origin guard rejects a POST
 * without a matching `Origin` header, so a GET is what works from a browser
 * address bar, `curl`, and headless Chrome — and it keeps the secret out of
 * every public frontend bundle, since nothing but the operator's URL carries
 * it.
 */

import { accounts, organisationMembers, organisations, users } from "@osn/db/schema";
import { Db } from "@osn/db/service";
import { timingSafeEqualString } from "@shared/crypto/timing-safe";
import { commitBatch } from "@shared/db-utils";
import { createRateLimiter } from "@shared/rate-limit";
import { Effect } from "effect";
import { Elysia, t } from "elysia";

import { buildSessionCookies } from "../../lib/cookie-session";
import type { AuthRouteContext } from "./context";
import { toTokenResponseCookieOnly } from "./context";
import { errorResponse, publicProfile, tokenResponse } from "./response-schemas";

/**
 * The one account this route can ever sign in as. `profileId` is the exact id
 * the cire dev seed writes as the seeded wedding's owner
 * (`DEV_OWNER_PROFILE_ID` in `cire/db/seed/data/wedding.ts`), so the organiser
 * portal opens on real seeded data rather than an empty dashboard for a
 * stranger.
 *
 * `handle` is in `RESERVED_HANDLES`, so no real dev-tier registration can take
 * it first and silently divert the provisioning insert.
 */
export const DEV_PRINCIPAL = {
  accountId: "acc_dev_bootstrap",
  profileId: "usr_dev_bootstrap_owner",
  organisationId: "org_dev_bootstrap",
  membershipId: "orgm_dev_bootstrap",
  email: "dev@seed.osn.dev",
  passkeyUserId: "pku_dev_bootstrap",
  handle: "dev_bootstrap",
  displayName: "Dev Bootstrap",
  organisationHandle: "dev_bootstrap_org",
  organisationName: "Dev Bootstrap Org",
} as const;

export interface DevLoginConfig {
  /** `DEV_LOGIN_SECRET`. Compared in constant time. */
  secret: string;
  /**
   * Origins a `return_to` may redirect to — the tier's own CORS allowlist, so
   * the set is automatically right per tier and needs no extra config. An
   * off-list `return_to` is a 400, never a redirect.
   */
  allowedReturnOrigins: readonly string[];
}

/**
 * Own limiter rather than `ctx.rateLimit`: that one denies outright on an
 * unresolved IP (correct for a public credential surface), and this route is
 * reached by `curl` and by tests driving `app.handle` with no socket peer and
 * no XFF chain — where the IP is always the unresolved sentinel. A shared
 * bucket is fine here because the surface only exists on `local`/`dev`. No
 * metric is emitted: `AuthRateLimitedEndpoint` is a bounded union and this
 * endpoint has no business appearing on the production auth dashboards.
 */
const devLoginLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });

/** Idempotent across every sign-in and every deploy — `osn-db-dev` is never reset. */
const provision = Effect.gen(function* () {
  const { db } = yield* Db;
  const now = new Date();
  yield* Effect.promise(() =>
    commitBatch(db, [
      db
        .insert(accounts)
        .values({
          id: DEV_PRINCIPAL.accountId,
          email: DEV_PRINCIPAL.email,
          passkeyUserId: DEV_PRINCIPAL.passkeyUserId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      db
        .insert(users)
        .values({
          id: DEV_PRINCIPAL.profileId,
          accountId: DEV_PRINCIPAL.accountId,
          handle: DEV_PRINCIPAL.handle,
          displayName: DEV_PRINCIPAL.displayName,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      db
        .insert(organisations)
        .values({
          id: DEV_PRINCIPAL.organisationId,
          handle: DEV_PRINCIPAL.organisationHandle,
          name: DEV_PRINCIPAL.organisationName,
          ownerId: DEV_PRINCIPAL.profileId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      db
        .insert(organisationMembers)
        .values({
          id: DEV_PRINCIPAL.membershipId,
          organisationId: DEV_PRINCIPAL.organisationId,
          profileId: DEV_PRINCIPAL.profileId,
          role: "admin",
          createdAt: now,
        })
        .onConflictDoNothing(),
    ]),
  );
});

/** `true` when `target` parses and its origin is on the allowlist. */
function returnToAllowed(target: string, allowed: readonly string[]): boolean {
  try {
    return allowed.includes(new URL(target).origin);
  } catch {
    return false;
  }
}

export function createDevLoginRoutes(ctx: AuthRouteContext, config: DevLoginConfig) {
  const { auth, run, handleError, socketIpOf, sessionMetaFrom, cookieConfig } = ctx;

  /**
   * Shared body for both verbs. Returns either the session payload or a
   * sentinel the verb handler turns into the right status — GET can redirect,
   * POST always answers JSON.
   */
  async function signIn(
    secret: string | undefined,
    headers: Record<string, string | undefined>,
    socketIp: string | null,
  ) {
    if (!devLoginLimiter.check("dev-login")) {
      return { ok: false, status: 429, body: { error: "rate_limited" } } as const;
    }
    if (!secret || !timingSafeEqualString(secret, config.secret)) {
      return { ok: false, status: 401, body: { error: "unauthorized" } } as const;
    }

    await run(
      Effect.gen(function* () {
        // No `security_events` row: `SecurityEventKind` is a bounded union and
        // this event has no place in the real account-security UI. The session
        // row this call creates is the audit trail.
        yield* Effect.logWarning("dev-login: minting a session for the dev principal", {
          profileId: DEV_PRINCIPAL.profileId,
        });
        yield* provision;
      }),
    );

    const profile = await run(auth.findProfileById(DEV_PRINCIPAL.profileId));
    if (!profile) {
      return { ok: false, status: 500, body: { error: "provisioning_failed" } } as const;
    }

    const session = await run(
      auth.issueTokens(
        profile.id,
        profile.accountId,
        profile.email,
        profile.handle,
        profile.displayName,
        undefined,
        sessionMetaFrom(headers, socketIp),
      ),
    );

    return {
      ok: true,
      cookies: buildSessionCookies(session.refreshToken, cookieConfig),
      body: { session: toTokenResponseCookieOnly(session), profile: publicProfileOf(profile) },
    } as const;
  }

  const publicProfileOf = (p: {
    id: string;
    handle: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  }) => ({
    id: p.id,
    handle: p.handle,
    email: p.email,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
  });

  return new Elysia({ prefix: "/dev" })
    .get(
      "/login",
      async ({ query, headers, set, server, request }) => {
        try {
          if (query.return_to && !returnToAllowed(query.return_to, config.allowedReturnOrigins)) {
            set.status = 400;
            return { error: "invalid_return_to" };
          }
          const result = await signIn(query.secret, headers, socketIpOf({ server, request }));
          if (!result.ok) {
            set.status = result.status;
            return result.body;
          }
          set.headers["set-cookie"] = result.cookies;
          if (query.return_to) {
            set.status = 302;
            set.headers["location"] = query.return_to;
            return "";
          }
          return result.body;
        } catch (e) {
          const { status, body: errBody } = handleError(e);
          set.status = status;
          return errBody;
        }
      },
      {
        query: t.Object({
          secret: t.Optional(t.String()),
          return_to: t.Optional(t.String()),
        }),
        response: {
          200: t.Object({ session: tokenResponse, profile: publicProfile }),
          302: t.String(),
          400: errorResponse,
          401: errorResponse,
          429: errorResponse,
          500: errorResponse,
        },
        detail: {
          summary: "Dev sign-in (local + dev tiers only)",
          description:
            "Mints a real OSN session for the fixed dev principal. Mounted only when the tier is local/dev AND DEV_LOGIN_SECRET is set.",
          tags: ["Auth"],
        },
      },
    )
    .post(
      "/login",
      async ({ body, headers, set, server, request }) => {
        try {
          const result = await signIn(body.secret, headers, socketIpOf({ server, request }));
          if (!result.ok) {
            set.status = result.status;
            return result.body;
          }
          set.headers["set-cookie"] = result.cookies;
          return result.body;
        } catch (e) {
          const { status, body: errBody } = handleError(e);
          set.status = status;
          return errBody;
        }
      },
      {
        body: t.Object({ secret: t.String() }),
        response: {
          200: t.Object({ session: tokenResponse, profile: publicProfile }),
          401: errorResponse,
          429: errorResponse,
          500: errorResponse,
        },
        detail: {
          summary: "Dev sign-in, POST form (needs an Origin header)",
          description:
            "Same session as the GET form. The origin guard rejects a POST without an allowlisted Origin header, so callers from a shell should use GET.",
          tags: ["Auth"],
        },
      },
    );
}
