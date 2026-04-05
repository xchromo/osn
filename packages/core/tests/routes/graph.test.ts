import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "effect";
import { createTestLayer } from "../helpers/db";
import { createAuthRoutes } from "../../src/routes/auth";
import { createGraphRoutes } from "../../src/routes/graph";
import { createAuthService } from "../../src/services/auth";
import type { Db } from "@osn/db/service";

const config = {
  rpId: "localhost",
  rpName: "OSN Test",
  origin: "http://localhost:5173",
  issuerUrl: "http://localhost:4000",
  jwtSecret: "test-secret-at-least-32-characters-long",
};

describe("graph routes", () => {
  let layer: ReturnType<typeof createTestLayer>;
  let authApp: ReturnType<typeof createAuthRoutes>;
  let graphApp: ReturnType<typeof createGraphRoutes>;
  let auth: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    layer = createTestLayer();
    authApp = createAuthRoutes(config, layer);
    graphApp = createGraphRoutes(config, layer);
    auth = createAuthService(config);
  });

  const runWithLayer = <A>(eff: Effect.Effect<A, unknown, Db>): Promise<A> =>
    Effect.runPromise(eff.pipe(Effect.provide(layer)) as Effect.Effect<A, never, never>);

  /** Register a user and return a valid access token for them. */
  async function registerAndGetToken(
    email: string,
    handle: string,
  ): Promise<{ userId: string; token: string }> {
    const user = await runWithLayer(auth.registerUser(email, handle));
    const tokens = await runWithLayer(
      auth.issueTokens(user.id, user.email, user.handle, user.displayName),
    );
    return { userId: user.id, token: tokens.accessToken };
  }

  // -------------------------------------------------------------------------
  // Auth guard
  // -------------------------------------------------------------------------

  it("returns 401 without token on POST /graph/connections/:handle", async () => {
    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: "Bearer not-a-valid-token" },
      }),
    );
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Connection flow
  // -------------------------------------------------------------------------

  it("POST /graph/connections/:handle → 201 sends a request", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    await registerAndGetToken("bob@example.com", "bob");

    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("GET /graph/connections/:handle returns pending_sent after request", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    await registerAndGetToken("bob@example.com", "bob");

    await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );

    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("pending_sent");
  });

  it("PATCH /graph/connections/:handle accept → connected", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    const bob = await registerAndGetToken("bob@example.com", "bob");

    await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );

    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections/alice", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bob.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "accept" }),
      }),
    );
    expect(res.status).toBe(200);

    const statusRes = await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    const json = (await statusRes.json()) as { status: string };
    expect(json.status).toBe("connected");
  });

  it("GET /graph/connections lists connected peers", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    const bob = await registerAndGetToken("bob@example.com", "bob");

    await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    await graphApp.handle(
      new Request("http://localhost/graph/connections/alice", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bob.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "accept" }),
      }),
    );

    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections", {
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { connections: { handle: string }[] };
    expect(json.connections).toHaveLength(1);
    expect(json.connections[0].handle).toBe("bob");
  });

  it("GET /graph/connections/pending lists incoming requests", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    const bob = await registerAndGetToken("bob@example.com", "bob");

    await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );

    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections/pending", {
        headers: { Authorization: `Bearer ${bob.token}` },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { pending: { handle: string }[] };
    expect(json.pending).toHaveLength(1);
    expect(json.pending[0].handle).toBe("alice");
  });

  it("DELETE /graph/connections/:handle removes connection", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    const bob = await registerAndGetToken("bob@example.com", "bob");

    await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    await graphApp.handle(
      new Request("http://localhost/graph/connections/alice", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bob.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "accept" }),
      }),
    );

    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(200);

    const statusRes = await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    const json = (await statusRes.json()) as { status: string };
    expect(json.status).toBe("none");
  });

  it("POST /graph/connections/:handle → 404 for unknown handle", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    const res = await graphApp.handle(
      new Request("http://localhost/graph/connections/nobody", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(404);
    void authApp;
  });

  // -------------------------------------------------------------------------
  // Close friends
  // -------------------------------------------------------------------------

  it("POST /graph/close-friends/:handle → 201 after connecting", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    const bob = await registerAndGetToken("bob@example.com", "bob");

    // Connect first
    await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    await graphApp.handle(
      new Request("http://localhost/graph/connections/alice", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bob.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "accept" }),
      }),
    );

    const res = await graphApp.handle(
      new Request("http://localhost/graph/close-friends/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("POST /graph/close-friends/:handle → 400 if not connected", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    await registerAndGetToken("bob@example.com", "bob");

    const res = await graphApp.handle(
      new Request("http://localhost/graph/close-friends/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("GET /graph/close-friends lists close friends", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    const bob = await registerAndGetToken("bob@example.com", "bob");

    await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    await graphApp.handle(
      new Request("http://localhost/graph/connections/alice", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bob.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "accept" }),
      }),
    );
    await graphApp.handle(
      new Request("http://localhost/graph/close-friends/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );

    const res = await graphApp.handle(
      new Request("http://localhost/graph/close-friends", {
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    const json = (await res.json()) as { closeFriends: { handle: string }[] };
    expect(json.closeFriends).toHaveLength(1);
    expect(json.closeFriends[0].handle).toBe("bob");
  });

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  it("POST /graph/blocks/:handle → 201 blocks a user", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    await registerAndGetToken("bob@example.com", "bob");

    const res = await graphApp.handle(
      new Request("http://localhost/graph/blocks/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("DELETE /graph/blocks/:handle unblocks", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    await registerAndGetToken("bob@example.com", "bob");

    await graphApp.handle(
      new Request("http://localhost/graph/blocks/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    const res = await graphApp.handle(
      new Request("http://localhost/graph/blocks/bob", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("GET /graph/blocks lists blocked users", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    await registerAndGetToken("bob@example.com", "bob");

    await graphApp.handle(
      new Request("http://localhost/graph/blocks/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );

    const res = await graphApp.handle(
      new Request("http://localhost/graph/blocks", {
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    const json = (await res.json()) as { blocks: { handle: string }[] };
    expect(json.blocks).toHaveLength(1);
    expect(json.blocks[0].handle).toBe("bob");
  });

  it("block removes existing connection", async () => {
    const alice = await registerAndGetToken("alice@example.com", "alice");
    const bob = await registerAndGetToken("bob@example.com", "bob");

    // Connect first
    await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    await graphApp.handle(
      new Request("http://localhost/graph/connections/alice", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bob.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "accept" }),
      }),
    );

    // Block
    await graphApp.handle(
      new Request("http://localhost/graph/blocks/bob", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );

    // Connection should be gone
    const statusRes = await graphApp.handle(
      new Request("http://localhost/graph/connections/bob", {
        headers: { Authorization: `Bearer ${alice.token}` },
      }),
    );
    const json = (await statusRes.json()) as { status: string };
    expect(json.status).toBe("none");
  });
});
