// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * SettingsPanel loads the wedding profile, geocodes the typed location through
 * the server (key-optional — the button only renders when the API reports
 * geocoding available), and PUTs the whole form back. The OSN auth + api
 * helpers + toasts are stubbed; this asserts the load/seed, the lookup fill,
 * the PUT body, the slug-conflict toast, and the co-host read-only gate.
 */

const authFetchMock = vi.fn();
const redirectSpy = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@osn/client/solid", () => ({
  useAuth: () => ({ authFetch: authFetchMock }),
}));

vi.mock("solid-toast", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

vi.mock("../lib/api", () => ({
  apiUrl: (path: string) => `https://api.test${path}`,
  isAuthExpired: (err: unknown) => String(err).includes("AuthExpiredError"),
  redirectToLogin: () => redirectSpy(),
}));

import SettingsPanel from "./SettingsPanel";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PROFILE = {
  id: "wed_1",
  slug: "aisha-and-ben",
  displayName: "Aisha & Ben",
  weddingDate: "2027-03-20",
  locationName: "Sydney NSW",
  locationLat: -33.8688,
  locationLng: 151.2093,
  pricingRegion: "au-nsw",
  guestCountEstimate: 120,
  currency: "AUD",
  budgetTotalMinor: 4_500_000,
};

const EMPTY_PROFILE = {
  ...PROFILE,
  weddingDate: null,
  locationName: null,
  locationLat: null,
  locationLng: null,
  pricingRegion: null,
  guestCountEstimate: null,
  budgetTotalMinor: null,
};

function settingsResponse(overrides: Partial<typeof PROFILE> = {}, geocodingAvailable = false) {
  return json({ wedding: { ...PROFILE, ...overrides }, geocodingAvailable });
}

describe("SettingsPanel", () => {
  afterEach(() => {
    cleanup();
    authFetchMock.mockReset();
    redirectSpy.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("loads and seeds the form from the profile", async () => {
    authFetchMock.mockResolvedValueOnce(settingsResponse());
    render(() => <SettingsPanel weddingId="wed_1" canManage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Aisha & Ben")).toBeTruthy();
    });
    expect(screen.getByDisplayValue("aisha-and-ben")).toBeTruthy();
    expect(screen.getByDisplayValue("2027-03-20")).toBeTruthy();
    expect(screen.getByDisplayValue("120")).toBeTruthy();
    // Budget renders in whole-currency units (minor / 100).
    expect(screen.getByDisplayValue("45000")).toBeTruthy();
    // No geocoding key ⇒ no Look up button, manual-entry hint instead.
    expect(screen.queryByText("Look up")).toBeNull();
  });

  it("PUTs the parsed form and reports the rename up", async () => {
    authFetchMock.mockResolvedValueOnce(settingsResponse());
    const onWeddingUpdated = vi.fn();
    render(() => <SettingsPanel weddingId="wed_1" canManage onWeddingUpdated={onWeddingUpdated} />);
    await waitFor(() => expect(screen.getByDisplayValue("Aisha & Ben")).toBeTruthy());

    fireEvent.input(screen.getByDisplayValue("Aisha & Ben"), {
      target: { value: "Aisha & Benjamin" },
    });
    authFetchMock.mockResolvedValueOnce(
      json({ wedding: { ...PROFILE, displayName: "Aisha & Benjamin" } }),
    );
    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Settings saved"));
    const [url, init] = authFetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/organiser/weddings/wed_1/settings");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.displayName).toBe("Aisha & Benjamin");
    expect(body.budgetTotalMinor).toBe(4_500_000);
    expect(body.locationLat).toBe(-33.8688);
    expect(onWeddingUpdated).toHaveBeenCalledWith({
      displayName: "Aisha & Benjamin",
      slug: "aisha-and-ben",
    });
  });

  it("sends nulls for cleared optional fields", async () => {
    authFetchMock.mockResolvedValueOnce(
      json({ wedding: EMPTY_PROFILE, geocodingAvailable: false }),
    );
    render(() => <SettingsPanel weddingId="wed_1" canManage />);
    await waitFor(() => expect(screen.getByDisplayValue("Aisha & Ben")).toBeTruthy());

    authFetchMock.mockResolvedValueOnce(json({ wedding: EMPTY_PROFILE }));
    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [, init] = authFetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.weddingDate).toBeNull();
    expect(body.locationName).toBeNull();
    expect(body.locationLat).toBeNull();
    expect(body.guestCountEstimate).toBeNull();
    expect(body.budgetTotalMinor).toBeNull();
  });

  it("surfaces a slug conflict as a friendly toast", async () => {
    authFetchMock.mockResolvedValueOnce(settingsResponse());
    render(() => <SettingsPanel weddingId="wed_1" canManage />);
    await waitFor(() => expect(screen.getByDisplayValue("aisha-and-ben")).toBeTruthy());

    authFetchMock.mockResolvedValueOnce(json({ error: "slug_taken" }, 409));
    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]?.[0])).toContain("already taken");
  });

  it("rejects a half coordinate client-side without a request", async () => {
    authFetchMock.mockResolvedValueOnce(
      json({ wedding: EMPTY_PROFILE, geocodingAvailable: false }),
    );
    render(() => <SettingsPanel weddingId="wed_1" canManage />);
    await waitFor(() => expect(screen.getByDisplayValue("Aisha & Ben")).toBeTruthy());

    fireEvent.input(screen.getByLabelText("Latitude"), { target: { value: "-33.8" } });
    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]?.[0])).toContain("both a latitude and a longitude");
    // Only the initial GET happened — the invalid form never left the page.
    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });

  it("fills coordinates + region from a successful lookup", async () => {
    authFetchMock.mockResolvedValueOnce(json({ wedding: EMPTY_PROFILE, geocodingAvailable: true }));
    render(() => <SettingsPanel weddingId="wed_1" canManage />);
    await waitFor(() => expect(screen.getByText("Look up")).toBeTruthy());

    fireEvent.input(screen.getByPlaceholderText("e.g. Bendooley Estate, Berrima NSW"), {
      target: { value: "Berrima NSW" },
    });
    authFetchMock.mockResolvedValueOnce(
      json({
        status: "ok",
        point: { lat: -34.4888, lng: 150.339, formattedAddress: "Berrima NSW 2577, Australia" },
        pricingRegion: "au-nsw",
      }),
    );
    fireEvent.click(screen.getByText("Look up"));

    await waitFor(() => expect(screen.getByText(/Matched: Berrima NSW/)).toBeTruthy());
    expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe("-34.4888");
    expect((screen.getByLabelText("Longitude") as HTMLInputElement).value).toBe("150.339");
    expect((screen.getByLabelText("Region") as HTMLSelectElement).value).toBe("au-nsw");
    const [url, init] = authFetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/organiser/weddings/wed_1/settings/geocode");
    expect(JSON.parse(String(init.body))).toEqual({ query: "Berrima NSW" });
  });

  it("degrades to a hint when the lookup finds nothing", async () => {
    authFetchMock.mockResolvedValueOnce(json({ wedding: EMPTY_PROFILE, geocodingAvailable: true }));
    render(() => <SettingsPanel weddingId="wed_1" canManage />);
    await waitFor(() => expect(screen.getByText("Look up")).toBeTruthy());

    fireEvent.input(screen.getByPlaceholderText("e.g. Bendooley Estate, Berrima NSW"), {
      target: { value: "xyzzy" },
    });
    authFetchMock.mockResolvedValueOnce(json({ status: "not_found" }));
    fireEvent.click(screen.getByText("Look up"));

    await waitFor(() => expect(screen.getByText(/No match for that address/)).toBeTruthy());
  });

  it("renders read-only for a co-host", async () => {
    authFetchMock.mockResolvedValueOnce(settingsResponse());
    render(() => <SettingsPanel weddingId="wed_1" canManage={false} />);
    await waitFor(() => expect(screen.getByDisplayValue("Aisha & Ben")).toBeTruthy());

    expect(screen.queryByText("Save settings")).toBeNull();
    expect(screen.getByText(/Only the wedding.s owner can change these settings/)).toBeTruthy();
    expect((screen.getByDisplayValue("Aisha & Ben") as HTMLInputElement).disabled).toBe(true);
  });

  it("warns when the slug differs from the saved one", async () => {
    authFetchMock.mockResolvedValueOnce(settingsResponse());
    render(() => <SettingsPanel weddingId="wed_1" canManage />);
    await waitFor(() => expect(screen.getByDisplayValue("aisha-and-ben")).toBeTruthy());

    expect(screen.queryByText(/Changing the link breaks/)).toBeNull();
    fireEvent.input(screen.getByDisplayValue("aisha-and-ben"), {
      target: { value: "new-link" },
    });
    await waitFor(() => expect(screen.getByText(/Changing the link breaks/)).toBeTruthy());
  });
});
