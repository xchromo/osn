// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The login surface is one hand-off with two doors: the portal cannot run a
 * WebAuthn ceremony for `musubi.social`, so both buttons send the vendor to
 * cire/api's OIDC start leg and differ only in which screen the issuer opens
 * on. What is worth asserting here is that neither door leaves on its own,
 * that each carries the dashboard as the return target, and that a failure
 * coming back through `?auth_error` is shown once and then wiped from the
 * address bar.
 */

const startSignIn = vi.fn();
const startCreateAccount = vi.fn();
const clearAuthError = vi.fn();
let authError: string | null = null;

vi.mock("@shared/rp-auth", () => ({
  startSignIn: (...args: unknown[]) => startSignIn(...args),
  startCreateAccount: (...args: unknown[]) => startCreateAccount(...args),
  clearAuthError: () => clearAuthError(),
  readAuthError: () => authError,
}));

import SignInPanel from "./SignInPanel";

describe("SignInPanel", () => {
  beforeEach(() => {
    authError = null;
    startSignIn.mockClear();
    startCreateAccount.mockClear();
    clearAuthError.mockClear();
  });
  afterEach(() => cleanup());

  it("waits for a choice rather than leaving on mount", () => {
    render(() => <SignInPanel />);

    expect(startSignIn).not.toHaveBeenCalled();
    expect(startCreateAccount).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(clearAuthError).not.toHaveBeenCalled();
  });

  it("signs in, returning to the dashboard", () => {
    render(() => <SignInPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Continue with musubi/i }));

    expect(startSignIn).toHaveBeenCalledTimes(1);
    const [, returnTo] = startSignIn.mock.calls[0]!;
    expect(new URL(returnTo as string).pathname).toBe("/");
  });

  it("offers account creation as its own door", () => {
    render(() => <SignInPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Create account with musubi/i }));

    expect(startCreateAccount).toHaveBeenCalledTimes(1);
    expect(startSignIn).not.toHaveBeenCalled();
    const [, returnTo] = startCreateAccount.mock.calls[0]!;
    expect(new URL(returnTo as string).pathname).toBe("/");
  });

  it("explains a cancelled sign-in and strips the marker", () => {
    authError = "sign_in_declined";
    render(() => <SignInPanel />);

    expect(screen.getByRole("alert").textContent).toMatch(/cancelled/i);
    expect(clearAuthError).toHaveBeenCalledTimes(1);
    expect(startSignIn).not.toHaveBeenCalled();
  });

  it("falls back to the generic message for an unknown marker", () => {
    authError = "something_new";
    render(() => <SignInPanel />);

    expect(screen.getByRole("alert").textContent).toMatch(/did not go through/i);
  });

  it("retries on demand after a failure", () => {
    authError = "sign_in_failed";
    render(() => <SignInPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Continue with musubi/i }));

    expect(startSignIn).toHaveBeenCalledTimes(1);
    const [, returnTo] = startSignIn.mock.calls[0]!;
    expect(new URL(returnTo as string).pathname).toBe("/");
  });
});
