/**
 * Safe route-level error message extraction (S-M17).
 *
 * Route handlers execute service effects via `ManagedRuntime.runPromise`
 * (see `makeAppRunner`). Under Effect v4 that rejects with the squashed cause
 * — the typed failure itself — so a `_tag` check on the caught value matches
 * directly. This applies the tag allowlist to it; anything not allow-listed
 * (`DatabaseError`, defects) collapses to the generic message so DB internals
 * never leave the server.
 */

const GENERIC_MESSAGE = "Request failed";

/**
 * A service failure carrying an Effect `Data.TaggedError` discriminator — the
 * only shape this module can say anything about.
 */
interface TaggedServiceError extends Error {
  readonly _tag: string;
}

function isTaggedServiceError(value: unknown): value is TaggedServiceError {
  return (
    value instanceof Error &&
    "_tag" in value &&
    typeof value._tag === "string" &&
    typeof value.message === "string"
  );
}

/**
 * Narrow a rejected value to a tagged service error. `null` for a plain `Error`
 * or any other value, neither of which carries a message fit to return.
 *
 * Effect v4 removed `FiberFailure`. `ManagedRuntime.runPromise` now rejects
 * with `Cause.squash(cause)`, which yields the first `Fail` error directly —
 * so there is no longer a wrapper to unwrap.
 *
 * One behaviour change comes with that, and the allowlist in
 * {@link makeSafeError} is what contains it. `Cause.squash` returns a *defect*
 * when the cause carries no `Fail`, whereas v3's `Cause.failureOption` returned
 * `None` and this helper answered `null`. A defect therefore reaches the tag
 * check now. It still cannot leak unless it is an `Error` carrying a `_tag`
 * string that is also allow-listed — and every allow-listed tag belongs to a
 * `Data.TaggedError` raised through `Effect.fail`, which is a `Fail`, not a
 * defect. Keep the allowlist tight and this stays closed.
 */
function taggedFailure(e: unknown): TaggedServiceError | null {
  return isTaggedServiceError(e) ? e : null;
}

/**
 * Build a `safeError` that surfaces only the message of allow-listed tagged
 * service errors. Works both for effects run through a `ManagedRuntime` and
 * for errors thrown directly — v4 rejects with the failure either way.
 */
export function makeSafeError(allowedTags: readonly string[]): (e: unknown) => string {
  const tags = new Set(allowedTags);
  return (e: unknown): string => {
    const failure = taggedFailure(e);
    return failure && tags.has(failure._tag) ? failure.message : GENERIC_MESSAGE;
  };
}
