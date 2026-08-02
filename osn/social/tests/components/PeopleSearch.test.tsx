// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the API clients before importing the component under test so its
// module-level `recommendationClient` / `graphClient` references pick up the
// mocked implementations.
const mocks = vi.hoisted(() => ({
  searchProfiles: vi.fn(),
  sendConnectionRequest: vi.fn(),
  acceptConnection: vi.fn(),
}));

vi.mock("../../src/lib/api", () => ({
  graphClient: {
    sendConnectionRequest: mocks.sendConnectionRequest,
    acceptConnection: mocks.acceptConnection,
  },
  orgClient: {},
  recommendationClient: { searchProfiles: mocks.searchProfiles },
}));

import { PeopleSearch } from "../../src/components/PeopleSearch";

const result = (handle: string, connectionStatus = "none", displayName: string | null = null) => ({
  handle,
  displayName,
  avatarUrl: null,
  connectionStatus,
});

function renderSearch() {
  return render(() => <PeopleSearch token="tkn" />);
}

/** Types into the combobox and lets the debounce timer fire. */
async function type(value: string) {
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value } });
  await vi.advanceTimersByTimeAsync(300);
  return input;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.searchProfiles.mockResolvedValue({ results: [] });
  mocks.sendConnectionRequest.mockResolvedValue({ ok: true });
  mocks.acceptConnection.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe("<PeopleSearch />", () => {
  it("does not query the API below the minimum query length", async () => {
    renderSearch();
    await type("a");
    expect(mocks.searchProfiles).not.toHaveBeenCalled();
  });

  it("debounces so a burst of keystrokes issues a single request", async () => {
    renderSearch();
    const input = screen.getByRole("combobox");
    for (const value of ["al", "ali", "alic", "alice"]) {
      fireEvent.input(input, { target: { value } });
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.searchProfiles).toHaveBeenCalledTimes(1);
    expect(mocks.searchProfiles).toHaveBeenCalledWith(
      "tkn",
      "alice",
      expect.objectContaining({ limit: 8 }),
    );
  });

  it("strips a leading @ before querying", async () => {
    renderSearch();
    await type("@alice");
    expect(mocks.searchProfiles).toHaveBeenCalledWith("tkn", "alice", expect.anything());
  });

  it("renders matches as listbox options", async () => {
    mocks.searchProfiles.mockResolvedValue({
      results: [result("alice", "none", "Alice Ainsley"), result("alicia")],
    });
    renderSearch();
    await type("ali");

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getByText("Alice Ainsley")).toBeDefined();
    expect(screen.getByText("@alicia")).toBeDefined();
  });

  it("sends a connection request when a result's Connect button is clicked", async () => {
    mocks.searchProfiles.mockResolvedValue({ results: [result("alice")] });
    renderSearch();
    await type("ali");

    await waitFor(() => expect(screen.getByText("Connect")).toBeDefined());
    fireEvent.click(screen.getByText("Connect"));
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.sendConnectionRequest).toHaveBeenCalledWith("tkn", "alice");
    // The row flips to the sent state without waiting for a refetch.
    await waitFor(() => expect(screen.getByText("Requested")).toBeDefined());
  });

  it("offers Accept for someone who already requested the caller", async () => {
    mocks.searchProfiles.mockResolvedValue({ results: [result("alice", "pending_received")] });
    renderSearch();
    await type("ali");

    await waitFor(() => expect(screen.getByText("Accept")).toBeDefined());
    fireEvent.click(screen.getByText("Accept"));
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.acceptConnection).toHaveBeenCalledWith("tkn", "alice");
    expect(mocks.sendConnectionRequest).not.toHaveBeenCalled();
  });

  it("shows a non-actionable label for results already connected or requested", async () => {
    mocks.searchProfiles.mockResolvedValue({
      results: [result("alice", "connected"), result("alicia", "pending_sent")],
    });
    renderSearch();
    await type("ali");

    await waitFor(() => expect(screen.getByText("Connected")).toBeDefined());
    expect(screen.getByText("Requested")).toBeDefined();
    expect(screen.queryByText("Connect")).toBeNull();
  });

  it("moves the active option with the arrow keys and acts on Enter", async () => {
    mocks.searchProfiles.mockResolvedValue({
      results: [result("alice"), result("alicia")],
    });
    renderSearch();
    const input = await type("ali");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe("people-search-option-1");

    fireEvent.keyDown(input, { key: "Enter" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.sendConnectionRequest).toHaveBeenCalledWith("tkn", "alicia");
  });

  it("wraps to the last option on ArrowUp from an inactive field", async () => {
    mocks.searchProfiles.mockResolvedValue({
      results: [result("alice"), result("alicia"), result("alina")],
    });
    renderSearch();
    const input = await type("ali");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe("people-search-option-2");
  });

  it("closes the listbox on Escape", async () => {
    mocks.searchProfiles.mockResolvedValue({ results: [result("alice")] });
    renderSearch();
    const input = await type("ali");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("option")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("reports an empty result set instead of leaving the panel blank", async () => {
    mocks.searchProfiles.mockResolvedValue({ results: [] });
    renderSearch();
    await type("zzz");

    await waitFor(() => expect(screen.getByText(/No one found for "zzz"/)).toBeDefined());
  });

  it("passes an abort signal so a superseded request can be cancelled", async () => {
    renderSearch();
    await type("ali");
    const options = mocks.searchProfiles.mock.calls[0]![2] as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal!.aborted).toBe(false);
  });
});
