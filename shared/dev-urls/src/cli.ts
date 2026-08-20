#!/usr/bin/env bun
/**
 * `dev-env` — run an app's dev server with its cross-app URLs filled in.
 *
 * Used as the front half of every app's `dev:app` script:
 *
 *     "dev": "portless",
 *     "dev:app": "dev-env astro dev"
 *
 * Portless gives each app a stable hostname and, in a linked git worktree, its
 * own branch-prefixed copy of it. So `@cire/host` cannot be told where
 * `@cire/api` lives in a committed `.env` — the answer depends on which
 * worktree it is running in. This wrapper reads the app's own `PORTLESS_URL`,
 * derives its siblings' origins from it (see `./index.ts`), and puts them in
 * the environment before handing over to the real dev command.
 *
 * Keeping it here rather than in each app's source means no app has to know
 * that portless exists; they keep reading the same env vars the deployed tiers
 * set. The values win over any `.env` file: under portless a `localhost:4321`
 * origin names a host nothing is listening on. Run `PORTLESS=0 bun run dev:app`
 * (or drop the wrapper) to get the fixed-port devloop back.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEV_APPS, devOriginList, devRpId, devUrls, type DevAppId } from "./index";

type Urls = Record<DevAppId, string>;

/**
 * What each app needs to know about the others, keyed by the env var the app
 * already reads. Deployed tiers set the same names from `wrangler.toml`; this
 * is only the local-devloop answer.
 */
const DEV_ENV = {
  "@osn/api": (urls, self) => {
    // Browsers that fetch this Worker with credentials. The same list feeds the
    // CSRF origin guard, so it stays as tight as the deployed one.
    const browsers = devOriginList(
      ["@osn/social", "@pulse/web", "@cire/invites", "@cire/host", "@cire/vendor"],
      self,
    );
    return {
      OSN_ISSUER_URL: urls["@osn/api"],
      // Passkeys are created on `musubi.*` and verified here on `id.musubi.*`,
      // so the RP ID has to be the parent both share. See `devRpId`.
      OSN_RP_ID: devRpId(self),
      OSN_ORIGIN: browsers,
      OSN_CORS_ORIGIN: browsers,
      // Redirect targets for `GET /dev/login?return_to=…`. Its own list, kept
      // separate from the CORS one exactly as in `wrangler.toml`.
      DEV_LOGIN_RETURN_ORIGINS: devOriginList(
        ["@osn/social", "@cire/host", "@cire/vendor", "@cire/invites"],
        self,
      ),
      // Server-to-server, for account export and erasure fan-out.
      PULSE_API_URL: urls["@pulse/api"],
      ZAP_API_URL: urls["@zap/api"],
    };
  },
  "@cire/api": (urls, self) => ({
    WEB_ORIGIN: devOriginList(["@cire/invites", "@cire/host", "@cire/vendor"], self),
    OSN_ISSUER_URL: urls["@osn/api"],
    OSN_JWKS_URL: `${urls["@osn/api"]}/.well-known/jwks.json`,
    // Builds the organiser sign-in redirect URI, which has to match the one
    // registered with the OSN client.
    CIRE_API_ORIGIN: urls["@cire/api"],
    ZAP_API_URL: urls["@zap/api"],
  }),
  "@pulse/api": (urls) => ({
    OSN_ISSUER_URL: urls["@osn/api"],
    OSN_JWKS_URL: `${urls["@osn/api"]}/.well-known/jwks.json`,
    PULSE_API_ORIGIN: urls["@pulse/api"],
    PULSE_CORS_ORIGIN: urls["@pulse/web"],
  }),
  "@osn/social": (urls) => ({
    VITE_OSN_ISSUER_URL: urls["@osn/api"],
  }),
  "@osn/landing": (urls) => ({
    PUBLIC_APP_URL: urls["@osn/social"],
  }),
  "@pulse/web": (urls) => ({
    VITE_API_URL: urls["@pulse/api"],
    VITE_OSN_ISSUER_URL: urls["@osn/api"],
  }),
  "@pulse/landing": (urls) => ({
    PUBLIC_APP_URL: urls["@pulse/web"],
  }),
  "@cire/invites": (urls) => ({
    PUBLIC_API_URL: urls["@cire/api"],
    PUBLIC_MARKETING_URL: urls["@cire/landing"],
    PUBLIC_SITE_URL: urls["@cire/invites"],
  }),
  "@cire/host": (urls) => ({
    PUBLIC_API_URL: urls["@cire/api"],
    PUBLIC_CIRE_API_URL: urls["@cire/api"],
    PUBLIC_CIRE_WEB_URL: urls["@cire/invites"],
    PUBLIC_OSN_ACCOUNT_URL: urls["@osn/social"],
  }),
  "@cire/vendor": (urls) => ({
    PUBLIC_API_URL: urls["@cire/api"],
    PUBLIC_CIRE_API_URL: urls["@cire/api"],
    PUBLIC_OSN_ACCOUNT_URL: urls["@osn/social"],
  }),
  "@cire/landing": (urls) => ({
    PUBLIC_ORGANISER_URL: urls["@cire/host"],
    PUBLIC_DEMO_INVITE_URL: urls["@cire/invites"],
  }),
  // `@zap/api` reads no cross-app URL locally, so it has no entry.
} satisfies Partial<Record<DevAppId, (urls: Urls, self: DevAppId) => Record<string, string>>>;

/** The package this was invoked from, which is also its key in `DEV_APPS`. */
function selfId(): DevAppId {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as {
    name?: string;
  };
  const name = pkg.name ?? "";
  if (!(name in DEV_APPS)) {
    throw new Error(
      `dev-env: ${name || process.cwd()} is not in DEV_APPS (shared/dev-urls). Add it there and in portless.json.`,
    );
  }
  return name as DevAppId;
}

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("usage: dev-env <command> [args...]");
  process.exit(64);
}

const self = selfId();
const build = self in DEV_ENV ? DEV_ENV[self as keyof typeof DEV_ENV] : undefined;
const overrides = process.env.PORTLESS_URL && build ? build(devUrls(self), self) : {};

if (Object.keys(overrides).length > 0) {
  console.log(`dev-env: ${self} -> ${process.env.PORTLESS_URL}`);
}

const child = spawn(command[0]!, command.slice(1), {
  stdio: "inherit",
  env: { ...process.env, ...overrides },
});

// Portless (and turbo above it) stop the devloop by signalling this process.
// The real dev server is a grandchild, so pass the signal down rather than
// dying and orphaning it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`dev-env: could not run ${command.join(" ")}:`, error.message);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  // Report a signalled death the way a shell does, so turbo sees the same
  // exit status it would without this wrapper.
  process.exit(signal ? 128 + (signalNumber(signal) ?? 0) : (code ?? 0));
});

function signalNumber(signal: NodeJS.Signals): number | undefined {
  return { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal as "SIGHUP" | "SIGINT" | "SIGTERM"];
}
