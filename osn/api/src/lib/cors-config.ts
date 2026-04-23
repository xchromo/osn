/**
 * CORS / Origin-guard allowlist derivation.
 *
 * Centralised so the fallback list and the non-local fail-closed invariant
 * (S-L4) can be unit-tested in isolation from module-scope bootstrap in
 * `src/index.ts`.
 */

/**
 * Frontend dev ports used by the monorepo's Tauri apps. Used as the CORS
 * fallback when neither `OSN_CORS_ORIGIN` nor a non-local `OSN_ENV` is set,
 * so handle checks and passkey ceremonies work out-of-the-box. Kept separate
 * from the WebAuthn `OSN_ORIGIN` — that defaults to 5173 for the SDK's
 * example app and is a distinct concern.
 */
export const LOCAL_DEV_CORS_ORIGINS = [
  "http://localhost:1420", // @pulse/app
  "http://localhost:1422", // @osn/social
] as const;

export type CorsEnv = Readonly<Record<string, string | undefined>>;

export function resolveCorsOrigins(env: CorsEnv): string[] {
  const raw = env.OSN_CORS_ORIGIN;
  if (raw) {
    return raw
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }
  const osnEnv = env.OSN_ENV;
  const isLocal = !osnEnv || osnEnv === "local";
  return isLocal ? [...LOCAL_DEV_CORS_ORIGINS] : [];
}

/**
 * S-L4: refuse to boot a non-local deploy with an empty CORS allowlist —
 * the Origin guard would silently allow every request through if it did.
 */
export function assertCorsOriginsConfigured(origins: readonly string[], secure: boolean): void {
  if (secure && origins.length === 0) {
    throw new Error(
      "OSN_CORS_ORIGIN must be set in non-local environments — Origin guard is mandatory for CSRF protection",
    );
  }
}
