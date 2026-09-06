/**
 * Does a failed `POST /token` prove the caller's session cookie is dead?
 *
 * The `osn_has_session` marker is a cache of "a session cookie exists in this
 * browser", and a fresh tab with no local account state consults nothing else
 * before deciding whether to attempt a grant at all. So only evidence that the
 * COOKIE is dead may retract it. Two failures say nothing of the kind:
 *
 *   - `DatabaseError` — a storage blip. Evidence about the request.
 *   - the CAS-lost `AuthError` from `refreshTokens` — a concurrent grant of the
 *     same token rotated it out first. PR #289 established this as expected
 *     under concurrent tabs, and the winning grant already set a fresh cookie.
 *
 * Retracting on either turns a transient 400 into a permanent signed-out state
 * for exactly the cold-start population the marker exists to serve (S-M2). The
 * server already knows the difference; this is the predicate that keeps it.
 */

/**
 * A service failure carrying an Effect `Data.TaggedError` discriminator — the
 * only shape this predicate can read an answer from.
 */
interface TaggedServiceError extends Error {
  readonly _tag: string;
}

function isTaggedServiceError(value: unknown): value is TaggedServiceError {
  return value instanceof Error && "_tag" in value && typeof value._tag === "string";
}

/**
 * Narrow a rejected value to a tagged service error. `null` for any other
 * value, which the caller reads as "no evidence".
 *
 * Effect v4 removed `FiberFailure`. `ManagedRuntime.runPromise` now rejects
 * with `Cause.squash(cause)`, which yields the first `Fail` error directly, so
 * there is no wrapper left to unwrap.
 *
 * Note the one behaviour change, because this function feeds a security
 * decision rather than a message. `Cause.squash` returns a *defect* when the
 * cause carries no `Fail`, where v3's `Cause.failureOption` returned `None` and
 * this answered `null`. A defect that is an `Error` tagged `DatabaseError`
 * would now read as "status unknown" and keep the marker standing, where before
 * it retracted. That direction is the conservative one for this particular
 * caller — a kept marker costs a pointless grant, a wrongly-retracted one costs
 * a sign-in — but it is a change, not a no-op.
 */
function taggedFailure(e: unknown): TaggedServiceError | null {
  return isTaggedServiceError(e) ? e : null;
}

/**
 * True when the failure leaves the session cookie's status unknown, so the
 * marker must be left standing.
 *
 * Defaults to `false` — an unrecognised failure retracts. That is the safer
 * default for a cache: a wrongly-retracted marker costs one sign-in and heals
 * on the next successful ceremony, while a wrongly-kept marker re-arms a
 * pointless grant on every page load, which is the cost this branch removes.
 */
export function sessionStatusUnknown(e: unknown): boolean {
  const failure = taggedFailure(e);
  if (!failure) return false;
  if (failure._tag === "DatabaseError") return true;
  if (failure._tag === "AuthError") return failure.message === ROTATION_RACE_MESSAGE;
  return false;
}

/**
 * The CAS-lost failure message, shared with `refreshTokens` so the two cannot
 * drift apart. Matching on a message is not lovely, but `AuthError` carries no
 * other discriminator and widening its shape would touch every auth route;
 * the constant plus this comment is the cheaper guarantee.
 */
export const ROTATION_RACE_MESSAGE = "Session rotated by a concurrent grant";
