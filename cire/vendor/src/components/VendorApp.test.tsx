// @vitest-environment happy-dom
import { render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

// Mock @osn/client/solid so we control the session/authFetch without a real
// OSN backend — mirror the organiser app's VendorApp/OrganiserApp test harness.
vi.mock("@osn/client/solid", () => {
  return {
    AuthProvider: (props: any) => props.children,
    useAuth: () => ({
      session: () => ({ profile: { id: "p1" } }),
      authFetch: vi.fn(),
      logout: vi.fn(),
    }),
  };
});
vi.mock("../lib/vendor-store", () => ({
  listMyOrgs: vi
    .fn()
    .mockResolvedValue([
      {
        id: "o1",
        handle: "acme",
        name: "Acme",
        description: null,
        avatarUrl: null,
        ownerId: "p1",
        createdAt: "",
        updatedAt: "",
      },
    ]),
  fetchListing: vi.fn().mockResolvedValue(null),
}));

import VendorApp from "./VendorApp";

describe("VendorApp", () => {
  it("shows the org picker when signed in and no org is selected", async () => {
    render(() => <VendorApp />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
  });
});
