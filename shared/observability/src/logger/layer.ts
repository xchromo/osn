import { Formatter, Layer, LogLevel, Logger, References } from "effect";

import type { LogLevel as ConfigLogLevel, ObservabilityConfig } from "../config";
import { redact } from "./redact";

/**
 * v4 log levels are string literals, not branded constructors. Note `"Warn"`,
 * not v3's `"Warning"` — the two majors spell that one differently.
 */
const LOG_LEVEL_MAP = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
} satisfies { readonly [K in ConfigLogLevel]: LogLevel.LogLevel };

/**
 * A logger that resolves an entry to its structured form, scrubs the
 * deny-listed values out of it, and hands the result to `format`.
 *
 * Redaction happens on the **output** side, and it has to. In v3 the redacting
 * logger sat on the input: `Logger.Options` carried `annotations`, so a wrapper
 * could rewrite them before delegating. v4 moved annotations onto the fiber —
 * `Options` is now just `message`, `logLevel`, `cause`, `fiber`, `date`, and
 * each logger reads `References.CurrentLogAnnotations` for itself. There is no
 * longer an input to intercept, and dropping the annotation pass silently
 * type-checks while every `Effect.annotateLogs` value reaches the sink in
 * clear.
 *
 * `Logger.formatStructured` is the seam that replaces it: its output object
 * already holds the resolved `message` and an `annotations` record, so
 * scrubbing that covers whatever the fiber carried, wherever it came from.
 */
const makeRedactingLogger = (format: (entry: unknown) => string): Logger.Logger<unknown, void> =>
  Logger.withConsoleLog(
    Logger.map(Logger.formatStructured, (entry) => ({
      ...entry,
      message: redact(entry.message),
      // The whole record, not a per-value map. `redact` enforces the deny-list
      // against an object's KEYS (see redact.ts §Matching rules), so handing it
      // one annotation value at a time shows it a bare scalar and it passes
      // everything through. v3 mapped per value and therefore never redacted a
      // top-level annotation key at all — `Effect.annotateLogs({ accessToken })`
      // reached the sink in clear. Passing the record fixes that.
      annotations: redact(entry.annotations),
    })).pipe(Logger.map(format)),
  );

/**
 * Returns a Layer that:
 * - Replaces Effect's logger set with a redacting logger — indented and
 *   readable on a developer's own terminal, JSON everywhere a machine reads it
 * - Keeps `Logger.tracerLogger` alongside it, so log lines stay attached to
 *   their span
 * - Applies the configured minimum log level
 *
 * `dev` gets JSON, not the readable form. It reads like a developer tier but it
 * is a deployed one: its logs land in Workers Logs alongside production's,
 * where multi-line output costs several ingested events per entry and cannot be
 * queried by field. `local` is the only tier with a human watching stdout.
 *
 * **`Logger.layer` replaces the whole active set**, where v3's `Logger.replace`
 * swapped a single logger and left the rest standing. `Logger.tracerLogger` is
 * therefore listed explicitly: omit it and log-to-span correlation disappears
 * with no error and no failing type-check. `{ mergeWithExisting: true }` is not
 * the v3 equivalent either — it *adds* to the set, leaving the default logger
 * running alongside so every line is emitted twice.
 *
 * Provide this once at the top of the application (via `ObservabilityLive`
 * in `../index.ts`).
 */
export const makeLoggerLayer = (config: ObservabilityConfig): Layer.Layer<never> => {
  const format =
    config.env === "local"
      ? (entry: unknown) => Formatter.format(entry, { space: 2 })
      : (entry: unknown) => Formatter.formatJson(entry);

  return Layer.mergeAll(
    Logger.layer([makeRedactingLogger(format), Logger.tracerLogger]),
    Layer.succeed(References.MinimumLogLevel, LOG_LEVEL_MAP[config.logLevel]),
  );
};
