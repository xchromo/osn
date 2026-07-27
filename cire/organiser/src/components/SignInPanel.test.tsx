// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The login surface is now one hand-off: the portal cannot run a WebAuthn
 * ceremony for `musubi.social`, so it sends the organiser to cire/api's OIDC
 * start leg — on mount, with no button in between. What is worth asserting
 * here is that the redirect fires by itself with the dashboard as the return
 * target, that a failure coming back through `?auth_error` stops the loop
 * instead of bouncing straight out again, and that the marker is shown once
 * and then wiped from the address bar.
 */

const startSignIn = vi.fn();
const clearAuthError = vi.fn();
let authError: string | null = null;

vi.mock("@shared/rp-auth", () => ({
  startSignIn: (...args: unknown[]) => startSignIn(...args),
  clearAuthError: () => clearAuthError(),
  readAuthError: () => authError,
}));

import SignInPanel from "./SignInPanel";

describe("SignInPanel", () => {
  beforeEach(() => {
    authError = null;
    startSignIn.mockClear();
    clearAuthError.mockClear();
  });
  afterEach(() => cleanup());

  it("leaves for the issuer on mount, returning to the dashboard", () => {
    render(() => <SignInPanel />);

    expect(startSignIn).toHaveBeenCalledTimes(1);
    const [, returnTo] = startSignIn.mock.calls[0]!;
    expect(new URL(returnTo as string).pathname).toBe("/");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(clearAuthError).not.toHaveBeenCalled();
  });

  it("explains a cancelled sign-in and strips the marker", () => {
    authError = "sign_in_declined";
    render(() => <SignInPanel />);

    expect(screen.getByRole("alert").textContent).toMatch(/cancelled/i);
    expect(clearAuthError).toHaveBeenCalledTimes(1);
    // No auto-redirect: bouncing back to the issuer that just failed would
    // spin the organiser round a loop they cannot read.
    expect(startSignIn).not.toHaveBeenCalled();
  });

  it("falls back to the generic message for an unknown marker", () => {
    authError = "something_new";
    render(() => <SignInPanel />);

    expect(screen.getByRole("alert").textContent).toMatch(/did not go through/i);
    expect(startSignIn).not.toHaveBeenCalled();
  });

  it("retries on demand after a failure", () => {
    authError = "sign_in_failed";
    render(() => <SignInPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

    expect(startSignIn).toHaveBeenCalledTimes(1);
    const [, returnTo] = startSignIn.mock.calls[0]!;
    expect(new URL(returnTo as string).pathname).toBe("/");
  });
});
