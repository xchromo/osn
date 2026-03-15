import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Effect, Layer } from "effect";
import { OsnAuth, createOsnAuthLive, type OsnAuthConfig } from "../service";
import { StorageLive } from "../storage";
import type { Session } from "../tokens";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (redirectUri: string, scopes?: string[]) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  config: OsnAuthConfig;
  children: ReactNode;
}

export function AuthProvider({ config, children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const layer = createOsnAuthLive(config).pipe(Layer.provide(StorageLive));

  const run = useCallback(
    <A,>(eff: Effect.Effect<A, unknown, OsnAuth>): Promise<A> =>
      Effect.runPromise(
        Effect.provide(eff, layer).pipe(Effect.orDie) as Effect.Effect<A, never, never>,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    run(Effect.flatMap(OsnAuth, (auth) => auth.getSession()))
      .then((s) => {
        setSession(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [run]);

  const login = useCallback(
    (redirectUri: string, scopes?: string[]) => {
      run(
        Effect.flatMap(OsnAuth, (auth) =>
          Effect.flatMap(auth.startLogin({ redirectUri, scopes }), ({ authorizationUrl }) =>
            Effect.sync(() => {
              window.location.href = authorizationUrl;
            }),
          ),
        ),
      );
    },
    [run],
  );

  const logout = useCallback(async () => {
    await run(Effect.flatMap(OsnAuth, (auth) => auth.logout()));
    setSession(null);
  }, [run]);

  return (
    <AuthContext.Provider value={{ session, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
