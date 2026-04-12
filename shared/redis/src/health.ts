import type { RedisClient } from "./client";

/**
 * Redis health probe for `/ready` endpoints.
 *
 * Sends a PING with a timeout. Returns `true` if the server replies "PONG"
 * within the deadline, `false` otherwise.
 */
export async function checkRedisHealth(client: RedisClient, timeoutMs = 2000): Promise<boolean> {
  try {
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis health check timed out")), timeoutMs),
      ),
    ]);
    return result === "PONG";
  } catch {
    return false;
  }
}
