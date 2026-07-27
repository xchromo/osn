import { clearAuthError, readAuthError, startSignIn, type RpAuthConfig } from "@shared/rp-auth";
import { createSignal, onMount, Show } from "solid-js";

import { CIRE_API_URL } from "../lib/osn";

const authConfig: RpAuthConfig = { apiBase: CIRE_API_URL };

const ERROR_COPY: Record<string, string> = {
  sign_in_declined: "Sign-in was cancelled. Nothing was shared with Cire.",
  sign_in_failed: "Sign-in did not go through. Try again.",
};

/**
 * Login page island. The portal no longer runs the passkey ceremony itself:
 * a WebAuthn credential can only be used on an origin same-site with the RP
 * ID, and identity lives on `musubi.social`. So this hands off to cire/api's
 * OIDC start leg, which sends the organiser to the identity app and takes the
 * code back in exchange for a cire session cookie.
 *
 * There is nothing to choose here, so there is nothing to click: a clean visit
 * leaves for the issuer on mount. The panel only draws itself when the issuer
 * sent someone back with `?auth_error=…` — a button in front of a redirect
 * that always happens is a toll gate, not a choice.
 *
 * Registration goes the same way — the identity app offers "create an
 * account" on its own sign-in screen, so there is no second mode here.
 */
export default function SignInPanel() {
  const [error, setError] = createSignal<string | null>(null);

  // Land on the dashboard, not back on /login — the login page bounces a
  // signed-in organiser straight off again.
  const signIn = () => startSignIn(authConfig, new URL("/", window.location.origin).toString());

  onMount(() => {
    const marker = readAuthError();
    if (!marker) {
      signIn();
      return;
    }
    setError(ERROR_COPY[marker] ?? ERROR_COPY.sign_in_failed!);
    // Drop the marker so a reload does not re-show it.
    clearAuthError();
  });

  return (
    <Show
      when={error()}
      fallback={
        <p class="text-muted-foreground text-sm leading-relaxed">
          Taking you to musubi to sign in…
        </p>
      }
    >
      {(message) => (
        <div class="flex flex-col gap-6">
          <p
            role="alert"
            class="border-border bg-background text-text rounded-sm border px-4 py-3 text-sm"
          >
            {message()}
          </p>

          <button
            type="button"
            onClick={signIn}
            class="bg-gold text-background w-full rounded-sm px-6 py-3 text-sm font-medium tracking-wide transition-opacity hover:opacity-90"
          >
            Try again
          </button>

          <p class="text-muted-foreground text-center text-sm">
            No account yet? You can create one on the next screen.
          </p>
        </div>
      )}
    </Show>
  );
}
