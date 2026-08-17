import { accounts, organisations, users } from "@osn/db/schema";
import { generateArcKeyPair } from "@shared/crypto";
import { createMemoryClient } from "@shared/redis";
import { exportJWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { buildAppDeps } from "../src/build-deps";
import { osnLoggerLayer } from "../src/observability";
import { DEV_PRINCIPAL } from "../src/routes/auth/dev-login";
import { createTestLayerWithSqlite } from "./helpers/db";

/**
 * The dev sign-in bypass. Passkeys are the only primary login factor, which
 * makes a seeded fixture account unreachable: nobody can enrol a WebAuthn
 * credential for a row a seed script wrote. `GET|POST /dev/login` mints a real
 * OSN session for that fixture so the whole OIDC chain downstream (organiser
 * portal, vendor portal, `@osn/social`) runs untouched.
 *
 * It is gated twice and both gates must hold:
 *  - tier — `local` or `dev` only, derived from the request-scoped env record
 *    the same way `includeOpenapiPlugin` is, and failing closed on a tier
 *    string neither parser recognises;
 *  - secret — `DEV_LOGIN_SECRET`, key-optional: unset ⇒ the routes are never
 *    mounted, so the surface is a 404 rather than a 401 that admits it exists.
 */

let privB64 = "";
let pubB64 = "";
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64");

beforeAll(async () => {
  const { privateKey, publicKey } = await generateArcKeyPair();
  privB64 = b64(await exportJWK(privateKey));
  pubB64 = b64(await exportJWK(publicKey));
});

const SECRET = "d".repeat(32);

/** A deployed env that satisfies every non-local guard, so the tier is what varies. */
const deployedEnv = (osnEnv: string): Record<string, string> => ({
  OSN_ENV: osnEnv,
  OSN_ISSUER_URL: "https://api.osn.test",
  OSN_ORIGIN: "https://api.osn.test",
  OSN_CORS_ORIGIN: "https://app.osn.test",
  OSN_RP_ID: "osn.test",
  OSN_JWT_PRIVATE_KEY: privB64,
  OSN_JWT_PUBLIC_KEY: pubB64,
  OSN_SESSION_IP_PEPPER: "x".repeat(32),
  OSN_PAIRWISE_SALT: "p".repeat(32),
});

async function build(env: Record<string, string | undefined>) {
  const { layer, db } = createTestLayerWithSqlite();
  const built = await buildAppDeps(env, {
    redisClient: createMemoryClient(),
    dbAndEmailLayer: layer,
    observabilityLayer: osnLoggerLayer,
    includeObservabilityPlugin: false,
  });
  return { deps: built.deps, app: createApp(built.deps), db };
}

const get = (path: string) => new Request(`http://localhost${path}`);

describe("dev-login gate", () => {
  it("derives the config from the env record, not process.env", async () => {
    const local = await build({ DEV_LOGIN_SECRET: SECRET });
    const prod = await build({ ...deployedEnv("production"), DEV_LOGIN_SECRET: SECRET });
    expect(local.deps.devLogin).not.toBeNull();
    expect(prod.deps.devLogin).toBeNull();
  });

  it("is absent when DEV_LOGIN_SECRET is unset, even on local", async () => {
    const { deps, app } = await build({});
    expect(deps.devLogin).toBeNull();
    const res = await app.handle(get("/dev/login"));
    expect(res.status).toBe(404);
  });

  it("mounts on local (an absent OSN_ENV reads as local)", async () => {
    const { app } = await build({ DEV_LOGIN_SECRET: SECRET });
    const res = await app.handle(get(`/dev/login?secret=${SECRET}`));
    expect(res.status).toBe(200);
  });

  it("mounts on the dev tier", async () => {
    const { app } = await build({ ...deployedEnv("dev"), DEV_LOGIN_SECRET: SECRET });
    const res = await app.handle(get(`/dev/login?secret=${SECRET}`));
    expect(res.status).toBe(200);
  });

  it("is absent on staging", async () => {
    const { app } = await build({ ...deployedEnv("staging"), DEV_LOGIN_SECRET: SECRET });
    expect((await app.handle(get(`/dev/login?secret=${SECRET}`))).status).toBe(404);
  });

  it("is absent on production", async () => {
    const { app } = await build({ ...deployedEnv("production"), DEV_LOGIN_SECRET: SECRET });
    expect((await app.handle(get(`/dev/login?secret=${SECRET}`))).status).toBe(404);
  });

  // Fails closed the same way the OpenAPI gate does: `isNonLocal` counts
  // anything that isn't exactly `local` as deployed, and
  // `parseDeploymentEnvironment` answers `dev` only for `dev`/`development`.
  it("is absent on an unrecognised tier string", async () => {
    const { app } = await build({ ...deployedEnv("developement"), DEV_LOGIN_SECRET: SECRET });
    expect((await app.handle(get(`/dev/login?secret=${SECRET}`))).status).toBe(404);
  });
});

describe("dev-login", () => {
  it("rejects a wrong secret with 401 and sets no cookie", async () => {
    const { app } = await build({ DEV_LOGIN_SECRET: SECRET });
    const res = await app.handle(get("/dev/login?secret=nope"));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a missing secret with 401", async () => {
    const { app } = await build({ DEV_LOGIN_SECRET: SECRET });
    expect((await app.handle(get("/dev/login"))).status).toBe(401);
  });

  it("issues a session for the seeded dev principal", async () => {
    const { app } = await build({ DEV_LOGIN_SECRET: SECRET });
    const res = await app.handle(get(`/dev/login?secret=${SECRET}`));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      session: { access_token: string; token_type: string };
      profile: { id: string; handle: string };
    };
    // The cire dev seed writes this exact profile id as the seeded wedding's
    // owner, so the session must name it or the organiser portal signs in as a
    // stranger with nothing to show.
    expect(body.profile.id).toBe(DEV_PRINCIPAL.profileId);
    expect(body.profile.handle).toBe(DEV_PRINCIPAL.handle);
    expect(body.session.token_type).toBe("Bearer");
    expect(body.session.access_token.length).toBeGreaterThan(0);
    // The refresh token stays out of the body (S-M2) — cookie only.
    expect(JSON.stringify(body.session)).not.toContain("refresh");

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("osn_session=");
  });

  it("provisions the principal exactly once across repeated calls", async () => {
    // `osn-db-dev` is never reset, so provisioning has to survive being run on
    // every sign-in and every deploy without piling up rows.
    const { app, db } = await build({ DEV_LOGIN_SECRET: SECRET });
    await app.handle(get(`/dev/login?secret=${SECRET}`));
    await app.handle(get(`/dev/login?secret=${SECRET}`));

    expect(await db.select().from(accounts)).toHaveLength(1);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(organisations)).toHaveLength(1);
  });

  it("redirects to an allowlisted return_to, carrying the cookie", async () => {
    const { app } = await build({ DEV_LOGIN_SECRET: SECRET });
    const target = "http://localhost:4322/dashboard";
    const res = await app.handle(
      get(`/dev/login?secret=${SECRET}&return_to=${encodeURIComponent(target)}`),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(target);
    expect(res.headers.get("set-cookie") ?? "").toContain("osn_session=");
  });

  it("refuses a return_to outside the CORS allowlist", async () => {
    const { app } = await build({ DEV_LOGIN_SECRET: SECRET });
    const res = await app.handle(
      get(`/dev/login?secret=${SECRET}&return_to=${encodeURIComponent("https://evil.test/x")}`),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});
