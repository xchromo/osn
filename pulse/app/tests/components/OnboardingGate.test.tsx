import { createMemoryHistory, MemoryRouter, Route, useLocation } from "@solidjs/router";
// @vitest-environment happy-dom
import { cleanup, render as _baseRender, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — useAuth + lib/onboarding (the gate's only direct dependencies)
// ---------------------------------------------------------------------------

let mockSession: () => { accessToken: string } | null = () => ({ accessToken: "tok" });
vi.mock("@osn/client/solid", () => ({
  useAuth: () => ({ session: () => mockSession() }),
}));

const mockFetchStatus = vi.fn();
const mockIsSkipped = vi.fn(() => false);
vi.mock("../../src/lib/onboarding", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/onboarding")>(
    "../../src/lib/onboarding",
  );
  return {
    ...actual,
    fetchOnboardingStatus: (...a: unknown[]) => mockFetchStatus(...a),
    isOnboardingSkippedThisSession: (...a: unknown[]) => mockIsSkipped(...a),
  };
});

import { OnboardingGate } from "../../src/components/OnboardingGate";

// ---------------------------------------------------------------------------
// Probe — captures the current pathname into a module-scoped variable so
// tests can assert post-redirect behaviour without driving a full app.
// ---------------------------------------------------------------------------

let lastPathname = "";
function PathProbe() {
  const location = useLocation();
  // Reading `pathname` in the render body subscribes to changes — Solid
  // re-renders this leaf whenever the router pushes a new path.
  lastPathname = location.pathname;
  return null;
}

function GateScreen() {
  return (
    <>
      <OnboardingGate />
      <PathProbe />
    </>
  );
}

const renderAt = (initialPath: string) => {
  // Seed a memory history at the requested path so the gate's first
  // observation sees the right `location.pathname`. `MemoryRouter`'s
  // default history hardcodes `entries = ["/"]`, so we can't drive the
  // initial path through `window.history` — pass a pre-seeded history
  // via the `history` prop instead.
  const history = createMemoryHistory();
  history.set({ value: initialPath, replace: true });
  return _baseRender(() => (
    <MemoryRouter history={history}>
      <Route path="/welcome" component={GateScreen} />
      <Route path="*" component={GateScreen} />
    </MemoryRouter>
  ));
};

describe("OnboardingGate", () => {
  beforeEach(() => {
    mockSession = () => ({ accessToken: "tok" });
    mockFetchStatus.mockReset();
    mockIsSkipped.mockReset();
    mockIsSkipped.mockReturnValue(false);
    lastPathname = "";
  });

  afterEach(() => {
    cleanup();
  });

  it("does not fetch and does not navigate when there is no session", async () => {
    mockSession = () => null;
    renderAt("/");
    // Give the resource a tick to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockFetchStatus).not.toHaveBeenCalled();
    expect(lastPathname).toBe("/");
  });

  it("does not fetch when the user is already on /welcome (avoids redirect loop)", async () => {
    renderAt("/welcome");
    await new Promise((r) => setTimeout(r, 10));
    expect(mockFetchStatus).not.toHaveBeenCalled();
    expect(lastPathname).toBe("/welcome");
  });

  it("does not fetch when the session-skip flag is set", async () => {
    mockIsSkipped.mockReturnValue(true);
    renderAt("/");
    await new Promise((r) => setTimeout(r, 10));
    expect(mockFetchStatus).not.toHaveBeenCalled();
    expect(lastPathname).toBe("/");
  });

  it("redirects to /welcome when on a non-welcome path and onboarding is incomplete", async () => {
    mockFetchStatus.mockResolvedValue({
      completedAt: null,
      interests: [],
      notificationsOptIn: false,
      eventRemindersOptIn: false,
      notificationsPerm: "prompt",
      locationPerm: "prompt",
    });
    renderAt("/");
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    await waitFor(() => expect(lastPathname).toBe("/welcome"));
  });

  it("does NOT redirect when onboarding is already complete", async () => {
    mockFetchStatus.mockResolvedValue({
      completedAt: new Date().toISOString(),
      interests: ["music"],
      notificationsOptIn: true,
      eventRemindersOptIn: true,
      notificationsPerm: "granted",
      locationPerm: "granted",
    });
    renderAt("/");
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    // Give the redirect effect a chance to fire if it were going to.
    await new Promise((r) => setTimeout(r, 20));
    expect(lastPathname).toBe("/");
  });

  it("does NOT redirect when fetch returns null (auth or transport error)", async () => {
    mockFetchStatus.mockResolvedValue(null);
    renderAt("/");
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(lastPathname).toBe("/");
  });
});
