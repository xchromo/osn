// @vitest-environment happy-dom
import type { SecurityEventsClient, SecurityEventSummary } from "@osn/client";
import { render, cleanup, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { SecurityEventsBanner } from "../../src/auth/SecurityEventsBanner";

/**
 * Settings banner for out-of-band security events (M-PK1b). Tests cover:
 *   - empty list renders nothing (banner collapses entirely)
 *   - recovery_code_generate event renders headline + timestamp + UA label
 *   - unknown kinds fall through to a generic message (forward-compat)
 *   - "Got it" calls acknowledge and removes the row on success
 *   - a rejected acknowledge surfaces the error text in the banner
 */

interface ClientStub {
  list: ReturnType<typeof vi.fn>;
  acknowledge: ReturnType<typeof vi.fn>;
}

function makeStub(): ClientStub {
  return {
    list: vi.fn(),
    acknowledge: vi.fn(),
  };
}

const asClient = (s: ClientStub): SecurityEventsClient => s as unknown as SecurityEventsClient;

const recoveryEvent: SecurityEventSummary = {
  id: "sev_abcdef012345",
  kind: "recovery_code_generate",
  createdAt: 1_700_000_000,
  uaLabel: "Firefox on macOS",
  ipHash: "deadbeef",
};

let stub: ClientStub;

describe("SecurityEventsBanner", () => {
  beforeEach(() => {
    stub = makeStub();
  });

  afterEach(() => cleanup());

  it("renders nothing when the list is empty", async () => {
    stub.list.mockResolvedValue({ events: [] });
    const { container } = render(() => (
      <SecurityEventsBanner client={asClient(stub)} accessToken="acc" />
    ));
    // Wait for the resource to resolve, then assert nothing rendered.
    await waitFor(() => expect(stub.list).toHaveBeenCalledTimes(1));
    expect(container.textContent?.trim()).toBe("");
  });

  it("renders the recovery-code-generate headline with UA label", async () => {
    stub.list.mockResolvedValue({ events: [recoveryEvent] });
    render(() => <SecurityEventsBanner client={asClient(stub)} accessToken="acc" />);
    await waitFor(() => {
      expect(screen.getByText(/recovery codes were regenerated/i)).toBeTruthy();
      expect(screen.getByText(/Firefox on macOS/)).toBeTruthy();
    });
  });

  it("falls back to a generic headline for unknown kinds (forward-compat)", async () => {
    const futureEvent = {
      ...recoveryEvent,
      id: "sev_future0000",
      kind: "passkey_registered" as unknown as SecurityEventSummary["kind"],
    };
    stub.list.mockResolvedValue({ events: [futureEvent] });
    render(() => <SecurityEventsBanner client={asClient(stub)} accessToken="acc" />);
    await waitFor(() => {
      expect(screen.getByText(/Security event on your account/i)).toBeTruthy();
    });
  });

  it('"Got it" calls acknowledge and removes the row on success', async () => {
    stub.list.mockResolvedValueOnce({ events: [recoveryEvent] });
    stub.list.mockResolvedValueOnce({ events: [] });
    stub.acknowledge.mockResolvedValue({ acknowledged: true });

    render(() => <SecurityEventsBanner client={asClient(stub)} accessToken="acc" />);
    await waitFor(() => screen.getByRole("button", { name: /Got it/ }));
    fireEvent.click(screen.getByRole("button", { name: /Got it/ }));

    await waitFor(() =>
      expect(stub.acknowledge).toHaveBeenCalledWith({
        accessToken: "acc",
        id: "sev_abcdef012345",
      }),
    );
    // Second list() fetch shows the empty state → banner collapses.
    await waitFor(() => expect(stub.list).toHaveBeenCalledTimes(2));
  });

  it("surfaces an error message when acknowledge rejects", async () => {
    stub.list.mockResolvedValue({ events: [recoveryEvent] });
    stub.acknowledge.mockRejectedValue(new Error("server on fire"));

    render(() => <SecurityEventsBanner client={asClient(stub)} accessToken="acc" />);
    await waitFor(() => screen.getByRole("button", { name: /Got it/ }));
    fireEvent.click(screen.getByRole("button", { name: /Got it/ }));

    await waitFor(() => {
      expect(screen.getByText(/server on fire/)).toBeTruthy();
    });
  });
});
