// A `weddingId`-keyed cache for the organiser's gift registry — sibling of
// `vendors-store.ts`/`budget-store.ts`. Fetch-lift so switching modules doesn't
// refetch, and so the two registry sub-views (the gift list and the gift log)
// share ONE fetch. Effect is deliberately NOT imported (frontend code).
// Timestamps are ms-epoch numbers; money is minor units.
//
// This caches the WHOLE snapshot rather than the item list, because one GET
// answers with the settings, the items, the first page of the gift log and the
// wedding's primary currency together. Splitting them into separate caches here
// would mean three entries fed by one response, and a partial invalidation would
// then be able to leave the item list and the gift log disagreeing about which
// response they came from.
import { type Accessor, createSignal, type Setter } from "solid-js";

/** Registry-level settings. The portal reads these; the Stripe fields are
 *  reported by the server and never written from here. */
export interface RegistrySettings {
  weddingId: string;
  published: boolean;
  headline: string | null;
  message: string | null;
  cashGiftsEnabled: boolean;
  shippingAddress: string | null;
  shippingVisibleFrom: string | null;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  updatedAt: number | null;
}

/** One gift-list row. `priceMinor` is denominated in the WEDDING's primary
 *  currency by definition — an item carries no currency of its own. */
export interface RegistryItem {
  id: string;
  weddingId: string;
  kind: "product" | "cash_fund";
  title: string;
  description: string | null;
  imageKey: string | null;
  imageCrop: string | null;
  externalUrl: string | null;
  priceMinor: number | null;
  quantityWanted: number;
  /** Sum of non-released claim quantities. Derived server-side, never stored. */
  quantityClaimed: number;
  allowPartial: boolean;
  targetMinor: number | null;
  category: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * One row of the gift log — a claim or a contribution, flattened.
 *
 * `amountMinor`/`currency` are AS GIVEN. `primaryAmountMinor`/`primaryCurrency`
 * are non-null ONLY when the gift arrived in some other currency, so the view
 * shows the as-given figure as the headline with the primary line underneath.
 *
 * `note`, `displayName` and `familyName` are GUEST-AUTHORED. Every renderer must
 * put them in a text node (S-L3).
 */
export interface GiftLogEntry {
  kind: "claim" | "contribution";
  id: string;
  itemId: string | null;
  itemTitle: string | null;
  familyId: string;
  familyName: string;
  displayName: string | null;
  /** Claims only. */
  quantity: number | null;
  status: string;
  note: string | null;
  amountMinor: number | null;
  currency: string | null;
  primaryAmountMinor: number | null;
  primaryCurrency: string | null;
  fxRate: string | null;
  thankedAt: number | null;
  createdAt: number;
}

/**
 * What cire kept when it deleted a wedding's gift detail.
 *
 * Present ONLY after the retention sweep: a year after the last event the guest
 * households are deleted, and every claim and contribution goes with them.
 * Aggregates only, by design — a summary carrying a name, a household or a note
 * would be the deletion undone in the field next door. Money is totalled PER
 * CURRENCY and never converted. Mirrors `GiftSummary` in
 * `cire/api/src/services/retention.ts`.
 */
export interface GiftSummary {
  /** The day the detail was deleted, ISO. */
  sweptOn: string;
  /** The span the counted gifts arrived over, ISO days, both ends inclusive. */
  firstGiftOn: string;
  lastGiftOn: string;
  claims: { reserved: number; purchased: number };
  contributions: { count: number; totals: { currency: string; amountMinor: number }[] };
}

/** The whole registry as the organiser API returns it in one GET. */
export interface RegistrySnapshot {
  settings: RegistrySettings;
  items: RegistryItem[];
  gifts: GiftLogEntry[];
  /** Whether another page of gift-log rows sits past `gifts`. */
  giftsHasMore: boolean;
  /** The parting summary, or null while the gifts themselves are still here.
   *  Non-null means `gifts` is empty because we deleted it. */
  giftSummary: GiftSummary | null;
  /** The wedding's primary currency — what every authored figure is in. */
  currency: string;
  /** Succeeded contributions summed in the primary currency. APPROXIMATE by
   *  construction (each foreign row converted at its own snapshotted rate), so
   *  the view must label it as such. */
  contributionsPrimaryMinor: number;
}

interface CacheEntry {
  snapshot: Accessor<RegistrySnapshot | null>;
  setSnapshot: Setter<RegistrySnapshot | null>;
}

const cache = new Map<string, CacheEntry>();

function entryFor(weddingId: string): CacheEntry {
  let entry = cache.get(weddingId);
  if (!entry) {
    const [snapshot, setSnapshot] = createSignal<RegistrySnapshot | null>(null);
    entry = { snapshot, setSnapshot };
    cache.set(weddingId, entry);
  }
  return entry;
}

export function registryAccessor(weddingId: string): Accessor<RegistrySnapshot | null> {
  return entryFor(weddingId).snapshot;
}

export function hasCachedRegistry(weddingId: string): boolean {
  return cache.get(weddingId)?.snapshot() != null;
}

export function setCachedRegistry(weddingId: string, snapshot: RegistrySnapshot): void {
  entryFor(weddingId).setSnapshot(snapshot);
}

export function peekCachedRegistry(weddingId: string): RegistrySnapshot | null {
  return cache.get(weddingId)?.snapshot() ?? null;
}

/**
 * Drop the cached snapshot, keeping the SIGNAL.
 *
 * Deleting the map entry would mint a fresh signal on the next `entryFor`, and
 * every view that captured the old accessor at mount would then read a signal
 * nothing writes to again — a dead view with stale content. The sibling stores
 * (`vendors-store`, `budget-store`, `events-store`, `enquiries-store`) still
 * delete; this is the repo-wide `P-W2` in `[[cire/wiki/todo/perf]]`, fixed here
 * because `RegistryView` is the first consumer to invalidate on several write
 * paths rather than only on unmount.
 */
export function invalidateRegistry(weddingId: string): void {
  entryFor(weddingId).setSnapshot(null);
}

/** How many of an item's wanted quantity are still unspoken for. Never negative
 *  — a race can land one claim past the wanted count, and a negative "still
 *  wanted" reads as a fault rather than as "fully claimed". */
export function stillWanted(item: RegistryItem): number {
  return Math.max(0, item.quantityWanted - item.quantityClaimed);
}

const inflight = new Map<string, Promise<void>>();

/**
 * Weddings whose Stripe capability has already been re-read this page load.
 *
 * It lives here rather than in the settings panel because the panel is behind a
 * `<Show>` and remounts on every sub-tab switch, and module state in the panel
 * would then outlive the cache it guards — including across tests. The state it
 * re-reads for (an account mid-onboarding) can sit unchanged for days; a page
 * reload is the one moment the answer is likely to have moved, and a reload
 * clears this.
 */
const stripeChecked = new Set<string>();

/** Claim the one live Stripe read this page load allows. False if already taken. */
export function claimStripeCheck(weddingId: string): boolean {
  if (stripeChecked.has(weddingId)) return false;
  stripeChecked.add(weddingId);
  return true;
}

export function ensureRegistryLoaded(
  weddingId: string,
  fetcher: () => Promise<RegistrySnapshot>,
): Promise<void> {
  if (hasCachedRegistry(weddingId)) return Promise.resolve();
  let pending = inflight.get(weddingId);
  if (!pending) {
    pending = fetcher()
      .then((snap) => {
        setCachedRegistry(weddingId, snap);
        return undefined;
      })
      .finally(() => inflight.delete(weddingId));
    inflight.set(weddingId, pending);
  }
  return pending;
}

/** Test-only: clear the whole cache so each test starts cold. */
export function __resetRegistryCache(): void {
  cache.clear();
  inflight.clear();
  stripeChecked.clear();
}
