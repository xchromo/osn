import {
  clearAuthError,
  readAuthError,
  resumeSession,
  startCreateAccount,
  startSignIn,
  type RpAuthConfig,
} from "@shared/rp-auth";
import { createSignal, onMount, Show } from "solid-js";

import { CIRE_API_URL } from "../lib/osn";
import Button from "./ui/Button";
import Notice from "./ui/Notice";

const authConfig: RpAuthConfig = { apiBase: CIRE_API_URL };

const ERROR_COPY: Record<string, string> = {
  sign_in_declined: "Sign-in was cancelled. Nothing was shared with Cire.",
  sign_in_failed: "Sign-in did not go through. Try again.",
};

/**
 * Login page island. The portal no longer runs the passkey ceremony itself:
 * a WebAuthn credential can only be used on an origin same-site with the RP
 * ID, and identity lives on `musubi.social`. So this hands off to cire/api's
 * OIDC start leg, which sends the vendor to the identity app and takes the
 * code back in exchange for a cire session cookie.
 *
 * Both buttons leave for the same issuer and end in the same place — a signed-
 * in vendor on the dashboard. The second only adds `prompt=create`, which asks
 * the identity app to open on its sign-up screen instead of its sign-in one.
 * That is worth a button of its own: someone here for the first time has no
 * passkey to offer, and a screen demanding one is a dead end rather than an
 * invitation.
 *
 * The page does not leave for the issuer on its own. It used to, back when
 * there was nothing to choose; now there is. It does still ask cire/api, in
 * the background, whether this browser already holds a cire session — someone
 * who is signed in already wants the dashboard, not a second sign-in. That
 * question only reaches as far as cire's own cookie: a session at musubi is
 * invisible from here, because the issuer's cookie is `SameSite=Lax` and no
 * background request from this origin will carry it.
 */
export default function SignInPanel() {
  const [error, setError] = createSignal<string | null>(null);

  // Land on the dashboard, not back on /login — the login page bounces a
  // signed-in vendor straight off again.
  const home = () => new URL("/", window.location.origin).toString();
  const signIn = () => startSignIn(authConfig, home());
  const createAccount = () => startCreateAccount(authConfig, home());

  onMount(() => {
    const marker = readAuthError();
    if (marker) {
      setError(ERROR_COPY[marker] ?? ERROR_COPY.sign_in_failed!);
      // Drop the marker so a reload does not re-show it.
      clearAuthError();
    }
    // Behind the rendered page, so the buttons are usable straight away.
    void resumeSession(authConfig, { home: home() });
  });

  return (
    <div class="flex flex-col gap-6">
      {/* Tinted and marked, where it used to be a plain bordered box in the
          page's own colours — a cancelled sign-in read as a piece of the form.
          `alert` because it appears in answer to something the vendor just did:
          they came back from the issuer without a session. */}
      <Show when={error()}>
        {(message) => (
          <Notice tone="error" alert>
            {message()}
          </Notice>
        )}
      </Show>

      <p class="font-body text-text-muted text-[0.88rem] leading-relaxed">
        Cire uses your musubi account to sign you in. Your passkey stays with musubi — Cire never
        sees it.
      </p>

      <div class="flex flex-col gap-3">
        <Button variant="primary" onClick={signIn} class="w-full">
          Continue with musubi
        </Button>

        <Button variant="outline" onClick={createAccount} class="w-full">
          Create account with musubi
        </Button>
      </div>
    </div>
  );
}
