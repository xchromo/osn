/**
 * `CloudflareEmailLive` — production email transport.
 *
 * Signs an ARC token with the local service's private key and POSTs the
 * rendered email to a Cloudflare Worker we own (`osn-email-worker`). The
 * Worker verifies ARC, applies per-recipient rate limits, and forwards
 * to the chosen provider via a Worker binding.
 *
 * All outbound HTTP goes through `instrumentedFetch` so the call becomes
 * a child span of `email.cloudflare.dispatch` and `traceparent` is injected
 * for cross-service trace correlation.
 */

import { getOrCreateArcToken } from "@shared/crypto";
import { instrumentedFetch } from "@shared/observability/fetch";
import { Effect, Layer } from "effect";

import {
  classifyHttpStatus,
  metricEmailDispatchStatus,
  metricEmailRenderDuration,
  metricEmailSendAttempt,
  metricEmailSendDuration,
} from "./metrics";
import { EmailError, EmailService } from "./service";
import { renderTemplate } from "./templates";

/** Runtime configuration for the Cloudflare-backed transport. */
export interface CloudflareEmailConfig {
  /** Worker endpoint, e.g. `https://email.osn.workers.dev/send`. */
  readonly workerUrl: string;
  /** ES256 private key used to sign the outgoing ARC token. */
  readonly arcPrivateKey: CryptoKey;
  /** Key ID (JWK thumbprint) matching the public key registered for this service. */
  readonly arcKid: string;
  /** Issuer service ID. Default: "osn-api". */
  readonly arcIssuer?: string;
  /** Worker audience — ARC token `aud` claim. Default: "osn-email-worker". */
  readonly arcAudience?: string;
  /**
   * Sender email address (From header). Defaults to "noreply@osn.local"
   * — override in production with the verified domain address.
   */
  readonly fromAddress?: string;
}

/** Scope required to reach the Worker. Single, dedicated scope — not overloaded. */
const ARC_SCOPE = "email:send";

/** Wire contract accepted by the Worker's POST /send. */
interface WorkerSendPayload {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export const makeCloudflareEmailLive = (config: CloudflareEmailConfig): Layer.Layer<EmailService> =>
  Layer.succeed(EmailService, {
    send: (input) =>
      Effect.gen(function* () {
        const started = Date.now();

        // --- render (span: email.render) ---
        const rendered = yield* Effect.try({
          try: () => renderTemplate(input.template, input.data),
          catch: (cause) => new EmailError({ reason: "render_failed", cause }),
        }).pipe(
          Effect.withSpan("email.render", { attributes: { template: input.template } }),
          Effect.tap(() =>
            Effect.sync(() =>
              metricEmailRenderDuration((Date.now() - started) / 1000, input.template, "ok"),
            ),
          ),
          Effect.tapError(() =>
            Effect.sync(() =>
              metricEmailRenderDuration((Date.now() - started) / 1000, input.template, "error"),
            ),
          ),
        );

        // --- mint ARC token ---
        const token = yield* Effect.tryPromise({
          try: () =>
            getOrCreateArcToken(config.arcPrivateKey, {
              iss: config.arcIssuer ?? "osn-api",
              aud: config.arcAudience ?? "osn-email-worker",
              scope: ARC_SCOPE,
              kid: config.arcKid,
            }),
          catch: (cause) => new EmailError({ reason: "misconfigured", cause }),
        });

        // --- dispatch (span: email.cloudflare.dispatch) ---
        const payload: WorkerSendPayload = {
          to: input.to,
          from: config.fromAddress ?? "noreply@osn.local",
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        };

        const response = yield* Effect.tryPromise({
          try: () =>
            instrumentedFetch(config.workerUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `ARC ${token}`,
              },
              body: JSON.stringify(payload),
            }),
          catch: (cause) => {
            metricEmailDispatchStatus(input.template, "network");
            return new EmailError({ reason: "worker_unreachable", cause });
          },
        }).pipe(
          Effect.withSpan("email.cloudflare.dispatch", {
            attributes: { template: input.template },
          }),
        );

        const statusClass = classifyHttpStatus(response.status);
        metricEmailDispatchStatus(input.template, statusClass);

        if (response.status === 429) {
          metricEmailSendAttempt(input.template, "rate_limited");
          metricEmailSendDuration((Date.now() - started) / 1000, input.template, "rate_limited");
          return yield* Effect.fail(new EmailError({ reason: "rate_limited" }));
        }

        if (!response.ok) {
          metricEmailSendAttempt(input.template, "failed");
          metricEmailSendDuration((Date.now() - started) / 1000, input.template, "failed");
          // Body is intentionally NOT read into a log — the provider may
          // echo the recipient or subject, and we don't want that leaving
          // the process through a log line.
          return yield* Effect.fail(
            new EmailError({ reason: "dispatch_failed", cause: { status: response.status } }),
          );
        }

        metricEmailSendAttempt(input.template, "sent");
        metricEmailSendDuration((Date.now() - started) / 1000, input.template, "sent");
      }).pipe(Effect.withSpan("email.send", { attributes: { template: input.template } })),
  });
