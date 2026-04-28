// @vitest-environment happy-dom
import { cleanup, render as _baseRender } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wrapRouter } from "../helpers/router";

vi.mock("solid-toast", async () => {
  const { solidToastMock } = await import("../helpers/toast");
  return solidToastMock();
});

// Auth context — the page reads `session()` to get the access token, and
// claims-decode helpers in `lib/utils` derive the displayName from it.
let mockSession: () => { accessToken: string } | null = () => ({ accessToken: "tok" });
vi.mock("@osn/client/solid", () => ({
  useAuth: () => ({ session: () => mockSession() }),
}));

// The stepper has its own thorough tests — stub it to a sentinel so this
// suite focuses on what WelcomePage owns: gating + the unauth fallback.
vi.mock("../../src/pages/onboarding/OnboardingStepper", () => ({
  OnboardingStepper: (props: { displayName: string | null }) => (
    <div data-testid="stepper">stepper:{props.displayName ?? "anon"}</div>
  ),
}));

// `lib/utils.getDisplayNameFromToken` decodes the JWT — stub the whole
// utils module so we don't need to mint a real ES256 token here.
vi.mock("../../src/lib/utils", () => ({
  getDisplayNameFromToken: (token: string | null) => (token ? "Sarah" : null),
}));

import { WelcomePage } from "../../src/pages/WelcomePage";

const render: typeof _baseRender = ((factory: () => JSX.Element) =>
  _baseRender(wrapRouter(factory))) as unknown as typeof _baseRender;

describe("WelcomePage", () => {
  beforeEach(() => {
    mockSession = () => ({ accessToken: "tok" });
  });

  afterEach(() => cleanup());

  it("mounts the stepper when a session is present", () => {
    const { getByTestId } = render(() => <WelcomePage />);
    expect(getByTestId("stepper")).toBeTruthy();
  });

  it("passes the decoded displayName through to the stepper", () => {
    const { getByText } = render(() => <WelcomePage />);
    expect(getByText("stepper:Sarah")).toBeTruthy();
  });

  it("shows the sign-in fallback when no session is present", () => {
    mockSession = () => null;
    const { getByText, queryByTestId } = render(() => <WelcomePage />);
    expect(getByText("Sign in to continue")).toBeTruthy();
    expect(queryByTestId("stepper")).toBeNull();
  });
});
