import { onMount, type Accessor } from "solid-js";

import type { ClaimResult } from "./types";
import { isValidClaimResponse } from "./utils";

export interface SessionRestoreOptions {
  apiUrl: string;
  /** Current claim result — non-null means the invite is already open. */
  result: Accessor<ClaimResult | null>;
  /** Called with the restored payload. Not called if the restore finds nothing. */
  onRestored: (result: ClaimResult) => void;
}

/**
 * Headless "am I already claimed?" primitive — the `GET /api/claim/session`
 * read, factored out like `createClaimCode` so every design pack reuses the
 * identical behaviour.
 *
 * A `cire_session` lasts 30 days, but before this the guest site had no way to
 * ask about one: `POST /api/claim` was the only door in, so a household that
 * had already opened its invite had to retype its code on every visit, and the
 * events list arrived only after they did. This turns the second visit into a
 * single GET that resolves while the hero is still painting.
 *
 * It cannot widen the S-H1 gate: the server keys the read on the family id it
 * derived from the cookie, so this asks "what is MY invite", never "whose
 * invite is this". A guest with no session gets a 401 and the code form, which
 * is exactly today's behaviour.
 *
 * NOTE this can only ever be a client-side fetch, not an SSR one: `cire_session`
 * is host-scoped to `api.cireweddings.com` (deliberately — see the audit note in
 * `cire/api/src/lib/cookie.ts`), so the guest-site Worker never receives it and
 * cannot forward it while rendering.
 */
export function createSessionRestore(options: SessionRestoreOptions): void {
  onMount(() => {
    // The organiser's `?code=` preview deep-link auto-claims in `createClaimCode`
    // on this same mount. Restoring first would paint a stale guest session for
    // a beat before the host claim replaced it, so the explicit code wins and
    // this stays out of the way entirely.
    if (typeof window !== "undefined" && new URL(window.location.href).searchParams.has("code")) {
      return;
    }
    if (options.result()) return;

    void (async () => {
      try {
        const res = await fetch(`${options.apiUrl}/api/claim/session`, {
          // The whole point: send the household cookie cross-origin. Same-site
          // (both under `cireweddings.com`), so `SameSite=Lax` permits it.
          credentials: "include",
          // Never a cached invite — RSVPs and organiser edits both move it.
          cache: "no-store",
        });
        // 401 (no session / withdrawn invite) is the ordinary path for a first
        // visit, not an error: fall through and let the code form stand.
        if (!res.ok) return;

        const data: unknown = await res.json();
        if (!isValidClaimResponse(data)) return;
        // The guest may have typed their code while this was in flight — their
        // claim is fresher and already animated in, so never clobber it.
        if (options.result()) return;

        options.onRestored(data);
      } catch {
        // Offline, or the API is unreachable. The code form stays exactly as it
        // is today; a failed restore must never block entry by hand.
      }
    })();
  });
}
