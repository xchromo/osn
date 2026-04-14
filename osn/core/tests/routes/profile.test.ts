import { Effect } from "effect";
import { describe, it, expect, beforeEach } from "vitest";

import { createProfileRoutes } from "../../src/routes/profile";
import { createAuthService } from "../../src/services/auth";
import { createTestLayer } from "../helpers/db";

const config = {
  rpId: "localhost",
  rpName: "OSN Test",
  origin: "http://localhost:5173",
  issuerUrl: "http://localhost:4000",
  jwtSecret: "test-secret-at-least-32-characters-long",
};

describe("profile routes", () => {
  let profileApp: ReturnType<typeof createProfileRoutes>;
  let layer: ReturnType<typeof createTestLayer>;
  let auth: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    layer = createTestLayer();
    profileApp = createProfileRoutes(config, layer);
    auth = createAuthService(config);
  });

  /** Helper: register + get refresh token via service layer. */
  async function getRefreshToken(email: string, handle: string): Promise<string> {
    const profile = await Effect.runPromise(
      auth.registerProfile(email, handle).pipe(Effect.provide(layer)),
    );
    const tokens = await Effect.runPromise(
      auth
        .issueTokens(
          profile.id,
          profile.accountId,
          profile.email,
          profile.handle,
          profile.displayName,
        )
        .pipe(Effect.provide(layer)),
    );
    return tokens.refreshToken;
  }

  // -------------------------------------------------------------------------
  // POST /profiles/create
  // -------------------------------------------------------------------------
  describe("POST /profiles/create", () => {
    it("returns 201 on success with profile data", async () => {
      const rt = await getRefreshToken("pc@test.com", "pcuser");
      const res = await profileApp.handle(
        new Request("http://localhost/profiles/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt, handle: "pc_alt" }),
        }),
      );
      expect(res.status).toBe(201);
      const json = (await res.json()) as { profile: { id: string; handle: string } };
      expect(json.profile.handle).toBe("pc_alt");
      expect(json.profile.id).toMatch(/^usr_/);
    });

    it("returns 400 for invalid handle", async () => {
      const rt = await getRefreshToken("bad@test.com", "baduser");
      const res = await profileApp.handle(
        new Request("http://localhost/profiles/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt, handle: "BADHANDLE" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid refresh token", async () => {
      const res = await profileApp.handle(
        new Request("http://localhost/profiles/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: "bad-token", handle: "somehandle" }),
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /profiles/delete
  // -------------------------------------------------------------------------
  describe("POST /profiles/delete", () => {
    it("returns 200 on success", async () => {
      const rt = await getRefreshToken("pd@test.com", "pduser");
      // Create a second profile first
      const createRes = await profileApp.handle(
        new Request("http://localhost/profiles/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt, handle: "pd_alt" }),
        }),
      );
      const { profile: created } = (await createRes.json()) as {
        profile: { id: string };
      };

      const res = await profileApp.handle(
        new Request("http://localhost/profiles/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt, profile_id: created.id }),
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { deleted: boolean };
      expect(json.deleted).toBe(true);
    });

    it("returns 400 for deleting the last profile", async () => {
      const p = await Effect.runPromise(
        auth.registerProfile("lastrd@test.com", "lastrduser").pipe(Effect.provide(layer)),
      );
      const tokens = await Effect.runPromise(
        auth
          .issueTokens(p.id, p.accountId, p.email, p.handle, p.displayName)
          .pipe(Effect.provide(layer)),
      );
      const res = await profileApp.handle(
        new Request("http://localhost/profiles/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: tokens.refreshToken, profile_id: p.id }),
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /profiles/:profileId/default
  // -------------------------------------------------------------------------
  describe("POST /profiles/:profileId/default", () => {
    it("returns 200 on success with profile data", async () => {
      const rt = await getRefreshToken("sd@test.com", "sduser");
      const createRes = await profileApp.handle(
        new Request("http://localhost/profiles/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt, handle: "sd_alt" }),
        }),
      );
      const { profile: created } = (await createRes.json()) as {
        profile: { id: string; handle: string };
      };

      const res = await profileApp.handle(
        new Request(`http://localhost/profiles/${created.id}/default`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt }),
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { profile: { id: string; handle: string } };
      expect(json.profile.handle).toBe("sd_alt");
    });

    it("returns 400 for invalid refresh token", async () => {
      const res = await profileApp.handle(
        new Request("http://localhost/profiles/usr_000000000000/default", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: "bad-token" }),
        }),
      );
      expect(res.status).toBe(400);
    });
  });
});
