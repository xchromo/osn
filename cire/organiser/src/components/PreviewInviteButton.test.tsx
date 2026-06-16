// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * PreviewInviteButton owns the host-preview deep-link wiring: POST the
 * owner-gated /preview-code endpoint, then open the guest invite in a new tab
 * with ?code=<publicId>. The OSN auth + Effect runtime are stubbed; this test
 * asserts only the wiring it introduces.
 */

const authFetchMock = vi.fn();
vi.mock("@osn/client/solid", () => ({
  useAuth: () => ({ authFetch: authFetchMock }),
}));

vi.mock("solid-toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import PreviewInviteButton from "./PreviewInviteButton";

describe("PreviewInviteButton", () => {
  afterEach(() => {
    cleanup();
    authFetchMock.mockReset();
  });

  it("provisions the host code and opens the guest invite with ?code=", async () => {
    authFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ publicId: "HOST-ABCDEF0123456789ABCDEF01" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);

    render(() => <PreviewInviteButton weddingId="wed_bootstrap" />);
    fireEvent.click(screen.getByRole("button", { name: /Preview invite/i }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));

    // POSTs the wedding-scoped preview-code endpoint.
    const [url, init] = authFetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/organiser/weddings/wed_bootstrap/preview-code");
    expect((init as RequestInit).method).toBe("POST");

    // Opens the guest site with the returned host code pre-filled.
    const opened = openSpy.mock.calls[0]![0] as string;
    expect(opened).toContain("?code=HOST-ABCDEF0123456789ABCDEF01");

    vi.unstubAllGlobals();
  });
});
