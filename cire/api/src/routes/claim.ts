import type { RateLimiterBackend } from "@shared/rate-limit";
import type { TurnstileVerifier } from "@shared/turnstile";
import { Effect, Schema } from "effect";
import { Elysia } from "elysia";

import { DbService } from "../db";
import type { Db } from "../db";
import { buildSessionCookie, clearSessionCookie } from "../lib/cookie";
import { sessionAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { turnstileGate } from "../middleware/turnstile";
import { runCire } from "../observability";
import { ClaimBody } from "../schemas/claim";
import { claimService } from "../services/claim";
import { sessionService } from "../services/session";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface ClaimRouteOptions {
  /** Primary origin (used for the session cookie's `secure` flag). */
  webOrigin: string;
  /** Per-IP rate limiter (brute-force protection — S-C2). */
  limiter: RateLimiterBackend;
  /**
   * Turnstile verifier (KEY-OPTIONAL). `null` ⇒ gate skipped; configured ⇒
   * a missing/invalid token fails closed (403) before the credential lookup.
   */
  turnstileVerifier?: TurnstileVerifier | null;
}

export const createClaimRoutes = (
  db: Db,
  { webOrigin, limiter, turnstileVerifier = null }: ClaimRouteOptions,
) =>
  new Elysia({ prefix: "/api/claim" }).use(rateLimitMiddleware(limiter)).post(
    "/",
    async ({ request, set }) => {
      const raw: unknown = await request.json().catch(() => null);

      // Turnstile bot gate (key-optional; no-op when unconfigured). Runs after
      // the per-IP limiter, before the credential lookup — a bot that can't pass
      // the challenge never reaches the claim-code oracle.
      const tsErr = await turnstileGate(turnstileVerifier, "claim", raw, request.headers);
      if (tsErr) {
        set.status = tsErr.status;
        return { error: tsErr.error };
      }

      return runCire(
        Effect.gen(function* () {
          const { publicId } = yield* Schema.decodeUnknown(ClaimBody)(raw);
          const result = yield* claimService.lookup(publicId.trim().toUpperCase());
          // Session write may fail (DB transient error) — we still hand the user
          // their invite payload and skip Set-Cookie. Error is logged inside the
          // service. They can re-login to mint a fresh session.
          const session: { token: string; expiresAt: Date } | undefined = yield* sessionService
            .create(result.familyId, SESSION_TTL_SECONDS)
            .pipe(Effect.catchTag("SessionWriteError", () => Effect.succeed(undefined)));
          if (session) {
            set.headers["set-cookie"] = buildSessionCookie(session.token, {
              secure: webOrigin.startsWith("https://"),
              maxAgeSeconds: SESSION_TTL_SECONDS,
            });
          }
          return result;
        }).pipe(
          Effect.provideService(DbService, db),
          Effect.catchTag("ParseError", () =>
            Effect.sync(() => {
              set.status = 400;
              return { error: "Missing or invalid fields" };
            }),
          ),
          Effect.catchTag("InvalidCredentials", () =>
            Effect.sync(() => {
              set.status = 401;
              return { error: "Invalid credentials" };
            }),
          ),
        ),
      );
    },
    // Sentinel parse hook: stops Elysia from consuming the body so the handler
    // can parse it by hand — a malformed payload degrades to the schema's 400
    // instead of Elysia's parser error.
    { parse: () => ({}) },
  );

export interface ClaimSessionRouteOptions {
  /** Primary origin (used for the cleared cookie's `secure` flag). */
  webOrigin: string;
  /**
   * Per-IP limiter for the restore read. Deliberately NOT the claim limiter:
   * that one is a 5/min brute-force budget sized for a credential surface, and
   * this route is hit on every page load by guests who already hold a session —
   * a household behind one NAT would 429 itself just by reloading. See the
   * sibling-instance split below.
   */
  limiter: RateLimiterBackend;
}

/**
 * `GET /api/claim/session` — re-read the invite for the household this
 * `cire_session` cookie already belongs to.
 *
 * A SIBLING instance to `createClaimRoutes` rather than another route on it, so
 * the two get different limiters (Elysia applies a scoped middleware per
 * instance) — the same split as the organiser hosts read/write routes. The
 * credential surface keeps its tight budget; the restore read gets a page-load-
 * sized one.
 *
 * No Turnstile: the caller isn't presenting a code, they're presenting a session
 * this API minted. No Origin guard concerns either — it is a safe GET.
 *
 * On failure the stale cookie is CLEARED, so a household whose invite was
 * withdrawn (or whose session outlived its family row) lands on the code form
 * instead of retrying a dead cookie on every visit.
 */
export const createClaimSessionRoutes = (
  db: Db,
  { webOrigin, limiter }: ClaimSessionRouteOptions,
) =>
  new Elysia({ prefix: "/api/claim" })
    .use(rateLimitMiddleware(limiter))
    .use(sessionAuth(db))
    .get("/session", async ({ familyId, set }) => {
      // sessionAuth's onBeforeHandle guarantees this; the guard is a runtime
      // safety net (and narrows the type).
      if (!familyId) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      return runCire(
        claimService.restore(familyId).pipe(
          Effect.provideService(DbService, db),
          Effect.catchTag("InvalidCredentials", () =>
            Effect.sync(() => {
              set.status = 401;
              set.headers["set-cookie"] = clearSessionCookie({
                secure: webOrigin.startsWith("https://"),
              });
              return { error: "Invalid credentials" };
            }),
          ),
        ),
      );
    });
