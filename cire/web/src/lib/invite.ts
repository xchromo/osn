import type { InviteCustomisation } from "../designs/types";

/** cire-api origin. Build/runtime env with a local-dev default. */
export const API_URL = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

/**
 * Marketing-site origin — where the bare domain (`/`) sends visitors, since a
 * multi-tenant guest site has no one wedding to show there. Defaults to the
 * production apex so a misconfigured build still lands somewhere sensible
 * rather than looping or 404ing.
 */
export const MARKETING_URL = import.meta.env.PUBLIC_MARKETING_URL ?? "https://cireweddings.com";

/** Discriminated result of a server-side invite fetch for a slug. */
export type InviteFetch =
  | { kind: "ok"; invite: InviteCustomisation }
  | { kind: "not-found" }
  | { kind: "error" };

/**
 * Fetch a wedding's invite customisation server-side (per request) from the
 * public invite endpoint. The `[slug]` route uses the result to render the hero
 * with the real image + copy in the SSR'd HTML, and to return a real 404 when
 * the slug doesn't map to a wedding.
 *
 *  - 200            → `{ kind: "ok", invite }`
 *  - 404            → `{ kind: "not-found" }` (unknown slug → the route 404s)
 *  - non-OK / throw → `{ kind: "error" }` (API unreachable → render with defaults)
 *
 * `cache: "no-store"` so an organiser edit surfaces immediately (matches the
 * island revalidation + the endpoint's own `cache-control: no-store`).
 */
export async function fetchInvite(slug: string): Promise<InviteFetch> {
  try {
    const res = await fetch(`${API_URL}/api/invite/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (res.status === 404) return { kind: "not-found" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", invite: (await res.json()) as InviteCustomisation };
  } catch {
    return { kind: "error" };
  }
}

// NOTE: `fetchPrimaryWedding` used to live here, resolving the bare domain to
// the most-recently-created wedding. It was removed along with the
// `GET /api/primary-wedding` endpoint it called — the bare domain now redirects
// to the marketing site (see `MARKETING_URL` above and `pages/index.astro`).
