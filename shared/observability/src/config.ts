/**
 * Env-driven observability config. Parsed once at boot.
 *
 * All values have sensible defaults so the library is a no-op when run
 * locally without any env vars set: logs go to stdout (pretty), tracing
 * and metrics exporters are disabled unless `OTEL_EXPORTER_OTLP_ENDPOINT`
 * is present.
 */

export type DeploymentEnvironment = "dev" | "staging" | "production";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface ObservabilityConfig {
  /** Service name, e.g. "pulse-api" — becomes `service.name` resource attribute. */
  readonly serviceName: string;
  /** Service version, e.g. "0.4.4" — becomes `service.version`. */
  readonly serviceVersion: string;
  /** Always "osn" — becomes `service.namespace`. */
  readonly serviceNamespace: string;
  /** `<hostname>-<pid>` — becomes `service.instance.id`. */
  readonly serviceInstanceId: string;
  /** Deployment environment — becomes `deployment.environment`. */
  readonly env: DeploymentEnvironment;
  /** Minimum log level to emit. */
  readonly logLevel: LogLevel;
  /** OTLP exporter endpoint (HTTP). If unset, exporters are disabled. */
  readonly otlpEndpoint: string | undefined;
  /** Optional headers for the OTLP exporter (e.g. auth tokens for SaaS). */
  readonly otlpHeaders: Record<string, string>;
  /** Trace sampling ratio in [0, 1]. Defaults to 1.0 in dev, 0.1 in prod. */
  readonly traceSampleRatio: number;
}

const parseEnv = (value: string | undefined): DeploymentEnvironment => {
  switch (value) {
    case "production":
    case "prod":
      return "production";
    case "staging":
    case "stage":
      return "staging";
    default:
      return "dev";
  }
};

const parseLogLevel = (value: string | undefined): LogLevel => {
  switch (value) {
    case "trace":
    case "debug":
    case "info":
    case "warn":
    case "error":
    case "fatal":
      return value;
    default:
      return "info";
  }
};

const parseHeaders = (value: string | undefined): Record<string, string> => {
  if (!value) return {};
  const out: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
};

const parseSampleRatio = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = Number(value);
  if (Number.isNaN(n) || n < 0 || n > 1) return fallback;
  return n;
};

const instanceId = (serviceName: string): string => {
  const host = typeof process !== "undefined" ? process.env.HOSTNAME || "local" : "local";
  const pid = typeof process !== "undefined" ? String(process.pid) : "0";
  return `${serviceName}-${host}-${pid}`;
};

export interface ConfigOverrides {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly env?: DeploymentEnvironment;
}

export const loadConfig = (overrides: ConfigOverrides = {}): ObservabilityConfig => {
  const env = overrides.env ?? parseEnv(process.env.OSN_ENV ?? process.env.NODE_ENV ?? undefined);
  const serviceName = overrides.serviceName ?? process.env.OSN_SERVICE_NAME ?? "osn-service";
  const serviceVersion = overrides.serviceVersion ?? process.env.OSN_SERVICE_VERSION ?? "0.0.0";

  return {
    serviceName,
    serviceVersion,
    serviceNamespace: "osn",
    serviceInstanceId: instanceId(serviceName),
    env,
    logLevel: parseLogLevel(process.env.OSN_LOG_LEVEL),
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpHeaders: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    traceSampleRatio: parseSampleRatio(
      process.env.OSN_TRACE_SAMPLE_RATIO,
      env === "production" ? 0.1 : 1.0,
    ),
  };
};
