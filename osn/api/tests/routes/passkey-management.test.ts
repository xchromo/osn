import { passkeys } from "@osn/db/schema";
import { Db } from "@osn/db/service";
import { Effect } from "effect";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

import { createAuthRoutes } from "../../src/routes/auth";
import { createAuthService } from "../../src/services/auth";
import { makeTestAuthConfig } from "../helpers/auth-config";
import { createTestLayer } from "../helpers/db";

/**
 * Route-level coverage for the passkey management surface:
 *   GET    /passkeys
 *   PATCH  /passkeys/:id
 *   DELETE /passkeys/:id      — step-up gated
 */

let config: Awaited<ReturnType<typeof makeTestAuthConfig>>;

beforeAll(async () => {
  config = await makeTestAuthConfig();
});

describe("passkey management routes", () => {
  let app: ReturnType<typeof createAuthRoutes>;
  let layer: ReturnType<typeof createTestLayer>;
  let svc: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    layer = createTestLayer();
    app = createAuthRoutes(config, layer);
    svc = createAuthService(config);
  });

  async function seedAccount() {
    const profile = await Effect.runPromise(
      svc.registerProfile("pk-mgmt@example.com", "pkmgmt").pipe(Effect.provide(layer)),
    );
    const tokens = await Effect.runPromise(
      svc
        .issueTokens(
          profile.id,
          profile.accountId,
          profile.email,
          profile.handle,
          profile.displayName,
        )
        .pipe(Effect.provide(layer)),
    );
    return { profile, tokens };
  }

  async function seedPasskey(accountId: string, label: string | null = null) {
    const id = `pk_${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Db;
        yield* Effect.tryPromise(() =>
          db.insert(passkeys).values({
            id,
            accountId,
            credentialId: `cred-${id}`,
            publicKey: "AAAA",
            counter: 0,
            transports: null,
            createdAt: new Date(),
            label,
            lastUsedAt: null,
            aaguid: null,
            backupEligible: false,
            backupState: false,
            updatedAt: null,
          }),
        );
      }).pipe(Effect.provide(layer)),
    );
    return id;
  }

  describe("GET /passkeys", () => {
    it("returns 401 without bearer", async () => {
      const res = await app.handle(new Request("http://localhost/passkeys"));
      expect(res.status).toBe(401);
    });

    it("returns the caller's passkeys", async () => {
      const { tokens, profile } = await seedAccount();
      await seedPasskey(profile.accountId, "Laptop");
      const res = await app.handle(
        new Request("http://localhost/passkeys", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { passkeys: { label: string | null }[] };
      expect(json.passkeys).toHaveLength(1);
      expect(json.passkeys[0]!.label).toBe("Laptop");
    });
  });

  describe("PATCH /passkeys/:id", () => {
    it("returns 401 without bearer", async () => {
      const res = await app.handle(
        new Request("http://localhost/passkeys/pk_abcdef012345", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "X" }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("renames a passkey", async () => {
      const { tokens, profile } = await seedAccount();
      const pk = await seedPasskey(profile.accountId);
      const res = await app.handle(
        new Request(`http://localhost/passkeys/${pk}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ label: "Renamed" }),
        }),
      );
      expect(res.status).toBe(200);
    });

    it("rejects malformed passkey ids at the route layer", async () => {
      const { tokens } = await seedAccount();
      const res = await app.handle(
        new Request("http://localhost/passkeys/not-a-pk-id", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ label: "X" }),
        }),
      );
      // Elysia's TypeBox validator rejects with 422.
      expect([400, 422]).toContain(res.status);
    });
  });

  describe("DELETE /passkeys/:id", () => {
    it("returns 401 without bearer", async () => {
      const res = await app.handle(
        new Request("http://localhost/passkeys/pk_abcdef012345", { method: "DELETE" }),
      );
      expect(res.status).toBe(401);
    });

    it("returns 403 without step-up token", async () => {
      const { tokens, profile } = await seedAccount();
      const pk = await seedPasskey(profile.accountId);
      await seedPasskey(profile.accountId);
      const res = await app.handle(
        new Request(`http://localhost/passkeys/${pk}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
      );
      expect(res.status).toBe(403);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe("step_up_required");
    });
  });
});
