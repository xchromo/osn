/**
 * Plain-fetch client for the recommendations API. Mirrors the pattern in
 * `./graph.ts` and `./organisations.ts`.
 */

export interface RecommendationClientConfig {
  /** OSN issuer base URL, e.g. http://localhost:4000 */
  issuerUrl: string;
}

/** Why a profile was suggested. Mirrors `SuggestionReason` in `@osn/api`. */
export type SuggestionReason = "mutual_connections" | "shared_organisation";

export interface Suggestion {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  mutualCount: number;
  reason: SuggestionReason;
  /** An organisation the caller and this profile both belong to, if any. */
  sharedOrganisation: { handle: string; name: string } | null;
}

/** The caller's connection state with a search result. */
export type SearchConnectionState = "none" | "pending_sent" | "pending_received" | "connected";

export interface ProfileSearchResult {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  connectionStatus: SearchConnectionState;
}

export class RecommendationClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecommendationClientError";
  }
}

async function safeJson<T>(res: Response): Promise<(T & { error?: string }) | null> {
  try {
    return (await res.json()) as T & { error?: string };
  } catch {
    return null;
  }
}

function safeErrorMessage(value: unknown, status: number): string {
  if (typeof value !== "string" || value.length === 0) return `Request failed: ${status}`;
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}

export interface RecommendationClient {
  suggestConnections(
    token: string,
    options?: { limit?: number },
  ): Promise<{ suggestions: Suggestion[] }>;
  /**
   * People search for autocomplete. Queries shorter than the server minimum
   * (2 characters after trimming and stripping a leading `@`) come back as an
   * empty list rather than an error.
   *
   * `signal` exists because this is typeahead: callers should abort the
   * in-flight request when the query changes, so a slow early keystroke can't
   * land after — and overwrite — a fast later one.
   */
  searchProfiles(
    token: string,
    query: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<{ results: ProfileSearchResult[] }>;
}

export function createRecommendationClient(
  config: RecommendationClientConfig,
): RecommendationClient {
  const base = `${config.issuerUrl.replace(/\/$/, "")}/recommendations`;

  return {
    suggestConnections: async (token, options) => {
      const limit = options?.limit;
      const qs = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : "";
      const res = await fetch(`${base}/connections${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await safeJson<{ suggestions: Suggestion[] }>(res);
      if (!res.ok) {
        throw new RecommendationClientError(safeErrorMessage(json?.error, res.status));
      }
      if (json === null) {
        throw new RecommendationClientError(`Invalid response: ${res.status}`);
      }
      return json;
    },

    searchProfiles: async (token, query, options) => {
      const params = new URLSearchParams({ q: query });
      if (options?.limit !== undefined) params.set("limit", String(options.limit));
      const res = await fetch(`${base}/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: options?.signal,
      });
      const json = await safeJson<{ results: ProfileSearchResult[] }>(res);
      if (!res.ok) {
        throw new RecommendationClientError(safeErrorMessage(json?.error, res.status));
      }
      if (json === null) {
        throw new RecommendationClientError(`Invalid response: ${res.status}`);
      }
      return json;
    },
  };
}
