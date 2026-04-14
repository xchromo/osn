import { Schema } from "effect";

const TokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  token_type: Schema.String,
  scope: Schema.optional(Schema.String),
});

const decodeTokenResponse = Schema.decodeUnknownSync(TokenResponseSchema);

export interface Session {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
  scopes: string[];
}

export function parseTokenResponse(raw: unknown): Session {
  const t = decodeTokenResponse(raw);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    idToken: t.id_token ?? null,
    expiresAt: Date.now() + t.expires_in * 1000,
    scopes: t.scope ? t.scope.split(" ") : [],
  };
}

export interface PublicProfile {
  id: string;
  handle: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ProfileToken {
  accessToken: string;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
}

export interface AccountSession {
  refreshToken: string;
  activeProfileId: string;
  profileTokens: Record<string, ProfileToken>;
  scopes: string[];
  idToken: string | null;
}

/** Extract the `sub` claim from a JWT payload without cryptographic verification. */
export function extractJwtSub(jwt: string): string | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload)) as { sub?: string };
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}
