import type { SearchConnectionState, SearchResults } from "@osn/client";
import { createEffect, createResource, createSignal, onCleanup } from "solid-js";

import { recommendationClient } from "./api";

/** Keystroke settle time before a request goes out. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Mirrors `MIN_SEARCH_QUERY_LENGTH` on the server. Kept client-side too so a
 * single typed character never costs a round trip — the server would answer
 * with empty lists anyway.
 */
export const MIN_QUERY_LENGTH = 2;

/** Normalises the way the server does, so the two agree on "too short". */
export function normaliseQuery(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

const EMPTY: SearchResults = { people: [], organisations: [] };

export interface SearchController {
  query: () => string;
  setQuery: (value: string) => void;
  /** The query the current results correspond to, already normalised. */
  submitted: () => string;
  people: () => SearchResults["people"];
  organisations: () => SearchResults["organisations"];
  /** Flat list in render order — what arrow-key navigation indexes into. */
  flat: () => SearchRow[];
  loading: () => boolean;
  tooShort: () => boolean;
  /** Local, optimistic overrides so a row can flip without a refetch. */
  connectionStatus: (handle: string, fallback: SearchConnectionState) => SearchConnectionState;
  setConnectionStatus: (handle: string, status: SearchConnectionState) => void;
}

export type SearchRow =
  | { kind: "person"; person: SearchResults["people"][number] }
  | { kind: "organisation"; organisation: SearchResults["organisations"][number] };

/**
 * The search state machine shared by the desktop rail combobox and the mobile
 * `/search` page: debounce, min-length gate, request abort, and the optimistic
 * connection-status overrides that let a row flip to "Requested" without a
 * refetch that would reorder the list under the user's cursor.
 *
 * `token` is an accessor rather than a value so the controller can be created
 * once and keep working across a silent token refresh.
 */
export function createSearchController(
  token: () => string,
  options: { limit?: number; orgLimit?: number } = {},
): SearchController {
  const [query, setQuery] = createSignal("");
  const [debounced, setDebounced] = createSignal("");
  const [overrides, setOverrides] = createSignal<Record<string, SearchConnectionState>>({});

  createEffect(() => {
    const next = query();
    const timer = setTimeout(() => setDebounced(next), SEARCH_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  // Abort the previous request whenever a newer one starts: without this a slow
  // early keystroke can land after a fast later one. Solid already discards the
  // stale *result*; aborting also stops the wasted request.
  let inFlight: AbortController | null = null;
  onCleanup(() => inFlight?.abort());

  const [results] = createResource(
    () => {
      const q = normaliseQuery(debounced());
      return token() && q.length >= MIN_QUERY_LENGTH ? { q, token: token() } : undefined;
    },
    async ({ q, token: tk }) => {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      return await recommendationClient.search(tk, q, {
        limit: options.limit,
        orgLimit: options.orgLimit,
        signal: controller.signal,
      });
    },
  );

  // `latest` keeps the previous page on screen while the next one loads, so the
  // list doesn't blank out between keystrokes.
  const current = (): SearchResults => results.latest ?? EMPTY;
  const people = () => current().people;
  const organisations = () => current().organisations;

  const flat = (): SearchRow[] => [
    ...people().map((person): SearchRow => ({ kind: "person", person })),
    ...organisations().map((organisation): SearchRow => ({ kind: "organisation", organisation })),
  ];

  return {
    query,
    setQuery,
    submitted: () => normaliseQuery(debounced()),
    people,
    organisations,
    flat,
    loading: () => results.loading,
    tooShort: () => normaliseQuery(query()).length < MIN_QUERY_LENGTH,
    connectionStatus: (handle, fallback) => overrides()[handle] ?? fallback,
    setConnectionStatus: (handle, status) =>
      setOverrides((prev) => ({ ...prev, [handle]: status })),
  };
}
