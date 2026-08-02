// @vitest-environment happy-dom
import { AuthContext } from "@osn/client/solid";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suggestConnections: vi.fn(),
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
  recommendationClient: {
    suggestConnections: mocks.suggestConnections,
    searchProfiles: mocks.searchProfiles,
  },
}));

import { DiscoverPage } from "../../src/pages/DiscoverPage";

function authedProvider() {
  const asResource = <T,>(value: T) =>
    Object.assign(() => value, {
      state: "ready",
      loading: false,
      error: undefined,
      latest: null,
      refetch: () => {},
      mutate: () => {},
    });

  return {
    session: asResource({
      accessToken: "tkn",
      idToken: null,
      expiresAt: Date.now() + 60_000,
      scopes: [],
    }),
    profiles: asResource([]),
    activeProfileId: () => "usr_1",
    logout: () => Promise.resolve(),
    adoptSession: () => Promise.resolve(),
    switchProfile: () => Promise.reject(new Error("unused")),
    createProfile: () => Promise.reject(new Error("unused")),
    deleteProfile: () => Promise.resolve(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocked AuthContext; full interface fidelity not required for this test
  } as any;
}

const suggestion = (overrides: Record<string, unknown>) => ({
  handle: "bob",
  displayName: null,
  avatarUrl: null,
  mutualCount: 0,
  reason: "shared_organisation",
  sharedOrganisation: null,
  ...overrides,
});

function renderDiscover() {
  return render(() => (
    <AuthContext.Provider value={authedProvider()}>
      <DiscoverPage />
    </AuthContext.Provider>
  ));
}

beforeEach(() => {
  mocks.suggestConnections.mockResolvedValue({ suggestions: [] });
  mocks.searchProfiles.mockResolvedValue({ results: [] });
  mocks.sendConnectionRequest.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("<DiscoverPage />", () => {
  it("renders the people search box alongside the suggestions", async () => {
    renderDiscover();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeDefined());
    expect(screen.getByPlaceholderText("Search by name or @handle")).toBeDefined();
  });

  it("explains a friends-of-friends suggestion with its mutual count", async () => {
    mocks.suggestConnections.mockResolvedValue({
      suggestions: [suggestion({ reason: "mutual_connections", mutualCount: 3 })],
    });
    renderDiscover();
    expect(await screen.findByText("3 mutual connections")).toBeDefined();
  });

  it("singularises a lone mutual connection", async () => {
    mocks.suggestConnections.mockResolvedValue({
      suggestions: [suggestion({ reason: "mutual_connections", mutualCount: 1 })],
    });
    renderDiscover();
    expect(await screen.findByText("1 mutual connection")).toBeDefined();
  });

  it("names the shared organisation for a cold-start suggestion", async () => {
    mocks.suggestConnections.mockResolvedValue({
      suggestions: [
        suggestion({
          reason: "shared_organisation",
          sharedOrganisation: { handle: "acme", name: "Acme Inc" },
        }),
      ],
    });
    renderDiscover();
    expect(await screen.findByText("Also in Acme Inc")).toBeDefined();
  });

  it("sends a connection request from a suggestion card", async () => {
    mocks.suggestConnections.mockResolvedValue({
      suggestions: [suggestion({ reason: "mutual_connections", mutualCount: 2 })],
    });
    renderDiscover();
    fireEvent.click(await screen.findByText("Connect"));

    await waitFor(() => expect(mocks.sendConnectionRequest).toHaveBeenCalledWith("tkn", "bob"));
  });

  it("points an empty suggestion list at search rather than a dead end", async () => {
    renderDiscover();
    expect(await screen.findByText(/Search for someone above/)).toBeDefined();
  });
});
