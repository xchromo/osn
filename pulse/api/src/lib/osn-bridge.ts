import { instrumentedFetch } from "@shared/observability";
import type { StepUpPurpose } from "@shared/observability/metrics";
import { Data, Effect } from "effect";

import { arcAuthHeader } from "./outbound-arc";

/**
 * Pulse → OSN bridge for the leave-Pulse flow.
 *
 *   1. `verifyStepUp(accountId, token, purpose)` — calls the ARC-gated
 *      `/internal/step-up/verify` endpoint to confirm a user-supplied
 *      step-up token is valid + matches the expected purpose. Pulse
 *      doesn't verify step-up signatures locally — osn-api remains the
 *      single source of truth (centralised jti consumption + AMR policy).
 *
 *   2. `notifyAppLeft(accountId)` — calls `/internal/app-enrollment/leave`
 *      after Pulse's local soft-delete commits, so osn-api can flip
 *      `app_enrollments.left_at` for the (account, "pulse") row.
 */

export class OsnBridgeError extends Data.TaggedError("OsnBridgeError")<{
  readonly cause: unknown;
}> {}

const OSN_API_URL = process.env.OSN_API_URL ?? "http://localhost:4000";

if (process.env.NODE_ENV === "production" && !OSN_API_URL.startsWith("https://")) {
  throw new Error(`OSN_API_URL must use https:// in production (got: ${OSN_API_URL})`);
}

export const verifyStepUp = (
  accountId: string,
  token: string,
  purpose: StepUpPurpose,
): Effect.Effect<{ ok: boolean }, OsnBridgeError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await instrumentedFetch(`${OSN_API_URL}/internal/step-up/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await arcAuthHeader("osn-api", "step-up:verify"),
        },
        body: JSON.stringify({ account_id: accountId, token, purpose }),
      });
      if (!res.ok) throw new Error(`step-up verify returned ${res.status}`);
      return (await res.json()) as { ok: boolean };
    },
    catch: (cause) => new OsnBridgeError({ cause }),
  });

export const notifyAppLeft = (
  accountId: string,
): Effect.Effect<{ closed: boolean }, OsnBridgeError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await instrumentedFetch(`${OSN_API_URL}/internal/app-enrollment/leave`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await arcAuthHeader("osn-api", "app-enrollment:write"),
        },
        body: JSON.stringify({ account_id: accountId, app: "pulse" as const }),
      });
      if (!res.ok) throw new Error(`enrollment-leave returned ${res.status}`);
      return (await res.json()) as { closed: boolean };
    },
    catch: (cause) => new OsnBridgeError({ cause }),
  });

export const notifyAppJoined = (
  accountId: string,
): Effect.Effect<{ enrolled: boolean }, OsnBridgeError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await instrumentedFetch(`${OSN_API_URL}/internal/app-enrollment/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await arcAuthHeader("osn-api", "app-enrollment:write"),
        },
        body: JSON.stringify({ account_id: accountId, app: "pulse" as const }),
      });
      if (!res.ok) throw new Error(`enrollment-join returned ${res.status}`);
      return (await res.json()) as { enrolled: boolean };
    },
    catch: (cause) => new OsnBridgeError({ cause }),
  });
