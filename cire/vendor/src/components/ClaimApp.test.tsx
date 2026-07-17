// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@osn/client/solid", () => ({
  AuthProvider: (props: any) => props.children,
  useAuth: () => ({ session: () => ({ profile: { id: "p1" } }), authFetch: vi.fn() }),
}));
vi.mock("../lib/vendor-store", () => ({
  fetchClaimPreview: vi.fn().mockResolvedValue({ directoryVendorId: "d1", name: "Preview Co" }),
  consumeClaim: vi.fn(),
  listMyOrgs: vi.fn().mockResolvedValue([]),
}));

// Seed the token into the URL before the component reads it.
history.replaceState(null, "", "/claim?token=abc123");

import ClaimApp from "./ClaimApp";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClaimApp", () => {
  it("previews the invited listing name and strips the token from the URL", async () => {
    render(() => <ClaimApp />);
    await waitFor(() => expect(screen.getByText(/Preview Co/)).toBeInTheDocument());
    expect(window.location.search).not.toContain("abc123");
  });
});
