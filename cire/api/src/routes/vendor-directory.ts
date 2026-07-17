import type { RateLimiterBackend } from "@shared/rate-limit";
import { Effect } from "effect";
import { Elysia } from "elysia";

import { DbService } from "../db";
import type { Db } from "../db";
import { SERVICE_CATEGORIES } from "../lib/service-categories";
import { osnAuth } from "../middleware/osn-auth";
import type { OsnAuthOptions } from "../middleware/osn-auth";
import { rateLimitMiddlewareByUser } from "../middleware/rate-limit";
import { weddingMember } from "../middleware/wedding-member";
import { runCire } from "../observability";
import { directoryService } from "../services/directory";

// NOTE: Task 4 adds the `weddingEditor` import + `Schema` (effect) +
// `AddFromDirectoryBody` / `vendorsService` imports when it adds the write
// factory to this same file. Do NOT add them in Task 3 — an unused import
// fails the lint gate on Task 3's commit.

const CATEGORY_KEYS = new Set(SERVICE_CATEGORIES.map((c) => c.key));

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function internalSync(set: { status?: number | string }) {
  set.status = 500;
  return { error: "Internal error" };
}

const internal = (set: { status?: number | string }) =>
  Effect.sync(() => {
    set.status = 500;
    return { error: "Internal error" };
  });

export const createVendorDirectoryReadRoutes = (
  db: Db,
  osnAuthOptions: OsnAuthOptions,
  limiter: RateLimiterBackend,
) =>
  new Elysia({ prefix: "/api/organiser" })
    .use(osnAuth(osnAuthOptions))
    .group("/weddings/:weddingId", (group) =>
      group
        .use(weddingMember(db))
        .use(rateLimitMiddlewareByUser(limiter))
        .get("/directory", async ({ weddingId, query, set }) => {
          if (!weddingId) return internalSync(set);
          const q = query as Record<string, string | undefined>;
          const category = q.category && CATEGORY_KEYS.has(q.category) ? q.category : null;
          return runCire(
            directoryService
              .browse(weddingId, {
                category,
                q: q.q ?? null,
                location: q.location ?? null,
                limit: clampInt(q.limit, 24, 1, 50),
                offset: clampInt(q.offset, 0, 0, 1_000_000),
              })
              .pipe(
                Effect.provideService(DbService, db),
                Effect.catchAllDefect(() => internal(set)),
              ),
          );
        }),
    );
