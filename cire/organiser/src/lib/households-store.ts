// A `weddingId`-keyed cache for the organiser's HOUSEHOLD rows — the sibling of
// `guests-store.ts`, and the half of the roster the guest-shaped read can't see.
//
// Why this exists: `GET /guests` returns one row per GUEST, so a household that
// currently holds no guests produces no rows and is invisible to everything that
// groups guests into households — including the guest editor's draft. The draft
// is the whole truth for a save, so a household the editor never saw reads as a
// deletion and the next save removes it, taking a live claim code with it. The
// editor loads `GET /households` alongside the guests and carries the guest-less
// ones through, so they can be filled in or deliberately deleted.
//
// Effect is deliberately NOT imported here — this is frontend code (cire CLAUDE.md:
// "Effect is backend + DB only — never import it in cire/web or cire/organiser").
import { type Accessor, createSignal, type Setter } from "solid-js";

/** One household row as the organiser API returns it (one per family, guest-less
 *  families included). */
export interface OrganiserHouseholdRow {
  familyId: string;
  publicId: string;
  familyName: string;
  /** Guests currently in the household — `0` for a code-only household. */
  guestCount: number;
  codeSharedAt: number | null;
  firstOpenedAt: number | null;
  deactivatedAt: number | null;
}

interface CacheEntry {
  households: Accessor<OrganiserHouseholdRow[] | null>;
  setHouseholds: Setter<OrganiserHouseholdRow[] | null>;
}

const cache = new Map<string, CacheEntry>();

function entryFor(weddingId: string): CacheEntry {
  let entry = cache.get(weddingId);
  if (!entry) {
    const [households, setHouseholds] = createSignal<OrganiserHouseholdRow[] | null>(null);
    entry = { households, setHouseholds };
    cache.set(weddingId, entry);
  }
  return entry;
}

/** Reactive accessor for a wedding's cached households (`null` until loaded). */
export function householdsAccessor(weddingId: string): Accessor<OrganiserHouseholdRow[] | null> {
  return entryFor(weddingId).households;
}

/** Has this wedding's household list already been fetched in this session? */
export function hasCachedHouseholds(weddingId: string): boolean {
  return cache.get(weddingId)?.households() != null;
}

/** Drop a wedding's cached households so the next read refetches. Call after a
 *  mutation that can change the roster — e.g. a change apply. */
export function invalidateHouseholds(weddingId: string): void {
  cache.delete(weddingId);
  inflight.delete(weddingId);
}

/** In-flight loads, keyed by weddingId, so concurrent mounts share ONE fetch. */
const inflight = new Map<string, Promise<void>>();

/**
 * Load a wedding's households into the cache exactly once. A cache hit returns
 * immediately; concurrent callers await the same in-flight fetch. `fetcher` is
 * caller-supplied so each panel keeps its own auth/redirect handling — a fetcher
 * that throws rejects every waiter and caches nothing (the next mount retries).
 */
export function ensureHouseholdsLoaded(
  weddingId: string,
  fetcher: () => Promise<OrganiserHouseholdRow[]>,
): Promise<void> {
  if (hasCachedHouseholds(weddingId)) return Promise.resolve();
  let pending = inflight.get(weddingId);
  if (!pending) {
    pending = fetcher()
      .then((rows) => {
        entryFor(weddingId).setHouseholds(rows);
      })
      .finally(() => inflight.delete(weddingId));
    inflight.set(weddingId, pending);
  }
  return pending;
}

/** Test-only: clear the whole cache so each test starts cold. */
export function __resetHouseholdsCache(): void {
  cache.clear();
  inflight.clear();
}
