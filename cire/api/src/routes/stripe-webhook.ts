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
 *
 * **What it does with the four endings a payment can have.** A checkout session
 * is not over when it completes. A delayed bank debit — BECS here, SEPA in
 * Europe — completes the session in seconds and settles days later, so
 * `async_payment_succeeded` settles the gift the same way `completed` does, and
 * `async_payment_failed` marks it `failed`. `expired` does the same for a guest
 * who opened checkout and closed the tab. `charge.refunded` marks a settled gift
 * `refunded`, and only when the whole charge went back — a couple who returned
 * part of a gift still received the rest.
 *
 * Every one of those transitions is one-way and guarded in the service: only a
 * `pending` row may fail, only a `succeeded` row may refund. A replayed or
 * forged `expired` cannot un-settle a gift somebody actually gave.
 */

/**
 * The most a Stripe event can be, in bytes.
 *
 * The endpoint is public, unauthenticated and unlimited — the signature IS the
 * authentication, and it cannot run until the body has been read. So the body
 * is what an attacker gets to choose the size of. Rejecting on the declared
 * `content-length` costs one map lookup and happens before a single byte is
 * buffered into isolate memory; the same bound is then enforced *as the body
 * arrives*, because `Content-Length` is theirs to lie about. Stripe's own
 * events run to a few KB (S-M2, S-H1).
 */
const MAX_EVENT_BYTES = 64 * 1024;

/**
 * Read at most `max` BYTES of the body, or give up.
 *
 * Two things the obvious `await request.text()` gets wrong on a public,
 * pre-authentication endpoint (S-H1):
 *
 *  - **It buffers everything first.** A checked length after the await is a
 *    check on memory already spent: a lying `Content-Length` — or none at all,
 *    which chunked encoding allows — puts the whole body in the isolate before
 *    the bound is consulted. Cloudflare kills a Worker that exceeds its memory
 *    limit, so the failure is the isolate, not a 400.
 *  - **`String.length` is not bytes.** It counts UTF-16 code units, so any
 *    body of non-Latin text passes a byte bound it is over — twice over for
 *    text outside the BMP.
 *
 * So the stream is drained a chunk at a time and abandoned the moment the
 * running byte count passes the bound. Leaving the loop cancels the stream,
 * which is what tells the runtime to stop pulling the rest of the upload.
 *
 * Returns the decoded text, or `null` when the body was too big.
 */
async function readBoundedText(request: Request, max: number): Promise<string | null> {
  const body = request.body;
  if (!body) return "";

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  // Async iteration, not a reader loop: each chunk has to be counted before the
  // next is pulled, so there is nothing here to run concurrently. Leaving the
  // loop early — `return null` on the bound, or a throw — runs the iterator's
  // `return()`, and that cancels the stream, which is what tells the runtime to
  // stop pulling the rest of the upload.
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > max) return null;
    // `stream: true` so a multi-byte character split across two chunks is
    // decoded as one character rather than two replacement ones — the
    // signature is over the exact text, so a mangled decode is a 400 for a
    // body Stripe signed correctly.
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/** Events this product acts on. Everything else is acknowledged and dropped. */
const ACCOUNT_UPDATED = "account.updated";
const CHECKOUT_COMPLETED = "checkout.session.completed";
/**
 * A delayed debit that landed, days after the session completed. Same shape and
 * same handler as `completed`: the object is the session, and `payment_status`
 * is the fact. Without it a BECS or SEPA gift sits `pending` forever.
 */
const CHECKOUT_ASYNC_SUCCEEDED = "checkout.session.async_payment_succeeded";
/** A delayed debit that bounced. The session is over and no money is coming. */
const CHECKOUT_ASYNC_FAILED = "checkout.session.async_payment_failed";
/** The guest opened checkout and walked away; Stripe closed the session. */
const CHECKOUT_EXPIRED = "checkout.session.expired";
/**
 * Money went back. Carries a CHARGE, not a session — which is why the refund
 * path finds its row by payment intent (migration 0059 indexes that column).
 */
const CHARGE_REFUNDED = "charge.refunded";

export interface StripeWebhookDeps {
  /** Stripe's signing secret for this endpoint. Absent ⇒ do not mount. */
  readonly webhookSecret: string;
}

interface StripeEventEnvelope {
  type?: unknown;
  /** Unix seconds, Stripe's own clock — what makes the write monotonic. */
  created?: unknown;
  /** The connected account a Connect event happened on. Absent on platform events. */
  account?: unknown;
  data?: { object?: unknown };
}

/**
 * The fields this product reads off a completed Checkout Session.
 *
 * The metadata is ONE opaque id, on purpose. The gift's amount, the household
 * it came from, the note and the name all live in the `pending` row this id
 * names — so nothing personal was ever sent to Stripe, and nothing a connected
 * account can type into its own session's metadata can settle anything here.
 */
