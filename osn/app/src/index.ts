import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import {
  createAuthRoutes,
  createGraphRoutes,
  createRedisAuthRateLimiters,
  createRedisGraphRateLimiter,
} from "@osn/core";
import { DbLive } from "@osn/db/service";
import { healthRoutes, initObservability, observabilityPlugin } from "@shared/observability";
import {
  createMemoryClient,
  createClientFromUrl,
  checkRedisHealth,
  type RedisClient,
} from "@shared/redis";
import { Effect, Logger } from "effect";

const SERVICE_NAME = "osn-app";
const port = Number(process.env.PORT) || 4000;

// Initialise observability (logger, tracing, metrics) before building the app.
const { layer: observabilityLayer } = initObservability({ serviceName: SERVICE_NAME });

const authConfig = {
  rpId: process.env.OSN_RP_ID || "localhost",
  rpName: process.env.OSN_RP_NAME || "OSN",
  origin: process.env.OSN_ORIGIN || "http://localhost:5173",
  issuerUrl: process.env.OSN_ISSUER_URL || `http://localhost:${port}`,
  jwtSecret: process.env.OSN_JWT_SECRET || "dev-secret-change-in-prod",
  accessTokenTtl: Number(process.env.OSN_ACCESS_TOKEN_TTL) || 3600,
  refreshTokenTtl: Number(process.env.OSN_REFRESH_TOKEN_TTL) || 2592000,
};

// ---------------------------------------------------------------------------
// Redis client — env-driven backend selection (S-M2)
//
// When REDIS_URL is set, connect to Redis for cross-process rate limiting.
// When unset (local dev), use an in-memory client with identical semantics.
// If Redis is configured but unreachable at startup, fall back to in-memory
// with a warning — fail-open on infrastructure, fail-closed on individual
// rate limit checks (the rate limiter itself denies on backend errors per
// S-M36).
// ---------------------------------------------------------------------------

async function initRedisClient(): Promise<RedisClient> {
  const url = process.env.REDIS_URL;

  if (!url) {
    void Effect.runPromise(
      Effect.logInfo("REDIS_URL not set — using in-memory rate limiters").pipe(
        Effect.provide(observabilityLayer),
      ),
    );
    return createMemoryClient();
  }

  try {
    const client = createClientFromUrl(url);
    const healthy = await checkRedisHealth(client);

    if (!healthy) {
      await client.quit().catch(() => {});
      throw new Error("Redis startup health check failed");
    }

    void Effect.runPromise(
      Effect.logInfo("Redis connected — using Redis-backed rate limiters").pipe(
        Effect.provide(observabilityLayer),
      ),
    );
    return client;
  } catch (cause) {
    void Effect.runPromise(
      Effect.logWarning(
        "Redis connection failed at startup — falling back to in-memory rate limiters",
      ).pipe(
        Effect.annotateLogs({
          error: cause instanceof Error ? cause.message : String(cause),
        }),
        Effect.provide(observabilityLayer),
      ),
    );
    return createMemoryClient();
  }
}

const redisClient = await initRedisClient();

const authRateLimiters = createRedisAuthRateLimiters(redisClient);
const graphRateLimiter = createRedisGraphRateLimiter(redisClient);

const app = new Elysia()
  .use(cors())
  .use(observabilityPlugin({ serviceName: SERVICE_NAME }))
  .use(healthRoutes({ serviceName: SERVICE_NAME }))
  .get("/", () => ({ status: "ok", service: "osn-auth" }))
  .use(createAuthRoutes(authConfig, DbLive, observabilityLayer, authRateLimiters))
  .use(createGraphRoutes(authConfig, DbLive, observabilityLayer, graphRateLimiter));

if (process.env.NODE_ENV !== "test") {
  app.listen(port);
  void Effect.runPromise(
    Effect.logInfo("osn-app listening").pipe(
      Effect.annotateLogs({ port: String(port), service: SERVICE_NAME }),
      Effect.provide(Logger.pretty),
      Effect.provide(observabilityLayer),
    ),
  );
}

export { app };
export type App = typeof app;
