/**
 * Effect-based Redis service for lifecycle management.
 *
 * - `RedisLive` — connects via REDIS_URL; Layer.scoped finalizer calls quit()
 * - `RedisMemoryLive` — in-memory fallback for dev/test (no Redis server)
 */

import { Context, Effect, Layer } from "effect";
import IORedis from "ioredis";
import type { RedisClient } from "./client";
import { wrapIoRedis, createMemoryClient } from "./client";
import { RedisError } from "./errors";

export interface RedisService {
  readonly client: RedisClient;
}

export class Redis extends Context.Tag("@shared/redis/Redis")<Redis, RedisService>() {}

/**
 * Live layer — connects to `REDIS_URL`. `Layer.scoped` ensures `quit()` on
 * shutdown. Fails with `RedisError` if `REDIS_URL` is unset or the connection
 * cannot be verified via PING.
 */
export const RedisLive: Layer.Layer<Redis, RedisError> = Layer.scoped(
  Redis,
  Effect.gen(function* () {
    const url = process.env.REDIS_URL;
    if (!url) {
      return yield* Effect.fail(
        new RedisError({
          cause: "REDIS_URL environment variable is not set",
        }),
      );
    }

    const raw = new IORedis(url);
    const client = wrapIoRedis(raw);

    yield* Effect.tryPromise({
      try: () => client.ping(),
      catch: (cause) => new RedisError({ cause }),
    }).pipe(Effect.tapError((e) => Effect.logError("Redis connection failed", { cause: e.cause })));

    yield* Effect.addFinalizer(() => Effect.promise(() => client.quit().catch(() => {})));

    return { client };
  }),
);

/**
 * In-memory layer for dev/test — no Redis server required.
 * Provides the same `Redis` service tag backed by an in-memory client.
 */
export const RedisMemoryLive: Layer.Layer<Redis> = Layer.scoped(
  Redis,
  Effect.gen(function* () {
    const client = createMemoryClient();

    yield* Effect.addFinalizer(() => Effect.promise(() => client.quit()));

    return { client };
  }),
);
