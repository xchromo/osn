// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import ModuleSidebar from "./ModuleSidebar";

/**
 * ModuleSidebar is the IA shell's primary nav — a keyboard-accessible <nav> of
 * module buttons with aria-current on the active one. It's presentational: it
 * renders every module (all have a read view, so nothing is hidden here — write
 * gating lives inside each module) and reports selections up.
 */
describe("ModuleSidebar", () => {
  afterEach(() => cleanup());

  /** The persistent rail. Both surfaces sit in the DOM — the container query
   *  hides one with `display: none`, which happy-dom doesn't apply — so module
   *  queries are scoped to the rail landmark rather than the document. */
  const rail = () => screen.getByRole("navigation", { name: /Wedding modules/i });

  it("renders every module in workflow order", () => {
    render(() => <ModuleSidebar active="overview" onSelect={vi.fn()} />);
    const labels = within(rail())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual([
      "◈Overview",
      "◇Schedule",
      "✓Checklist",
      "$Budget",
      "⬡Vendors",
      "✎Guests",
      "✦Invite",
      "✧Settings",
    ]);
  });

  it("marks the active module with aria-current and no others", () => {
    render(() => <ModuleSidebar active="invite" onSelect={vi.fn()} />);
    expect(
      within(rail())
        .getByRole("button", { name: /Invite/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(rail())
        .getByRole("button", { name: /Overview/ })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("opens a sheet listing every module and closes it on a selection", async () => {
    const onSelect = vi.fn();
    render(() => <ModuleSidebar active="overview" onSelect={onSelect} />);

    // The narrow-container surface: a trigger naming the current module.
    const trigger = screen.getByRole("button", { name: /Modules/ });
    fireEvent.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: /Wedding modules/i });
    const sheetLabels = within(sheet)
      .getAllByRole("button")
      // Drop the close button; keep the module rows.
      .filter((b) => b.getAttribute("aria-label") !== "Close modules")
      .map((b) => b.textContent);
    expect(sheetLabels).toHaveLength(8);
    expect(sheetLabels[0]).toContain("Overview");

    fireEvent.click(within(sheet).getByRole("button", { name: /Budget/ }));
    expect(onSelect).toHaveBeenCalledWith("budget");
  });

  it("reports the selected module up via onSelect", () => {
    const onSelect = vi.fn();
    render(() => <ModuleSidebar active="overview" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it("is a labelled navigation landmark", () => {
    render(() => <ModuleSidebar active="overview" onSelect={vi.fn()} />);
    expect(screen.getByRole("navigation", { name: /Wedding modules/i })).toBeTruthy();
  });
});
