import { AuthProvider } from "@osn/client/solid";
import { Route, Router, useLocation } from "@solidjs/router";
import { lazy, Show } from "solid-js";
import { Toaster } from "solid-toast";

import { Sidebar } from "./components/Sidebar";
import { OSN_ISSUER_URL } from "./lib/auth";

import "./App.css";

const ConnectionsPage = lazy(() =>
  import("./pages/ConnectionsPage").then((m) => ({ default: m.ConnectionsPage })),
);
const DiscoverPage = lazy(() =>
  import("./pages/DiscoverPage").then((m) => ({ default: m.DiscoverPage })),
);
const OrganisationsPage = lazy(() =>
  import("./pages/OrganisationsPage").then((m) => ({ default: m.OrganisationsPage })),
);
const OrgDetailPage = lazy(() =>
  import("./pages/OrgDetailPage").then((m) => ({ default: m.OrgDetailPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const AuthorizePage = lazy(() =>
  import("./pages/AuthorizePage").then((m) => ({ default: m.AuthorizePage })),
);

/**
 * The consent screen runs bare: no navigation out of the flow, nothing to
 * click but the decision itself.
 */
const BARE_ROUTES = new Set(["/authorize"]);

function Layout(props: { children?: import("solid-js").JSX.Element }) {
  const location = useLocation();
  const bare = () => BARE_ROUTES.has(location.pathname);
  return (
    <div class="flex h-screen overflow-hidden">
      <Show when={!bare()}>
        <Sidebar />
      </Show>
      <div class="flex flex-1 flex-col overflow-y-auto">{props.children}</div>
      <Toaster position="bottom-right" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider config={{ issuerUrl: OSN_ISSUER_URL }}>
      <Router root={Layout}>
        <Route path="/" component={ConnectionsPage} />
        <Route path="/connections" component={ConnectionsPage} />
        <Route path="/discover" component={DiscoverPage} />
        <Route path="/organisations" component={OrganisationsPage} />
        <Route path="/organisations/:id" component={OrgDetailPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/authorize" component={AuthorizePage} />
      </Router>
    </AuthProvider>
  );
}
