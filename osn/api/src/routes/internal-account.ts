import { DbLive, type Db } from "@osn/db/service";
import { Effect, Layer } from "effect";
import { Elysia, t } from "elysia";

import { requireArc } from "../lib/arc-middleware";
import * as accountErasure from "../services/account-erasure";
import { createAuthService, type AuthConfig } from "../services/auth";

const AUDIENCE = "osn-api";
const SCOPE_STEP_UP_VERIFY = "step-up:verify";
const SCOPE_APP_ENROLLMENT_WRITE = "app-enrollment:write";

/**
 * Internal endpoints called by other OSN services (Pulse, Zap) over ARC:
 *
 *   POST /internal/step-up/verify — verifies that a user-supplied step-up
 *   token is valid for the requested purpose, account, and AMR. Single
 *   source of truth for step-up jti consumption across the platform.
 *
 *   POST /internal/app-enrollment/leave — flips `app_enrollments.left_at`
 *   to mark a user as having left an app. Idempotent.
 *
 * Pulse / Zap must register their ARC public keys with osn-api in advance
 * (via /graph/internal/register-service) and request the `step-up:verify`
 * + `app-enrollment:write` scopes.
 */
export function createInternalAccountRoutes(
  authConfig: AuthConfig,
  dbLayer: Layer.Layer<Db> = DbLive,
) {
  const auth = createAuthService(authConfig);
  const run = <A, E>(eff: Effect.Effect<A, E, Db>): Promise<A> =>
    Effect.runPromise(eff.pipe(Effect.provide(dbLayer)) as Effect.Effect<A, never, never>);

  return new Elysia({ prefix: "/internal" })
    .post(
      "/step-up/verify",
      async ({ body, headers, set }) => {
        const caller = await requireArc(
          headers.authorization,
          set,
          run,
          AUDIENCE,
          SCOPE_STEP_UP_VERIFY,
        );
        if (!caller) return { error: "Unauthorized" };

        try {
          await run(auth.verifyStepUpForExternalPurpose(body.account_id, body.token, body.purpose));
          return { ok: true as const };
        } catch {
          // Generic 200 with ok:false so callers can branch without 400/401
          // ambiguity. Specific reason is recorded in osn.auth.step_up.verified
          // metric inside verifyStepUpToken.
          return { ok: false as const };
        }
      },
      {
        body: t.Object({
          account_id: t.String({ minLength: 1 }),
          token: t.String({ minLength: 1 }),
          purpose: t.Union([
            t.Literal("pulse_app_delete"),
            t.Literal("zap_app_delete"),
            t.Literal("account_delete"),
          ]),
        }),
      },
    )
    .post(
      "/app-enrollment/leave",
      async ({ body, headers, set }) => {
        const caller = await requireArc(
          headers.authorization,
          set,
          run,
          AUDIENCE,
          SCOPE_APP_ENROLLMENT_WRITE,
        );
        if (!caller) return { error: "Unauthorized" };

        try {
          const result = await run(
            accountErasure.recordAppEnrollmentLeft(body.account_id, body.app),
          );
          return { closed: result.closed };
        } catch {
          set.status = 500;
          return { error: "internal_error" };
        }
      },
      {
        body: t.Object({
          account_id: t.String({ minLength: 1 }),
          app: t.Union([t.Literal("pulse"), t.Literal("zap")]),
        }),
      },
    )
    .post(
      "/app-enrollment/join",
      async ({ body, headers, set }) => {
        // Lazy provisioning hook for first-authenticated-call flows. Pulse
        // calls this on a user's first authenticated Pulse API call (after
        // the user re-engages post-leave or on initial onboarding).
        const caller = await requireArc(
          headers.authorization,
          set,
          run,
          AUDIENCE,
          SCOPE_APP_ENROLLMENT_WRITE,
        );
        if (!caller) return { error: "Unauthorized" };

        try {
          const { joinApp } = await import("../services/app-enrollments");
          const result = await run(joinApp(body.account_id, body.app));
          return { enrolled: result.enrolled };
        } catch {
          set.status = 500;
          return { error: "internal_error" };
        }
      },
      {
        body: t.Object({
          account_id: t.String({ minLength: 1 }),
          app: t.Union([t.Literal("pulse"), t.Literal("zap")]),
        }),
      },
    );
}
