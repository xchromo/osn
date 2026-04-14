import { Effect, Layer } from "effect";
import {
  createContext,
  createResource,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
  type Resource,
} from "solid-js";

import { OsnAuth, createOsnAuthLive, type OsnAuthConfig } from "../service";
import { StorageLive } from "../storage";
import type { PublicProfile, Session } from "../tokens";

interface AuthContextValue {
  session: Resource<Session | null>;
  profiles: Resource<PublicProfile[] | null>;
  activeProfileId: Accessor<string | null>;
  login: (redirectUri: string, scopes?: string[]) => void;
  logout: () => Promise<void>;
  handleCallback: (params: { code: string; state: string; redirectUri: string }) => Promise<void>;
  /**
   * Persists a Session obtained from the registration flow (or any other
   * out-of-band source) and refetches the session resource so the UI updates.
   */
  adoptSession: (session: Session) => Promise<void>;
  switchProfile: (profileId: string) => Promise<{ session: Session; profile: PublicProfile }>;
  createProfile: (handle: string, displayName?: string) => Promise<PublicProfile>;
  deleteProfile: (profileId: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>();

interface AuthProviderProps extends ParentProps {
  config: OsnAuthConfig;
}

export function AuthProvider(props: AuthProviderProps) {
  const layer = createOsnAuthLive(props.config).pipe(Layer.provide(StorageLive));

  const run = <A,>(eff: Effect.Effect<A, unknown, OsnAuth>): Promise<A> =>
    Effect.runPromise(
      Effect.provide(eff, layer).pipe(Effect.orDie) as Effect.Effect<A, never, never>,
    );

  const [session, { refetch: refetchSession }] = createResource<Session | null>(() =>
    run(Effect.flatMap(OsnAuth, (auth) => auth.getSession())),
  );

  const [profiles, { mutate: mutateProfiles, refetch: refetchProfiles }] = createResource<
    PublicProfile[] | null
  >(() => run(Effect.flatMap(OsnAuth, (auth) => auth.listProfiles())).catch(() => null));

  const [activeProfileId, setActiveProfileId] = createSignal<string | null>(null);

  // Initialise active profile ID on mount
  run(Effect.flatMap(OsnAuth, (auth) => auth.getActiveProfile()))
    .then(setActiveProfileId)
    .catch(() => {});

  const login = (redirectUri: string, scopes?: string[]) => {
    run(
      Effect.flatMap(OsnAuth, (auth) =>
        Effect.flatMap(auth.startLogin({ redirectUri, scopes }), ({ authorizationUrl }) =>
          Effect.sync(() => {
            window.location.href = authorizationUrl;
          }),
        ),
      ),
    );
  };

  const logout = async () => {
    await run(Effect.flatMap(OsnAuth, (auth) => auth.logout()));
    await refetchSession();
    mutateProfiles(null);
    setActiveProfileId(null);
  };

  const handleCallback = async (params: { code: string; state: string; redirectUri: string }) => {
    await run(Effect.flatMap(OsnAuth, (auth) => auth.handleCallback(params)));
    await refetchSession();
    run(Effect.flatMap(OsnAuth, (auth) => auth.getActiveProfile()))
      .then(setActiveProfileId)
      .catch(() => {});
    refetchProfiles();
  };

  const adoptSession = async (next: Session) => {
    await run(Effect.flatMap(OsnAuth, (auth) => auth.setSession(next)));
    await refetchSession();
    run(Effect.flatMap(OsnAuth, (auth) => auth.getActiveProfile()))
      .then(setActiveProfileId)
      .catch(() => {});
    refetchProfiles();
  };

  const switchProfile = async (profileId: string) => {
    const result = await run(Effect.flatMap(OsnAuth, (auth) => auth.switchProfile(profileId)));
    await refetchSession();
    setActiveProfileId(profileId);
    return result;
  };

  const createProfile = async (handle: string, displayName?: string) => {
    const profile = await run(
      Effect.flatMap(OsnAuth, (auth) => auth.createProfile(handle, displayName)),
    );
    refetchProfiles();
    return profile;
  };

  const deleteProfile = async (profileId: string) => {
    await run(Effect.flatMap(OsnAuth, (auth) => auth.deleteProfile(profileId)));
    await refetchSession();
    run(Effect.flatMap(OsnAuth, (auth) => auth.getActiveProfile()))
      .then(setActiveProfileId)
      .catch(() => {});
    refetchProfiles();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profiles,
        activeProfileId,
        login,
        logout,
        handleCallback,
        adoptSession,
        switchProfile,
        createProfile,
        deleteProfile,
      }}
    >
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
