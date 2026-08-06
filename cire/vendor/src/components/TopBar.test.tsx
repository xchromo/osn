// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TopBar from "./TopBar";
import ViewTabs from "./ViewTabs";

/**
 * The chrome's contract.
 *
 * `ViewTabs` leans on `createSlidingPill`, which measures with
 * `getBoundingClientRect` and a `ResizeObserver` — neither of which happy-dom
 * computes. The pill's *geometry* is therefore tested in `lib/sliding-pill`,
 * against fed rectangles. What is testable here is everything a keyboard or a
 * screen reader depends on: what the controls are called, which one says it is
 * current, and what happens when they are pressed.
 */

const session = {
  displayName: "Acme Florals",
  handle: "acme",
  email: "hello@acme.test",
} as never;

beforeEach(() => {
  // happy-dom has no ResizeObserver; the pill observes the track and each item.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ViewTabs", () => {
  it("names both views and marks only the open one as current", () => {
    render(() => <ViewTabs value="listings" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Listings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Enquiries" })).not.toHaveAttribute("aria-current");
  });

  it("reports the view that was picked", () => {
    const onChange = vi.fn();
    render(() => <ViewTabs value="listings" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Enquiries" }));
    expect(onChange).toHaveBeenCalledWith("enquiries");
  });

  it("is not announced as an ARIA tablist", () => {
    // These swap the whole page and push history. The tab pattern promises a
    // panel that is a sibling of the strip plus roving arrow-key focus, and
    // neither is true here — so claiming the role would describe a control the
    // keyboard does not actually provide.
    render(() => <ViewTabs value="listings" onChange={() => {}} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("keeps the moving highlight out of the accessibility tree", () => {
    const { container } = render(() => <ViewTabs value="enquiries" onChange={() => {}} />);
    const pill = container.querySelector("[aria-hidden='true']");
    expect(pill).not.toBeNull();
    // It must not eat the clicks meant for the labels underneath it.
    expect(pill).toHaveClass("pointer-events-none");
  });
});

describe("TopBar", () => {
  it("removes the boot chrome once the real bar exists", () => {
    const boot = document.createElement("header");
    boot.id = "boot-chrome";
    document.body.append(boot);

    render(() => (
      <TopBar
        session={session}
        view="listings"
        onView={() => {}}
        onHome={() => {}}
        onSignOut={() => {}}
      />
    ));

    expect(document.getElementById("boot-chrome")).toBeNull();
  });

  it("says where the wordmark goes, since it is a control and not a logo", () => {
    render(() => (
      <TopBar
        session={session}
        view="listings"
        onView={() => {}}
        onHome={() => {}}
        onSignOut={() => {}}
      />
    ));
    // The glyph and the word are both aria-hidden, so the label is the only
    // name this button has — a logo that navigates and doesn't announce it is a
    // trap for anyone not looking at it.
    expect(screen.getByRole("button", { name: /cire — your listings/i })).toBeInTheDocument();
  });

  it("takes the wordmark home", () => {
    const onHome = vi.fn();
    render(() => (
      <TopBar
        session={session}
        view="enquiries"
        onView={() => {}}
        onHome={onHome}
        onSignOut={() => {}}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: /cire — your listings/i }));
    expect(onHome).toHaveBeenCalled();
  });

  it("carries the view tabs and passes a pick straight through", () => {
    const onView = vi.fn();
    render(() => (
      <TopBar
        session={session}
        view="listings"
        onView={onView}
        onHome={() => {}}
        onSignOut={() => {}}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Enquiries" }));
    expect(onView).toHaveBeenCalledWith("enquiries");
  });

  it("puts the account behind a menu rather than in the bar", () => {
    render(() => (
      <TopBar
        session={session}
        view="listings"
        onView={() => {}}
        onHome={() => {}}
        onSignOut={() => {}}
      />
    ));
    // Sign out used to be a third bare button beside the two view toggles,
    // which put "leave" one mis-click from "switch view".
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();
  });
});
