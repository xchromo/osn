import { Effect } from "effect";
import { Elysia } from "elysia";

import { DbService } from "../db";
import type { Db } from "../db";
import { runCire } from "../observability";
import { registryService } from "../services/registry";
import { verifyStripeWebhook } from "../services/stripe";

/**
 * STRIPE'S SIDE OF THE CONVERSATION.
 *
 *   POST /api/stripe/webhook   (signature-verified, no other auth)
 *
 * **Mounted only when a signing secret exists.** With no `STRIPE_WEBHOOK_SECRET`
 * nothing could be verified, and an endpoint that takes unverified bodies and
 * writes rows is an unauthenticated write API. Absent secret ⇒ absent route.
 *
 * **The raw bytes are the subject.** Elysia would happily parse the body into an
 * object, but the signature is over the exact text Stripe sent — a body that has
 * been through `JSON.parse` and back has already lost the property being checked.
 * The handler takes `request.text()` and parses afterwards, inside the verifier.
 *
 * **A 200 does not mean "handled".** Stripe retries any non-2xx for days, so the
 * only things that may answer non-2xx are a body we cannot verify (400 — a retry
 * will not make it verifiable) and a database failure (500 — a retry genuinely
 * might). An event type this product does not care about is a 200: the webhook
 * endpoint belongs to the platform account, not to this feature, and refusing
 * everything unfamiliar would turn every unrelated event into a retry storm.
 *
 * **What it does with `account.updated`.** Caches the two capability booleans on
 * the wedding's registry settings, keyed on the ACCOUNT id. It never touches
 * `cash_gifts_enabled`: that column is the couple's intent, and a capability
 * lapsing is not them changing their mind.
 */

/**
 * The most a Stripe event can be, in bytes.
 *
 * The endpoint is public, unauthenticated and unlimited — the signature IS the
 * authentication, and it cannot run until the body has been read. So the body
 * is what an attacker gets to choose the size of. Rejecting on the declared
 * `content-length` costs one map lookup and happens before a single byte is
 * buffered into isolate memory; the same bound is re-checked on the
 * materialised text, because `Content-Length` is theirs to lie about. Stripe's
 * own events run to a few KB (S-M2).
 */
const MAX_EVENT_BYTES = 64 * 1024;

/** Events this product acts on. Everything else is acknowledged and dropped. */
const HANDLED_EVENTS = new Set(["account.updated"]);

export interface StripeWebhookDeps {
  /** Stripe's signing secret for this endpoint. Absent ⇒ do not mount. */
  readonly webhookSecret: string;
}

interface StripeEventEnvelope {
  type?: unknown;
  /** Unix seconds, Stripe's own clock — what makes the write monotonic. */
  created?: unknown;
  data?: { object?: unknown };
}

export const createStripeWebhookRoutes = (db: Db, deps: StripeWebhookDeps) =>
  new Elysia().post(
    "/api/stripe/webhook",
    async ({ request, set }) => {
      // The cheap checks first, before the body is read at all.
      const signatureHeader = request.headers.get("stripe-signature");
      if (!signatureHeader) {
        set.status = 400;
        return { error: "invalid_signature", reason: "malformed" };
      }
      const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(declared) && declared > MAX_EVENT_BYTES) {
        set.status = 400;
        return { error: "invalid_signature", reason: "malformed" };
      }
      const payload = await request.text();
      // Re-checked on what actually arrived: the header above is attacker-set.
      if (payload.length > MAX_EVENT_BYTES) {
        set.status = 400;
        return { error: "invalid_signature", reason: "malformed" };
      }
      // Seconds, matching the `t=` Stripe signs with. The tolerance window
      // itself is exercised against an injected clock in `services/stripe.test`.
      const now = Math.floor(Date.now() / 1000);

      return runCire(
        Effect.gen(function* () {
          const event = yield* verifyStripeWebhook({
            payload,
            signatureHeader,
            secret: deps.webhookSecret,
            now,
          });
          const envelope = event as StripeEventEnvelope;
          const type = typeof envelope.type === "string" ? envelope.type : "";
          if (!HANDLED_EVENTS.has(type)) {
            // Acknowledged, not handled. See the header: a retry storm of
            // events we were never going to act on helps nobody.
            return { received: true };
          }

          const account = envelope.data?.object as {
            id?: unknown;
            charges_enabled?: unknown;
            payouts_enabled?: unknown;
          };
          if (typeof account?.id !== "string") {
            // Signed by Stripe but not shaped like an account. Nothing to write
            // and nothing a retry would fix.
            return { received: true };
          }

          const matched = yield* registryService.applyStripeAccountState({
            id: account.id,
            chargesEnabled: account.charges_enabled === true,
            payoutsEnabled: account.payouts_enabled === true,
            // Stripe's own timestamp, never ours: deliveries are unordered and
            // retried for days, and the service refuses anything older than
            // what the row already holds (S-H1). Without it an old
            // `charges_enabled: true`, redelivered after Stripe disabled the
            // account, re-opens a payment surface Stripe has shut.
            observedAt: typeof envelope.created === "number" ? envelope.created : undefined,
          });
          // An account this platform knows nothing about is not an error — the
          // endpoint is shared with whatever else the platform account does.
          return { received: true, matched };
        }).pipe(
          Effect.provideService(DbService, db),
          Effect.catchTag("StripeSignatureError", (error) =>
            Effect.sync(() => {
              set.status = 400;
              // The REASON is safe to return: it tells an operator staring at
              // Stripe's delivery log whether they have the wrong secret, a
              // clock problem, or a proxy rewriting bodies. It says nothing
              // about what was in the body.
              return { error: "invalid_signature", reason: error.reason };
            }),
          ),
          // A defect here is a database failure, and Stripe SHOULD retry it, so
          // this is one of the few 500s in the codebase that is a request to be
          // called again rather than an apology.
          Effect.tapDefect((cause) => Effect.logError("stripe webhook defect", cause)),
          Effect.catchAllDefect(() =>
            Effect.sync(() => {
              set.status = 500;
              return { error: "Internal error" };
            }),
          ),
        ),
      );
    },
    // The body must reach the handler as TEXT, unparsed — see the header. The
    // sentinel parse hook is the same idiom the registry write routes use: it
    // returns an empty object without touching the stream, so `request.text()`
    // below still has one to read.
    { parse: () => ({}) },
  );
