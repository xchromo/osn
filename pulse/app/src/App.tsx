import { AuthProvider, useAuth } from "@osn/client/solid";
import { Router, Route, useLocation, useNavigate } from "@solidjs/router";
import { createEffect, createResource, lazy, Show } from "solid-js";
import { Toaster } from "solid-toast";

import { Header } from "./components/Header";
import { OSN_ISSUER_URL } from "./lib/auth";
import { fetchOnboardingStatus, isOnboardingSkippedThisSession } from "./lib/onboarding";

import "./App.css";

// Route-level code-splitting: each page is lazy-loaded so its transitive
// dependencies don't bloat the entry bundle.
const ExplorePage = lazy(() =>
  import("./explore/ExplorePage").then((m) => ({ default: m.ExplorePage })),
);
const EventDetailPage = lazy(() =>
  import("./pages/EventDetailPage").then((m) => ({ default: m.EventDetailPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const SeriesDetailPage = lazy(() =>
  import("./pages/SeriesDetailPage").then((m) => ({ default: m.SeriesDetailPage })),
);
const CloseFriendsPage = lazy(() =>
  import("./pages/CloseFriendsPage").then((m) => ({ default: m.CloseFriendsPage })),
);
const WelcomePage = lazy(() =>
  import("./pages/WelcomePage").then((m) => ({ default: m.WelcomePage })),
);

/**
 * First-run gate. While a session exists, fetch onboarding status. If the
 * account hasn't completed onboarding (and the user hasn't already chosen
 * to skip this session), redirect to `/welcome`. Anonymous browsers are
 * unaffected — Pulse's public discovery surface stays open.
 *
 * The gate is keyed on the access token so a profile switch (which
 * issues a new token) re-runs the check; switching to a profile whose
 * account already onboarded is a cache hit and resolves instantly.
 */
function OnboardingGate() {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const fetchKey = () => {
    const token = session()?.accessToken ?? null;
    if (!token) return null;
    if (location.pathname === "/welcome") return null;
    if (isOnboardingSkippedThisSession()) return null;
    return token;
  };

  const [status] = createResource(fetchKey, fetchOnboardingStatus);

  createEffect(() => {
    const s = status();
    // Resource still loading or no token — nothing to do.
    if (!s) return;
    if (s.completedAt === null && location.pathname !== "/welcome") {
      navigate("/welcome", { replace: true });
    }
  });

  return null;
}

/**
 * Root layout. The Explore home page provides its own ExploreNav, so we
 * only render the legacy Header on non-home routes.
 */
function Layout(props: { children?: unknown }) {
  const location = useLocation();
  const isHome = () => location.pathname === "/";
  const isWelcome = () => location.pathname === "/welcome";

  return (
    <>
      <OnboardingGate />
      <Show when={!isHome() && !isWelcome()}>
        <Header />
      </Show>
      {props.children}
      <Toaster position="bottom-right" />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider config={{ issuerUrl: OSN_ISSUER_URL }}>
      <Router root={Layout}>
        <Route path="/" component={ExplorePage} />
        <Route path="/events/:id" component={EventDetailPage} />
        <Route path="/series/:id" component={SeriesDetailPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/close-friends" component={CloseFriendsPage} />
        <Route path="/welcome" component={WelcomePage} />
      </Router>
    </AuthProvider>
  );
}
