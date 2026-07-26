/**
 * Profile switching (P2 — multi-account): list an account's profiles and
 * mint a profile-scoped access token, per-account rate capped.
 */

import { accounts, users } from "@osn/db/schema";
import { Db } from "@osn/db/service";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { withProfileSwitch } from "../../metrics";
import type { AuthContext } from "./context";
import { AuthError, DatabaseError } from "./errors";
import { deriveSessionBinding } from "./helpers";
import type { ProfilesModule } from "./profiles";
import type { SessionsModule } from "./sessions";
import type { TokensModule } from "./tokens";
import type { PublicProfile } from "./types";
import { toPublicProfile } from "./types";

export function createProfileSwitchModule(
  ctx: AuthContext,
  profiles: ProfilesModule,
  tokens: TokensModule,
  sessions: SessionsModule,
) {
  const { accessTokenTtl, profileSwitchCap } = ctx;
  const { findProfileById } = profiles;
  const { issueAccessToken } = tokens;
  const { resolveSessionByBinding } = sessions;

  /**
   * Lists all profiles belonging to the given account.
   * Returns `PublicProfile[]` — accountId is never exposed in the response.
   */
  const listAccountProfiles = (
    accountId: string,
  ): Effect.Effect<{ profiles: PublicProfile[] }, AuthError | DatabaseError, Db> =>
    Effect.gen(function* () {
      const { db } = yield* Db;
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({ profile: users, account: accounts })
            .from(users)
            .innerJoin(accounts, eq(users.accountId, accounts.id))
            .where(eq(users.accountId, accountId)),
        catch: (cause) => new DatabaseError({ cause }),
      });
      if (rows.length === 0) {
        return yield* Effect.fail(new AuthError({ message: "Account not found" }));
      }
      const email = rows[0]!.account.email;
      return {
        profiles: rows.map((r) => toPublicProfile(r.profile, email)),
      };
    }).pipe(withProfileSwitch("list"));

  /**
   * Switches to a different profile under the same account. Confirms the
   * target profile belongs to the given account, then issues a new access
   * token scoped to that profile.
   */
  const switchProfile = (
    accountId: string,
    targetProfileId: string,
    caller?: { profileId: string; sessionBinding: string | null },
  ): Effect.Effect<
    { accessToken: string; expiresIn: number; profile: PublicProfile },
    AuthError | DatabaseError,
    Db
  > =>
    Effect.gen(function* () {
      // Per-account rate limit (S-M3): bounds damage from a stolen token. O3:
      // routed through the rate-limiter family so the window is shared across
      // pods. `check` returns false once the cap is exceeded.
      const switchAllowed = yield* Effect.promise(() => profileSwitchCap.check(accountId));
      if (!switchAllowed) {
        return yield* Effect.fail(new AuthError({ message: "Too many profile switches" }));
      }
      const profile = yield* findProfileById(targetProfileId);
      if (!profile) {
        return yield* Effect.fail(new AuthError({ message: "Profile not found" }));
      }
      if (profile.accountId !== accountId) {
        return yield* Effect.fail(
          new AuthError({ message: "Profile does not belong to this account" }),
        );
      }
      // The session is account-scoped and unchanged, but its binding is
      // per-profile: resolve the caller's session from the OLD profile's
      // `sid`, then re-derive it for the profile being switched to. Drops
      // to null when the caller's token predates the claim — the new token
      // is then simply unbound, same as before.
      const sessionHash =
        caller?.sessionBinding != null
          ? yield* resolveSessionByBinding(accountId, caller.profileId, caller.sessionBinding)
          : null;
      // Issue only a new access token — the session token is account-scoped and unchanged.
      const accessToken = yield* issueAccessToken(
        profile.id,
        profile.email,
        profile.handle,
        profile.displayName,
        sessionHash ? deriveSessionBinding(sessionHash, profile.id) : null,
      );
      return {
        accessToken,
        expiresIn: accessTokenTtl,
        profile: toPublicProfile(profile, profile.email),
      };
    }).pipe(withProfileSwitch("switch"));

  return {
    listAccountProfiles,
    switchProfile,
  };
}

export type ProfileSwitchModule = ReturnType<typeof createProfileSwitchModule>;
