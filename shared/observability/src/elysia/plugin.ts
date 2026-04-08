import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { Elysia } from "elysia";
import { recordHttpRequest, httpServerActiveRequests } from "../metrics/http";
import { extractTraceContext } from "../tracing/propagation";

/**
 * Elysia observability plugin.
 *
 * One call wires up:
 * - Request ID propagation (`x-request-id` in / out; generated if absent)
 * - W3C traceparent extraction (inbound)
 * - A server span per request with OTel HTTP semconv attributes
 * - RED metrics (request count + duration histogram)
 * - In-flight request gauge
 *
 * Handlers don't need to do anything to benefit — spans and metrics are
 * emitted automatically on request lifecycle hooks.
 */
export interface ObservabilityPluginOptions {
  /** Service name, used for the span attribute `service.name`. */
  readonly serviceName: string;
}

type RequestState = {
  start: bigint;
  span: ReturnType<ReturnType<typeof trace.getTracer>["startSpan"]>;
  route: string;
  method: string;
  requestId: string;
};

const REQUEST_STATE = new WeakMap<Request, RequestState>();

const genRequestId = (): string => {
  // Cheap random ID — crypto.randomUUID() is fine and bun has it globally.
  return `req_${crypto.randomUUID().replace(/-/g, "")}`;
};

export const observabilityPlugin = (options: ObservabilityPluginOptions) => {
  const tracer = trace.getTracer("@shared/observability");

  return new Elysia({ name: "@shared/observability/plugin" })
    .onRequest(({ request, set }) => {
      const method = request.method.toUpperCase();
      const url = new URL(request.url);
      const inboundRequestId = request.headers.get("x-request-id");
      const requestId = inboundRequestId ?? genRequestId();

      // Echo the request ID back to the client so they can correlate.
      set.headers = set.headers ?? {};
      set.headers["x-request-id"] = requestId;

      // Increment in-flight gauge.
      httpServerActiveRequests.inc({ "http.request.method": method });

      // Extract inbound trace context and start a server span under it.
      const inboundCtx = extractTraceContext(request.headers);
      const span = tracer.startSpan(
        `HTTP ${method}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.request.method": method,
            "url.path": url.pathname,
            "url.scheme": url.protocol.replace(":", ""),
            "server.address": url.hostname,
            "service.name": options.serviceName,
            "osn.request.id": requestId,
          },
        },
        inboundCtx,
      );

      REQUEST_STATE.set(request, {
        start: process.hrtime.bigint(),
        span,
        route: url.pathname, // will be upgraded to route template onAfterHandle
        method,
        requestId,
      });

      // Activate the span for the duration of the request so any
      // `trace.getActiveSpan()` calls inside handlers see it.
      context.with(trace.setSpan(context.active(), span), () => {});
    })
    .onAfterHandle(({ request, route }) => {
      const state = REQUEST_STATE.get(request);
      if (state && route) {
        state.route = route;
        state.span.setAttribute("http.route", route);
      }
    })
    .onError(({ request, error, code }) => {
      const state = REQUEST_STATE.get(request);
      if (state) {
        state.span.recordException(error as Error);
        state.span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(code),
        });
      }
    })
    .onAfterResponse(({ request, set }) => {
      const state = REQUEST_STATE.get(request);
      if (!state) return;

      const durationNs = process.hrtime.bigint() - state.start;
      const durationSeconds = Number(durationNs) / 1e9;
      const status = typeof set.status === "number" ? set.status : 200;

      state.span.setAttribute("http.response.status_code", status);
      if (status >= 500) {
        state.span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` });
      }
      state.span.end();

      recordHttpRequest({
        method: state.method,
        route: state.route,
        status,
        durationSeconds,
      });
      httpServerActiveRequests.dec({ "http.request.method": state.method });

      REQUEST_STATE.delete(request);
    });
};
