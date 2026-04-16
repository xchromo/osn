import { generateArcKeyPair, getOrCreateArcToken, importKeyFromJwk } from "@osn/crypto";
import { Data, Effect } from "effect";

import { MAX_EVENT_GUESTS } from "../lib/limits";

/**
 * Single error type used by all graph-bridge functions. Wraps any failure
 * from the underlying OSN graph HTTP endpoints so callers have one tag to
 * catch instead of a union of errors they don't own.
 */
export class GraphBridgeError extends Data.TaggedError("GraphBridgeError")<{
  readonly cause: unknown;
}> {}

export interface ProfileDisplay {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// ---------------------------------------------------------------------------
// Internal — key management and HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Isolated bridge to the OSN social graph over ARC-authenticated HTTP.
 *
 * This is the only file in `pulse/api` that makes S2S calls to `@osn/api`.
 * Other services call through here so changes to the transport layer stay
 * local to this file — no touching of `rsvps.ts` or routes.
 *
 * Auth: `PULSE_API_ARC_PRIVATE_KEY` (JWK). When unset, an ephemeral key is
 * generated on startup — fine for unit tests and local dev (the OSN API
 * accepts the registered dev key from the seed; ephemerals won't verify
 * against a running OSN API but tests mock fetch anyway).
 */

const OSN_API_URL = process.env.OSN_API_URL ?? "http://localhost:4000";

/** Private key singleton — loaded once from env or generated ephemerally. */
let _privateKey: CryptoKey | null = null;

async function getPrivateKey(): Promise<CryptoKey> {
  if (_privateKey) return _privateKey;
  const jwkEnv = process.env.PULSE_API_ARC_PRIVATE_KEY;
  if (jwkEnv) {
    _privateKey = await importKeyFromJwk(JSON.parse(jwkEnv) as Record<string, unknown>);
  } else {
    const pair = await generateArcKeyPair();
    _privateKey = pair.privateKey;
  }
  return _privateKey;
}

async function arcAuthHeader(): Promise<string> {
  const key = await getPrivateKey();
  const token = await getOrCreateArcToken(key, {
    iss: "pulse-api",
    aud: "osn-core",
    scope: "graph:read",
  });
  return `ARC ${token}`;
}

async function osGet<T>(path: string): Promise<T> {
  const res = await fetch(`${OSN_API_URL}${path}`, {
    headers: { authorization: await arcAuthHeader() },
  });
  if (!res.ok) throw new Error(`OSN API GET ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

async function osPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${OSN_API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await arcAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OSN API POST ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The set of profile IDs `profileId` is connected to (accepted connections only).
 * Returns a `Set` for O(1) membership checks in the RSVP visibility filter.
 *
 * Bounded by `MAX_EVENT_GUESTS` — the platform's hard cap on event guest
 * count. See `lib/limits.ts` for rationale.
 */
export const getConnectionIds = (profileId: string): Effect.Effect<Set<string>, GraphBridgeError> =>
  Effect.tryPromise({
    try: async () => {
      const data = await osGet<{ connectionIds: string[] }>(
        `/graph/internal/connections?profileId=${encodeURIComponent(profileId)}&limit=${MAX_EVENT_GUESTS}`,
      );
      return new Set(data.connectionIds);
    },
    catch: (cause) => new GraphBridgeError({ cause }),
  });

/**
 * The set of profile IDs `profileId` has marked as close friends. Bounded by
 * `MAX_EVENT_GUESTS` for the same reason as `getConnectionIds`.
 */
export const getCloseFriendIds = (
  profileId: string,
): Effect.Effect<Set<string>, GraphBridgeError> =>
  Effect.tryPromise({
    try: async () => {
      const data = await osGet<{ closeFriendIds: string[] }>(
        `/graph/internal/close-friends?profileId=${encodeURIComponent(profileId)}&limit=${MAX_EVENT_GUESTS}`,
      );
      return new Set(data.closeFriendIds);
    },
    catch: (cause) => new GraphBridgeError({ cause }),
  });

/**
 * Returns the subset of `attendeeIds` that have marked `viewerId` as a
 * close friend — i.e. attendees who explicitly opted to let this viewer
 * into their close-friends circle.
 *
 * Used by `listRsvps` to stamp an `isCloseFriend` display flag on each
 * returned row. Display affordance only — close-friendship never gates access.
 */
export const getCloseFriendsOf = (
  viewerId: string,
  attendeeIds: string[],
): Effect.Effect<Set<string>, GraphBridgeError> =>
  attendeeIds.length === 0
    ? Effect.succeed(new Set())
    : Effect.tryPromise({
        try: async () => {
          const data = await osPost<{ closeFriendIds: string[] }>(
            "/graph/internal/close-friends-of",
            { viewerId, profileIds: attendeeIds },
          );
          return new Set(data.closeFriendIds);
        },
        catch: (cause) => new GraphBridgeError({ cause }),
      });

/**
 * Fetches display metadata for a batch of OSN profile IDs. Used by the RSVP
 * service to join names/avatars onto RSVP rows before returning to the client.
 * Names NEVER come from the JWT — always fresh from OSN.
 *
 * Returns a Map keyed by profile ID for efficient lookup during join.
 */
export const getProfileDisplays = (
  profileIds: string[],
): Effect.Effect<Map<string, ProfileDisplay>, GraphBridgeError> =>
  profileIds.length === 0
    ? Effect.succeed(new Map())
    : Effect.tryPromise({
        try: async () => {
          const data = await osPost<{ profiles: ProfileDisplay[] }>(
            "/graph/internal/profile-displays",
            { profileIds },
          );
          return new Map(data.profiles.map((p) => [p.id, p]));
        },
        catch: (cause) => new GraphBridgeError({ cause }),
      });
