import { useAuth } from "@osn/client/solid";
import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect, createResource } from "solid-js";

import { fetchOnboardingStatus, isOnboardingSkippedThisSession } from "../lib/onboarding";

/**
 * First-run gate. While a session exists, fetch onboarding status. If the
 * account hasn't completed onboarding (and the user hasn't already chosen
 * to skip this session), redirect to `/welcome`. Anonymous browsers are
 * unaffected — Pulse's public discovery surface stays open.
 *
 * The gate is keyed on the access token so a profile switch (which
 * issues a new token) re-runs the check; switching to a profile whose
 * account already onboarded is a cache hit and resolves instantly.
 *
 * Lives in its own module (rather than inline in `App.tsx`) so the
 * redirect logic — the only seam between this feature and every other
 * route — has direct unit-test coverage.
 */
export function OnboardingGate() {
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
