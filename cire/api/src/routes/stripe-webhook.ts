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
 *
 * **What it does with `checkout.session.completed`.** Writes the gift. This is
 * the ONLY place a contribution row is created: a checkout session is an
 * intention, and only Stripe knows whether the money moved. Two things make it
 * safe to write from:
 *
 *  - **Idempotent on the session id**, which is `unique` on the column. Stripe
 *    delivers at least once and retries until it gets a 2xx, so a duplicate is
 *    the ordinary case rather than the edge.
 *  - **The metadata is not trusted on its own.** We wrote it when the session
 *    was created, but this endpoint also hears about sessions the connected
 *    account created for itself, where the metadata is whatever its owner
 *    typed. So the wedding must actually own the account the event came from
 *    (`event.account`), and the household must belong to that wedding.
 */

/** Events this product acts on. Everything else is acknowledged and dropped. */
const ACCOUNT_UPDATED = "account.updated";
const CHECKOUT_COMPLETED = "checkout.session.completed";

export interface StripeWebhookDeps {
  /** Stripe's signing secret for this endpoint. Absent ⇒ do not mount. */
  readonly webhookSecret: string;
}

interface StripeEventEnvelope {
  type?: unknown;
  /** The connected account a Connect event happened on. Absent on platform events. */
  account?: unknown;
  data?: { object?: unknown };
}

/** The fields this product reads off a completed Checkout Session. */
interface CheckoutSessionObject {
  id?: unknown;
  payment_intent?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  payment_status?: unknown;
  metadata?: {
    weddingId?: unknown;
    familyId?: unknown;
    itemId?: unknown;
    message?: unknown;
    displayName?: unknown;
  };
}

/** A metadata value Stripe gave back: a string, or nothing usable. */
function metaString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export const createStripeWebhookRoutes = (db: Db, deps: StripeWebhookDeps) =>
  new Elysia().post(
    "/api/stripe/webhook",
    async ({ request, set }) => {
      const payload = await request.text();
      const signatureHeader = request.headers.get("stripe-signature");
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

          if (type === ACCOUNT_UPDATED) {
            const account = envelope.data?.object as {
              id?: unknown;
              charges_enabled?: unknown;
              payouts_enabled?: unknown;
            };
            if (typeof account?.id !== "string") {
              // Signed by Stripe but not shaped like an account. Nothing to
              // write and nothing a retry would fix.
              return { received: true };
            }
            const matched = yield* registryService.applyStripeAccountState({
              id: account.id,
              chargesEnabled: account.charges_enabled === true,
              payoutsEnabled: account.payouts_enabled === true,
            });
            // An account this platform knows nothing about is not an error —
            // the endpoint is shared with whatever else the platform does.
            return { received: true, matched };
          }

          if (type === CHECKOUT_COMPLETED) {
            const session = envelope.data?.object as CheckoutSessionObject;
            const stripeAccountId = metaString(envelope.account);
            const sessionId = metaString(session?.id);
            const weddingId = metaString(session?.metadata?.weddingId);
            const familyId = metaString(session?.metadata?.familyId);
            const amountMinor = session?.amount_total;
            const currency = metaString(session?.currency);
            if (
              !stripeAccountId ||
              !sessionId ||
              !weddingId ||
              !familyId ||
              !currency ||
              typeof amountMinor !== "number"
            ) {
              // A completed session that is not one of ours — no connected
              // account, or none of the metadata we write. Acknowledged: a
              // retry cannot add fields Stripe never sent.
              return { received: true, recorded: false };
            }

            const outcome = yield* registryService.recordContribution({
              stripeAccountId,
              checkoutSessionId: sessionId,
              paymentIntentId: metaString(session?.payment_intent),
              weddingId,
              familyId,
              itemId: metaString(session?.metadata?.itemId),
              amountMinor,
              // Stripe answers lower-case; the gift log and the budget both
              // read currency codes upper-case.
              currency: currency.toUpperCase(),
              // `paid` is the only status that means the money moved. Anything
              // else Stripe calls complete-but-unpaid (a delayed bank debit) is
              // recorded as pending, so the couple see it without being told it
              // has landed.
              status: session?.payment_status === "paid" ? "succeeded" : "pending",
              message: metaString(session?.metadata?.message),
              displayName: metaString(session?.metadata?.displayName),
            });
            return { received: true, outcome };
          }

          // Acknowledged, not handled. See the header: a retry storm of events
          // we were never going to act on helps nobody.
          return { received: true };
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
