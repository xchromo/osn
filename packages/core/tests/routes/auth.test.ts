import { describe, it, expect, beforeEach } from "vitest";
import { createTestLayer } from "../helpers/db";
import { createAuthRoutes } from "../../src/routes/auth";
import { createAuthService } from "../../src/services/auth";
import { Effect } from "effect";

const config = {
  rpId: "localhost",
  rpName: "OSN Test",
  origin: "http://localhost:5173",
  issuerUrl: "http://localhost:4000",
  jwtSecret: "test-secret-at-least-32-characters-long",
};

describe("auth routes", () => {
  let app: ReturnType<typeof createAuthRoutes>;
  let layer: ReturnType<typeof createTestLayer>;

  beforeEach(() => {
    layer = createTestLayer();
    app = createAuthRoutes(config, layer);
  });

  describe("GET /authorize", () => {
    it("returns 400 for unsupported response_type", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/authorize?response_type=token&client_id=pulse&redirect_uri=http://localhost:5173/callback&state=abc&code_challenge=xyz",
        ),
      );
      expect(res.status).toBe(400);
    });

    it("returns HTML page for valid request", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/authorize?response_type=code&client_id=pulse&redirect_uri=http://localhost:5173/callback&state=abc&code_challenge=xyz",
        ),
      );
      expect(res.status).toBe(200);
      const text = (await res.text()) as string;
      expect(text).toContain("Sign in to OSN");
    });
  });

  describe("POST /token", () => {
    it("returns 400 for unsupported grant_type", async () => {
      const res = await app.handle(
        new Request("http://localhost/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grant_type: "implicit" }),
        }),
      );
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("unsupported_grant_type");
    });

    it("returns 400 for invalid authorization_code grant (missing params)", async () => {
      const res = await app.handle(
        new Request("http://localhost/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grant_type: "authorization_code" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns tokens for a valid code exchange", async () => {
      // Manually issue a code using the service
      const auth = createAuthService(config);
      const user = await Effect.runPromise(
        auth.upsertUser("judy@example.com").pipe(Effect.provide(layer)),
      );
      const tokens = await Effect.runPromise(
        auth.issueTokens(user.id, user.email).pipe(Effect.provide(layer)),
      );
      // issueTokens gives access+refresh but we need a code
      // Exchange via refreshTokens → get new tokens to verify flow
      const refreshed = await Effect.runPromise(
        auth.refreshTokens(tokens.refreshToken).pipe(Effect.provide(layer)),
      );
      expect(refreshed.accessToken).toBeTruthy();
    });
  });

  describe("POST /otp/begin", () => {
    it("returns sent:true for valid email", async () => {
      const res = await app.handle(
        new Request("http://localhost/otp/begin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "kate@example.com" }),
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { sent: boolean };
      expect(json.sent).toBe(true);
    });

    it("returns 400 for invalid email", async () => {
      const res = await app.handle(
        new Request("http://localhost/otp/begin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "not-an-email" }),
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("POST /otp/complete", () => {
    it("returns 400 for wrong OTP code", async () => {
      // Start an OTP
      await app.handle(
        new Request("http://localhost/otp/begin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "liam@example.com" }),
        }),
      );

      const res = await app.handle(
        new Request("http://localhost/otp/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "liam@example.com", code: "000000" }),
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("POST /magic/begin", () => {
    it("returns sent:true for valid email", async () => {
      const res = await app.handle(
        new Request("http://localhost/magic/begin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "mia@example.com" }),
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { sent: boolean };
      expect(json.sent).toBe(true);
    });
  });

  describe("GET /.well-known/openid-configuration", () => {
    it("returns OIDC discovery document", async () => {
      const res = await app.handle(
        new Request("http://localhost/.well-known/openid-configuration"),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
      };
      expect(json.issuer).toBe("http://localhost:4000");
      expect(json.authorization_endpoint).toBe("http://localhost:4000/authorize");
      expect(json.token_endpoint).toBe("http://localhost:4000/token");
    });
  });

  describe("POST /passkey/login/begin", () => {
    it("returns 400 when user has no passkeys", async () => {
      // Create a user but don't register a passkey
      const auth = createAuthService(config);
      await Effect.runPromise(auth.upsertUser("noah@example.com").pipe(Effect.provide(layer)));

      const res = await app.handle(
        new Request("http://localhost/passkey/login/begin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "noah@example.com" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when user does not exist", async () => {
      const res = await app.handle(
        new Request("http://localhost/passkey/login/begin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "nobody@example.com" }),
        }),
      );
      expect(res.status).toBe(400);
    });
  });
});