interface CheckoutSessionObject {
  id?: unknown;
  payment_intent?: unknown;
  payment_status?: unknown;
  /** What Stripe actually charged, reconciled against the row at settle (S-L1). */
  amount_total?: unknown;
  currency?: unknown;
  /**
   * Our own gift id, set when the session was created (0060). Stripe echoes it
   * back untouched and the connected account has no way to write it, unlike
   * `metadata` — so it is read first and `metadata` is only the fallback for
   * sessions created before the field was sent.
   */
  client_reference_id?: unknown;
  metadata?: { contributionId?: unknown };
}

/**
 * The fields this product reads off a refunded Charge.
 *
 * `refunded` is Stripe's own "the whole thing went back" flag — true only when
 * the refunded amount equals the charge. A partial refund leaves it false, and
 * the handler leaves the gift alone.
 */
interface ChargeObject {
  payment_intent?: unknown;
  refunded?: unknown;
}

/** A metadata value Stripe gave back: a string, or nothing usable. */
function metaString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The gift a session names. `client_reference_id` is the trustworthy field —
 * the platform sets it at creation and nothing on the connected account's side
 * can rewrite it — so it wins; `metadata.contributionId` still answers for
 * sessions created before 0060 shipped.
 */
function contributionIdOf(session: CheckoutSessionObject | undefined): string | null {
  return metaString(session?.client_reference_id) ?? metaString(session?.metadata?.contributionId);
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
      // Bounded as it arrives, on what actually turns up rather than on what
      // the header claimed: `Content-Length` is attacker-set, and may be absent.
      const payload = await readBoundedText(request, MAX_EVENT_BYTES);
      if (payload === null) {
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
              // Stripe's own timestamp, never ours: deliveries are unordered
              // and retried for days, and the service refuses anything older
              // than what the row already holds. Without it an old
              // `charges_enabled: true`, redelivered after Stripe disabled the
              // account, re-opens a payment surface Stripe has shut.
              observedAt: typeof envelope.created === "number" ? envelope.created : undefined,
            });
            // An account this platform knows nothing about is not an error —
            // the endpoint is shared with whatever else the platform does.
            return { received: true, matched };
          }

          if (type === CHECKOUT_COMPLETED || type === CHECKOUT_ASYNC_SUCCEEDED) {
            const session = envelope.data?.object as CheckoutSessionObject;
            const stripeAccountId = metaString(envelope.account);
            const sessionId = metaString(session?.id);
            const contributionId = contributionIdOf(session);
            if (!stripeAccountId || !sessionId || !contributionId) {
              // A completed session that is not one of ours — no connected
              // account, or none of the id we write. Acknowledged: a retry
              // cannot add fields Stripe never sent.
              return { received: true, outcome: "unknown" };
            }

            const outcome = yield* registryService.settleContribution({
              contributionId,
              checkoutSessionId: sessionId,
              stripeAccountId,
              paymentIntentId: metaString(session?.payment_intent),
              // `async_payment_succeeded` fires for exactly one reason, and its
              // session still reads `payment_status: "paid"` — but the event
              // type is the stronger statement of the two, and a session object
              // that arrived without the field should not silently leave the
              // gift pending a second time.
              paid: type === CHECKOUT_ASYNC_SUCCEEDED || session?.payment_status === "paid",
              paidAmountMinor:
                typeof session?.amount_total === "number" ? session.amount_total : null,
              paidCurrency: metaString(session?.currency),
            });
            return { received: true, outcome };
          }

          if (type === CHECKOUT_ASYNC_FAILED || type === CHECKOUT_EXPIRED) {
            const session = envelope.data?.object as CheckoutSessionObject;
            const stripeAccountId = metaString(envelope.account);
            const sessionId = metaString(session?.id);
            const contributionId = contributionIdOf(session);
            if (!stripeAccountId || !sessionId || !contributionId) {
              return { received: true, outcome: "unknown" };
            }

            const outcome = yield* registryService.failContribution({
              contributionId,
              checkoutSessionId: sessionId,
              stripeAccountId,
            });
            return { received: true, outcome };
          }

          if (type === CHARGE_REFUNDED) {
            const charge = envelope.data?.object as ChargeObject;
            const stripeAccountId = metaString(envelope.account);
            const paymentIntentId = metaString(charge?.payment_intent);
            if (!stripeAccountId || !paymentIntentId) {
              // A refund on a charge with no payment intent is not a checkout
              // charge, and nothing here knows what it is.
              return { received: true, outcome: "unknown" };
            }
            if (charge?.refunded !== true) {
              // PARTIAL. The charge is still, in part, a gift the couple
              // received — calling the whole thing refunded would tell them
              // otherwise. Acknowledged and left alone.
              return { received: true, outcome: "partial" };
            }

            const outcome = yield* registryService.refundContribution({
              paymentIntentId,
              stripeAccountId,
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
