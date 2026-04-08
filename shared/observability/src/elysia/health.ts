import { Elysia } from "elysia";

/**
 * Standard health + readiness routes.
 *
 * - `/health` is **liveness**: returns 200 as long as the process is up.
 *   It never does real work. Use for container liveness probes; if this
 *   returns non-200, restart the container.
 *
 * - `/ready` is **readiness**: returns 200 only if the service can
 *   actually serve traffic (i.e. dependencies are reachable). The caller
 *   supplies an optional `probe` function that returns a boolean; any
 *   thrown error or false return is treated as "not ready" → 503.
 *
 * Convention borrowed from Kubernetes; works on Fly.io / Render / Railway
 * / bare Docker without modification.
 */
export interface HealthRoutesOptions {
  /** Service name, returned in the body so operators can sanity-check. */
  readonly serviceName: string;
  /**
   * Optional readiness probe. Return true if ready, false or throw if not.
   * Typical implementation: a trivial DB query (`SELECT 1`).
   */
  readonly probe?: () => Promise<boolean> | boolean;
}

export const healthRoutes = (options: HealthRoutesOptions) =>
  new Elysia({ name: "@shared/observability/health" })
    .get("/health", () => ({
      status: "ok",
      service: options.serviceName,
    }))
    .get("/ready", async ({ set }) => {
      if (!options.probe) {
        return { status: "ready", service: options.serviceName };
      }
      try {
        const ok = await options.probe();
        if (!ok) {
          set.status = 503;
          return { status: "not_ready", service: options.serviceName };
        }
        return { status: "ready", service: options.serviceName };
      } catch (err) {
        set.status = 503;
        return {
          status: "not_ready",
          service: options.serviceName,
          reason: err instanceof Error ? err.message : "probe_failed",
        };
      }
    });
