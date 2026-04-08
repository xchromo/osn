import { Router, Route } from "@solidjs/router";
import { AuthProvider } from "@osn/client/solid";
import { Toaster } from "solid-toast";
import { MagicLinkHandler } from "@osn/ui/auth/MagicLinkHandler";
import { OSN_ISSUER_URL, OSN_CLIENT_ID } from "./lib/auth";
import { loginClient } from "./lib/authClients";
import { CallbackHandler } from "./components/CallbackHandler";
import { EventList } from "./components/EventList";
import { EventDetailPage } from "./pages/EventDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import "./App.css";

/**
 * Root layout. Wraps every route in the AuthProvider and deep-link
 * handlers so auth context and magic-link/OAuth callbacks keep working
 * regardless of the initial URL.
 */
function Layout(props: { children?: unknown }) {
  return (
    <>
      <CallbackHandler />
      <MagicLinkHandler client={loginClient} />
      {props.children}
      <Toaster position="bottom-right" />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider config={{ issuerUrl: OSN_ISSUER_URL, clientId: OSN_CLIENT_ID }}>
      <Router root={Layout}>
        <Route path="/" component={EventList} />
        <Route path="/events/:id" component={EventDetailPage} />
        <Route path="/settings" component={SettingsPage} />
      </Router>
    </AuthProvider>
  );
}
