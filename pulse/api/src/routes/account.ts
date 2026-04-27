import { DbLive, type Db } from "@pulse/db/service";
import { Effect, Layer } from "effect";
import { Elysia, t } from "elysia";

import { DEFAULT_JWKS_URL, extractClaims } from "../lib/auth";
import { notifyAppLeft, verifyStepUp } from "../lib/osn-bridge";
import {
  metricPulseAccountDeletionRequested,
  metricPulseEnrollmentNotify,
  metricPulseHostCancelled,
} from "../metrics";
import * as accountErasure from "../services/accountErasure";

/**
 * Flow B — leave Pulse routes.
 *
 *   DELETE /account             — soft-delete this profile's Pulse data,
 *                                 cancel hosted events for 14 days, schedule
 *                                 hard-delete at +7 days.
 *   POST   /account/restore     — cancel a pending leave (un-cancels events
 *                                 still in their cancellation window).
 *   GET    /account/deletion-status
 *                                — UI banner support.
 *
 * Step-up validation is delegated to osn-api via the ARC `/internal/step-up/verify`
 * endpoint — pulse-api does NOT verify step-up signatures itself. The user
 * obtains the step-up token from osn-api's normal step-up ceremony with
 * `purpose=pulse_app_delete`.
 */
export const createAccountRoutes = (
  dbLayer: Layer.Layer<Db> = DbLive,
  jwksUrl: string = DEFAULT_JWKS_URL,
  _testKey?: CryptoKey,
) =>
  new Elysia({ prefix: "/account" })
    .delete(
      "",
      async ({ body, headers, set }) => {
        const claims = await extractClaims(
          headers["authorization"],
          jwksUrl,
          _testKey as CryptoKey,
        );
        if (!claims) {
          set.status = 401;
          metricPulseAccountDeletionRequested("error");
          return { error: "unauthorized" } as const;
        }

        const stepUpToken = body.step_up_token ?? headers["x-step-up-token"];
        if (!stepUpToken) {
          set.status = 403;
          metricPulseAccountDeletionRequested("step_up_failed");
          return { error: "step_up_required" } as const;
        }

        // accountId comes from the access-token claims; pulse trusts the
        // JWT-issued sub (= profileId) and we look up the corresponding
        // accountId by way of the step-up token verification round-trip.
        // The step-up token's `sub` claim already binds it to the right
        // accountId; we accept whichever account the verify endpoint
        // confirms. We pass the access-token-asserted profileId through
        // accountId-binding in the verify body — but the JWT's claims
        // don't carry accountId directly. To bridge this, the step-up
        // token's `sub` IS the accountId, so we just have to pass what the
        // user supplied as account_id... but the user shouldn't be telling
        // us their own accountId. Instead: we ask osn-api to resolve the
        // step-up token end-to-end without specifying an expected
        // account_id, OR (cleaner) we encode the accountId in the access
        // token's claims. For Phase 1 we use the latter — the OSN access
        // token will need an `accountId` claim. As a pragmatic interim,
        // accept the body-supplied account_id and let osn-api reject any
        // mismatch.
        const accountId = body.account_id;

        const verify = await Effect.runPromise(
          verifyStepUp(accountId, stepUpToken, "pulse_app_delete").pipe(
            Effect.catchAll(() => Effect.succeed({ ok: false } as const)),
          ),
        );
        if (!verify.ok) {
          set.status = 403;
          metricPulseAccountDeletionRequested("step_up_failed");
          return { error: "step_up_required" } as const;
        }

        try {
          const result = await Effect.runPromise(
            accountErasure
              .requestErasure({ profileId: claims.profileId, accountId })
              .pipe(Effect.provide(dbLayer)) as Effect.Effect<
              accountErasure.RequestErasureOutput,
              accountErasure.PulseErasureDbError,
              never
            >,
          );

          metricPulseAccountDeletionRequested(result.newlyScheduled ? "ok" : "already_pending");
          // Best-effort signal that the request handler cancelled hosted
          // events; counts the user-visible side-effect even when 0.
          metricPulseHostCancelled("ok");

          // ARC callback to osn-api flipping app_enrollments.left_at.
          // Failure is swallowed and retried by the leave-app retry
          // sweeper — the user still gets 202.
          void Effect.runPromise(
            notifyAppLeft(accountId).pipe(
              Effect.tap(() => Effect.sync(() => metricPulseEnrollmentNotify("ok"))),
              Effect.catchAll(() => {
                metricPulseEnrollmentNotify("error");
                return Effect.void;
              }),
              Effect.flatMap(
                () =>
                  accountErasure
                    .markEnrollmentNotifyDone(claims.profileId)
                    .pipe(Effect.provide(dbLayer)) as Effect.Effect<void, never, never>,
              ),
            ) as Effect.Effect<void, never, never>,
          ).catch(() => undefined);

          set.status = 202;
          return {
            scheduled_for: result.scheduledFor,
            already_pending: !result.newlyScheduled,
          };
        } catch {
          set.status = 500;
          metricPulseAccountDeletionRequested("error");
          return { error: "internal_error" } as const;
        }
      },
      {
        body: t.Object({
          account_id: t.String({ minLength: 1 }),
          step_up_token: t.Optional(t.String()),
        }),
      },
    )
    .post("/restore", async ({ headers, set }) => {
      const claims = await extractClaims(headers["authorization"], jwksUrl, _testKey as CryptoKey);
      if (!claims) {
        set.status = 401;
        return { error: "unauthorized" } as const;
      }
      try {
        const result = await Effect.runPromise(
          accountErasure
            .cancelErasure(claims.profileId)
            .pipe(Effect.provide(dbLayer)) as Effect.Effect<
            { cancelled: boolean },
            accountErasure.PulseErasureDbError,
            never
          >,
        );
        return { cancelled: result.cancelled };
      } catch {
        set.status = 500;
        return { error: "internal_error" } as const;
      }
    })
    .get("/deletion-status", async ({ headers, set }) => {
      const claims = await extractClaims(headers["authorization"], jwksUrl, _testKey as CryptoKey);
      if (!claims) {
        set.status = 401;
        return { error: "unauthorized" } as const;
      }
      try {
        const status = await Effect.runPromise(
          accountErasure
            .getDeletionStatus(claims.profileId)
            .pipe(Effect.provide(dbLayer)) as Effect.Effect<
            { scheduled: boolean } & Record<string, unknown>,
            accountErasure.PulseErasureDbError,
            never
          >,
        );
        return status;
      } catch {
        set.status = 500;
        return { error: "internal_error" } as const;
      }
    });

export const accountRoutes = createAccountRoutes();
