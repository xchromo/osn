import { DbLive, type Db } from "@osn/db/service";
import { Effect, Layer } from "effect";
import { Elysia, t } from "elysia";

import { createAuthService, type AuthConfig } from "../services/auth";
import { createRecommendationService } from "../services/recommendations";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Recommendation routes
// ---------------------------------------------------------------------------

export function createRecommendationRoutes(
  authConfig: AuthConfig,
  dbLayer: Layer.Layer<Db> = DbLive,
  /** See `createAuthRoutes` — same semantics. */
  loggerLayer: Layer.Layer<never> = Layer.empty,
) {
  const auth = createAuthService(authConfig);
  const recommendations = createRecommendationService();

  const run = <A, E>(eff: Effect.Effect<A, E, Db>): Promise<A> =>
    Effect.runPromise(
      eff.pipe(Effect.provide(dbLayer), Effect.provide(loggerLayer)) as Effect.Effect<
        A,
        never,
        never
      >,
    );

  async function requireAuth(
    authorization: string | undefined,
    set: { status?: number | string },
  ): Promise<{ profileId: string; handle: string } | null> {
    const token = extractToken(authorization);
    if (!token) {
      set.status = 401;
      return null;
    }
    try {
      return await Effect.runPromise(Effect.orDie(auth.verifyAccessToken(token)));
    } catch {
      set.status = 401;
      return null;
    }
  }

  return new Elysia({ prefix: "/recommendations" }).get(
    "/connections",
    async ({ query, headers, set }) => {
      const caller = await requireAuth(headers.authorization, set);
      if (!caller) return { error: "Unauthorized" };
      try {
        const limit = query.limit ? parseInt(query.limit, 10) : 10;
        const suggestions = await run(recommendations.suggestConnections(caller.profileId, limit));
        return { suggestions };
      } catch {
        set.status = 500;
        return { error: "Request failed" };
      }
    },
    { query: t.Object({ limit: t.Optional(t.String()) }) },
  );
}
