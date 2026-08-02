import { it, expect, describe } from "@effect/vitest";
import { Effect } from "effect";
import { beforeAll } from "vitest";

import { createAuthService } from "../../src/services/auth";
import { createGraphService } from "../../src/services/graph";
import { createOrganisationService } from "../../src/services/organisation";
import { createRecommendationService } from "../../src/services/recommendations";
import { makeTestAuthConfig } from "../helpers/auth-config";
import { createTestLayer } from "../helpers/db";

let config: Awaited<ReturnType<typeof makeTestAuthConfig>>;
let auth: ReturnType<typeof createAuthService>;
const graph = createGraphService();
const orgs = createOrganisationService();
const recs = createRecommendationService();

beforeAll(async () => {
  config = await makeTestAuthConfig();
  auth = createAuthService(config);
});

// Connect two users bidirectionally (request + accept).
const connect = (a: string, b: string) =>
  Effect.gen(function* () {
    yield* graph.sendConnectionRequest(a, b);
    yield* graph.acceptConnection(b, a);
  });

describe("suggestConnections", () => {
  it.effect("returns [] when caller has no connections", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("alice@example.com", "alice");
      const result = yield* recs.suggestConnections(alice.id);
      expect(result).toEqual([]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("surfaces friends-of-friends with correct mutual count", () =>
    Effect.gen(function* () {
      // alice <-> bob, alice <-> charlie; bob <-> dana; charlie <-> dana
      // alice should be suggested dana with mutualCount = 2
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const charlie = yield* auth.registerProfile("c@e.com", "charlie");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      yield* connect(alice.id, bob.id);
      yield* connect(alice.id, charlie.id);
      yield* connect(bob.id, dana.id);
      yield* connect(charlie.id, dana.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result).toHaveLength(1);
      expect(result[0]!.handle).toBe("dana");
      expect(result[0]!.mutualCount).toBe(2);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("excludes existing connections of the caller", () =>
    Effect.gen(function* () {
      // alice <-> bob, alice <-> dana, bob <-> dana
      // dana is already connected to alice — should NOT appear as suggestion
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      yield* connect(alice.id, bob.id);
      yield* connect(alice.id, dana.id);
      yield* connect(bob.id, dana.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result).toEqual([]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("excludes the caller from their own suggestions", () =>
    Effect.gen(function* () {
      // alice <-> bob, bob <-> alice — ensure caller never suggests self
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      yield* connect(alice.id, bob.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result.map((s) => s.handle)).not.toContain("alice");
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("excludes blocked profiles (either direction)", () =>
    Effect.gen(function* () {
      // alice <-> bob; bob <-> dana; alice blocks dana -> dana should not appear
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      yield* connect(alice.id, bob.id);
      yield* connect(bob.id, dana.id);
      yield* graph.blockProfile(alice.id, dana.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result.map((s) => s.handle)).not.toContain("dana");
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("sorts suggestions by mutual count descending", () =>
    Effect.gen(function* () {
      // alice <-> bob, alice <-> charlie
      // bob <-> dana (dana has 1 mutual via bob)
      // bob <-> eli, charlie <-> eli (eli has 2 mutuals)
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const charlie = yield* auth.registerProfile("c@e.com", "charlie");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      const eli = yield* auth.registerProfile("e@e.com", "eli");
      yield* connect(alice.id, bob.id);
      yield* connect(alice.id, charlie.id);
      yield* connect(bob.id, dana.id);
      yield* connect(bob.id, eli.id);
      yield* connect(charlie.id, eli.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result).toHaveLength(2);
      expect(result[0]!.handle).toBe("eli");
      expect(result[0]!.mutualCount).toBe(2);
      expect(result[1]!.handle).toBe("dana");
      expect(result[1]!.mutualCount).toBe(1);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("clamps limit to a maximum of 50", () =>
    Effect.gen(function* () {
      // Register alice + 1 friend + 60 friends-of-friend. Verify even when
      // caller asks for 1000, result length is at most 50.
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      yield* connect(alice.id, bob.id);

      for (let i = 0; i < 60; i++) {
        const fof = yield* auth.registerProfile(`u${i}@e.com`, `u${i}`);
        yield* connect(bob.id, fof.id);
      }

      const result = yield* recs.suggestConnections(alice.id, 1000);
      expect(result.length).toBe(50);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("clamps limit to a minimum of 1 when passed 0 or negative", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      yield* connect(alice.id, bob.id);
      yield* connect(bob.id, dana.id);

      const zero = yield* recs.suggestConnections(alice.id, 0);
      const neg = yield* recs.suggestConnections(alice.id, -5);
      expect(zero.length).toBe(1);
      expect(neg.length).toBe(1);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect(
    "does not surface friend-of-friend edges that are between two of the caller's own friends",
    () =>
      Effect.gen(function* () {
        // alice <-> bob, alice <-> charlie, bob <-> charlie
        // The bob<->charlie edge is between two of alice's friends — it should
        // NOT generate a spurious self-suggestion or inflate any count.
        const alice = yield* auth.registerProfile("a@e.com", "alice");
        const bob = yield* auth.registerProfile("b@e.com", "bob");
        const charlie = yield* auth.registerProfile("c@e.com", "charlie");
        yield* connect(alice.id, bob.id);
        yield* connect(alice.id, charlie.id);
        yield* connect(bob.id, charlie.id);

        const result = yield* recs.suggestConnections(alice.id);
        expect(result).toEqual([]);
      }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("labels friend-of-friend suggestions with the mutual_connections reason", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      yield* connect(alice.id, bob.id);
      yield* connect(bob.id, dana.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result[0]!.reason).toBe("mutual_connections");
      expect(result[0]!.sharedOrganisation).toBeNull();
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("excludes profiles with a connection request already in flight", () =>
    Effect.gen(function* () {
      // alice <-> bob, bob <-> dana, and alice has already asked dana.
      // Re-suggesting dana would produce a Connect button that always fails.
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      yield* connect(alice.id, bob.id);
      yield* connect(bob.id, dana.id);
      yield* graph.sendConnectionRequest(alice.id, dana.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result.map((s) => s.handle)).not.toContain("dana");
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("excludes profiles who have sent the caller a request", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      yield* connect(alice.id, bob.id);
      yield* connect(bob.id, dana.id);
      yield* graph.sendConnectionRequest(dana.id, alice.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result.map((s) => s.handle)).not.toContain("dana");
    }).pipe(Effect.provide(createTestLayer())),
  );

  // ---------------------------------------------------------------------------
  // Shared-organisation suggestions (the cold-start signal)
  // ---------------------------------------------------------------------------

  it.effect("suggests organisation co-members to a caller with no connections", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const org = yield* orgs.createOrganisation(alice.id, "acme", "Acme Inc");
      yield* orgs.addMember(org.id, alice.id, bob.id, "member");

      const result = yield* recs.suggestConnections(alice.id);
      expect(result).toHaveLength(1);
      expect(result[0]!.handle).toBe("bob");
      expect(result[0]!.reason).toBe("shared_organisation");
      expect(result[0]!.mutualCount).toBe(0);
      expect(result[0]!.sharedOrganisation).toEqual({ handle: "acme", name: "Acme Inc" });
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("ranks mutual connections above shared organisations", () =>
    Effect.gen(function* () {
      // dana is a friend-of-friend; erin only shares an organisation.
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      const erin = yield* auth.registerProfile("e@e.com", "erin");
      yield* connect(alice.id, bob.id);
      yield* connect(bob.id, dana.id);
      const org = yield* orgs.createOrganisation(alice.id, "acme", "Acme Inc");
      yield* orgs.addMember(org.id, alice.id, erin.id, "member");

      const result = yield* recs.suggestConnections(alice.id);
      expect(result.map((s) => s.handle)).toEqual(["dana", "erin"]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("annotates a friend-of-friend who is also an organisation co-member", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const dana = yield* auth.registerProfile("d@e.com", "dana");
      yield* connect(alice.id, bob.id);
      yield* connect(bob.id, dana.id);
      const org = yield* orgs.createOrganisation(alice.id, "acme", "Acme Inc");
      yield* orgs.addMember(org.id, alice.id, dana.id, "member");

      const result = yield* recs.suggestConnections(alice.id);
      expect(result).toHaveLength(1);
      // Mutual connections are the stronger signal, so they name the reason —
      // but the shared organisation still rides along as card context.
      expect(result[0]!.reason).toBe("mutual_connections");
      expect(result[0]!.sharedOrganisation).toEqual({ handle: "acme", name: "Acme Inc" });
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("never suggests an organisation co-member the caller has blocked", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const bob = yield* auth.registerProfile("b@e.com", "bob");
      const org = yield* orgs.createOrganisation(alice.id, "acme", "Acme Inc");
      yield* orgs.addMember(org.id, alice.id, bob.id, "member");
      yield* graph.blockProfile(alice.id, bob.id);

      const result = yield* recs.suggestConnections(alice.id);
      expect(result).toEqual([]);
    }).pipe(Effect.provide(createTestLayer())),
  );
});

// ---------------------------------------------------------------------------
// searchProfiles
// ---------------------------------------------------------------------------

describe("searchProfiles", () => {
  it.effect("returns [] below the minimum query length", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      yield* auth.registerProfile("b@e.com", "ab");

      expect(yield* recs.searchProfiles(alice.id, "a")).toEqual([]);
      expect(yield* recs.searchProfiles(alice.id, "")).toEqual([]);
      expect(yield* recs.searchProfiles(alice.id, "   ")).toEqual([]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("matches on a handle prefix and excludes the caller", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      yield* auth.registerProfile("b@e.com", "alicia");
      yield* auth.registerProfile("c@e.com", "bob");

      const result = yield* recs.searchProfiles(alice.id, "ali");
      expect(result.map((r) => r.handle)).toEqual(["alicia"]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("strips a leading @ sigil and is case-insensitive", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      yield* auth.registerProfile("b@e.com", "bobby");

      const result = yield* recs.searchProfiles(alice.id, "@BOB");
      expect(result.map((r) => r.handle)).toEqual(["bobby"]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("falls back to display-name and infix matches when the prefix pass is thin", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      yield* auth.registerProfile("b@e.com", "bob", "Roberta Smith");

      const result = yield* recs.searchProfiles(alice.id, "robert");
      expect(result.map((r) => r.handle)).toEqual(["bob"]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("ranks an exact handle match first", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      yield* auth.registerProfile("b@e.com", "bobby");
      yield* auth.registerProfile("c@e.com", "bobbie");
      yield* auth.registerProfile("d@e.com", "bob");

      const result = yield* recs.searchProfiles(alice.id, "bob");
      expect(result[0]!.handle).toBe("bob");
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("reports the caller's connection state per result", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const connected = yield* auth.registerProfile("b@e.com", "zeta_connected");
      const sent = yield* auth.registerProfile("c@e.com", "zeta_sent");
      const received = yield* auth.registerProfile("d@e.com", "zeta_received");
      yield* auth.registerProfile("e@e.com", "zeta_none");

      yield* connect(alice.id, connected.id);
      yield* graph.sendConnectionRequest(alice.id, sent.id);
      yield* graph.sendConnectionRequest(received.id, alice.id);

      const result = yield* recs.searchProfiles(alice.id, "zeta");
      const byHandle = new Map(result.map((r) => [r.handle, r.connectionStatus]));
      expect(byHandle.get("zeta_connected")).toBe("connected");
      expect(byHandle.get("zeta_sent")).toBe("pending_sent");
      expect(byHandle.get("zeta_received")).toBe("pending_received");
      expect(byHandle.get("zeta_none")).toBe("none");
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("excludes profiles blocked in either direction", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      const blockedByAlice = yield* auth.registerProfile("b@e.com", "zeta_one");
      const blockerOfAlice = yield* auth.registerProfile("c@e.com", "zeta_two");
      yield* auth.registerProfile("d@e.com", "zeta_three");

      yield* graph.blockProfile(alice.id, blockedByAlice.id);
      yield* graph.blockProfile(blockerOfAlice.id, alice.id);

      const result = yield* recs.searchProfiles(alice.id, "zeta");
      expect(result.map((r) => r.handle)).toEqual(["zeta_three"]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("treats an underscore in the query literally, not as a LIKE wildcard", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      yield* auth.registerProfile("b@e.com", "jo_smith");
      yield* auth.registerProfile("c@e.com", "joxsmith");

      const result = yield* recs.searchProfiles(alice.id, "jo_s");
      expect(result.map((r) => r.handle)).toEqual(["jo_smith"]);
    }).pipe(Effect.provide(createTestLayer())),
  );

  it.effect("clamps the limit to [1, 20]", () =>
    Effect.gen(function* () {
      const alice = yield* auth.registerProfile("a@e.com", "alice");
      for (let i = 0; i < 25; i++) {
        yield* auth.registerProfile(`z${i}@e.com`, `zeta${i}`);
      }

      expect((yield* recs.searchProfiles(alice.id, "zeta", 1000)).length).toBe(20);
      expect((yield* recs.searchProfiles(alice.id, "zeta", 0)).length).toBe(1);
      expect((yield* recs.searchProfiles(alice.id, "zeta", Number.NaN)).length).toBe(8);
    }).pipe(Effect.provide(createTestLayer())),
  );
});
