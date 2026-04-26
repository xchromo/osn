// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchOnboardingStatus,
  isOnboardingSkippedThisSession,
  markOnboardingSkippedThisSession,
  requestLocationPermission,
  requestNotificationPermission,
} from "../../src/lib/onboarding";

const mockMeOnboardingGet = vi.fn();
vi.mock("../../src/lib/api", () => ({
  api: {
    me: {
      onboarding: {
        get: (...args: unknown[]) => mockMeOnboardingGet(...args),
        complete: { post: vi.fn() },
      },
    },
  },
}));

function stubGeolocation(impl: PositionCallback | { code: number }) {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      geolocation: {
        getCurrentPosition: (success: PositionCallback, error?: PositionErrorCallback) => {
          if (typeof impl === "function") {
            impl({} as GeolocationPosition);
            success({} as GeolocationPosition);
          } else {
            error?.({
              code: impl.code,
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
              message: "",
            } as GeolocationPositionError);
          }
        },
      },
    },
    writable: true,
    configurable: true,
  });
}

describe("requestLocationPermission", () => {
  const origNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: origNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("returns 'granted' on a successful fix", async () => {
    stubGeolocation(() => undefined);
    expect(await requestLocationPermission()).toBe("granted");
  });

  it("returns 'denied' when the user denies the permission prompt", async () => {
    stubGeolocation({ code: 1 });
    expect(await requestLocationPermission()).toBe("denied");
  });

  it("returns 'prompt' for transient errors (timeout, position unavailable)", async () => {
    stubGeolocation({ code: 3 });
    expect(await requestLocationPermission()).toBe("prompt");
  });

  it("returns 'unsupported' when the geolocation API is missing", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
    expect(await requestLocationPermission()).toBe("unsupported");
  });
});

function stubNotification(perm: NotificationPermission, reqResult?: NotificationPermission) {
  // Use an object literal (not a class) — the spec only requires
  // `.permission` + `.requestPermission` on the constructor and oxlint's
  // no-extraneous-class rule rejects a static-only class.
  const mockNotification = {
    permission: perm,
    requestPermission: vi.fn(() => Promise.resolve(reqResult ?? perm)),
  };
  (globalThis as { Notification?: unknown }).Notification = mockNotification;
}

describe("requestNotificationPermission", () => {
  const origNotification = (globalThis as { Notification?: unknown }).Notification;

  afterEach(() => {
    if (origNotification === undefined) {
      delete (globalThis as { Notification?: unknown }).Notification;
    } else {
      (globalThis as { Notification?: unknown }).Notification = origNotification;
    }
  });

  it("returns 'granted' when permission is already granted (no extra prompt)", async () => {
    stubNotification("granted");
    expect(await requestNotificationPermission()).toBe("granted");
  });

  it("returns 'denied' when permission is already denied", async () => {
    stubNotification("denied");
    expect(await requestNotificationPermission()).toBe("denied");
  });

  it("returns 'granted' when the prompt result is granted", async () => {
    stubNotification("default", "granted");
    expect(await requestNotificationPermission()).toBe("granted");
  });

  it("maps 'default' result to 'prompt'", async () => {
    stubNotification("default", "default");
    expect(await requestNotificationPermission()).toBe("prompt");
  });

  it("returns 'unsupported' when the Notification API is missing", async () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    expect(await requestNotificationPermission()).toBe("unsupported");
  });
});

describe("session-skip helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips the skip flag through sessionStorage", () => {
    expect(isOnboardingSkippedThisSession()).toBe(false);
    markOnboardingSkippedThisSession();
    expect(isOnboardingSkippedThisSession()).toBe(true);
  });

  it("does not throw when sessionStorage is unavailable", () => {
    const orig = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      value: {
        getItem: () => {
          throw new Error("unavailable");
        },
        setItem: () => {
          throw new Error("unavailable");
        },
      },
      writable: true,
      configurable: true,
    });
    expect(() => markOnboardingSkippedThisSession()).not.toThrow();
    expect(isOnboardingSkippedThisSession()).toBe(false);
    Object.defineProperty(globalThis, "sessionStorage", {
      value: orig,
      writable: true,
      configurable: true,
    });
  });
});

describe("fetchOnboardingStatus", () => {
  beforeEach(() => {
    mockMeOnboardingGet.mockReset();
  });

  it("returns null when no token is provided (skips the network call)", async () => {
    expect(await fetchOnboardingStatus(null)).toBeNull();
    expect(mockMeOnboardingGet).not.toHaveBeenCalled();
  });

  it("returns null on transport error", async () => {
    mockMeOnboardingGet.mockResolvedValueOnce({ data: null, error: { value: "boom" } });
    expect(await fetchOnboardingStatus("tok")).toBeNull();
  });

  it("returns the status payload on success", async () => {
    mockMeOnboardingGet.mockResolvedValueOnce({
      data: {
        completedAt: null,
        interests: [],
        notificationsOptIn: false,
        eventRemindersOptIn: false,
        notificationsPerm: "prompt",
        locationPerm: "prompt",
      },
      error: null,
    });
    const status = await fetchOnboardingStatus("tok");
    expect(status?.completedAt).toBeNull();
    expect(status?.interests).toEqual([]);
  });
});
