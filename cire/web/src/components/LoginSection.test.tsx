import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import { LoginSection } from "./LoginSection";
import type { ClaimResult, FamilyMember } from "./types";

afterEach(cleanup);

function member(firstName: string, nickname: string | null = null): FamilyMember {
  return { guestId: `g-${firstName}`, firstName, lastName: "Okafor", nickname, eventIds: [] };
}

function result(members: FamilyMember[], familyName = "Okafor"): ClaimResult {
  return { publicId: "OKAFOR-LILY-AB12CD", familyName, members, events: [], rsvps: [] };
}

const noop = () => {};

describe("LoginSection greeting", () => {
  it("greets a multi-guest code as a family", () => {
    const { container } = render(() => (
      <LoginSection
        apiUrl="http://x"
        result={result([member("Chidi"), member("Ada")])}
        onClaimed={noop}
      />
    ));
    const text = container.textContent ?? "";
    expect(text).toContain("Welcome, the Okafor Family");
    // The household members are listed and the individual "Dear" greeting is absent.
    expect(text).toContain("Chidi");
    expect(text).toContain("Ada");
    expect(text).not.toContain("Dear");
  });

  it("greets a single-guest code as an individual by first name", () => {
    const { container } = render(() => (
      <LoginSection apiUrl="http://x" result={result([member("Chidi")])} onClaimed={noop} />
    ));
    const text = container.textContent ?? "";
    expect(text).toContain("Dear");
    expect(text).toContain("Chidi");
    // A lone guest is never greeted as a "Family".
    expect(text).not.toContain("Family");
  });

  it("greets a single guest by nickname when one is set", () => {
    const { container } = render(() => (
      <LoginSection apiUrl="http://x" result={result([member("Chidi", "Chi")])} onClaimed={noop} />
    ));
    const text = container.textContent ?? "";
    expect(text).toContain("Dear");
    expect(text).toContain("Chi");
    // The nickname replaces the first name in the individual greeting.
    expect(text).not.toContain("Chidi");
    expect(text).not.toContain("Family");
  });

  it("falls back to the first name when the nickname is blank/whitespace", () => {
    const { container } = render(() => (
      <LoginSection apiUrl="http://x" result={result([member("Chidi", "   ")])} onClaimed={noop} />
    ));
    const text = container.textContent ?? "";
    expect(text).toContain("Dear");
    expect(text).toContain("Chidi");
  });

  it("shows the built-in greeting line when no override is set", () => {
    const { container } = render(() => (
      <LoginSection apiUrl="http://x" result={result([member("Chidi")])} onClaimed={noop} />
    ));
    expect(container.textContent).toContain("We are delighted to invite you to celebrate with us.");
  });

  it("renders the organiser's welcome greeting override for both family and individual codes", () => {
    const greeting = "Nau mai, haere mai — we can't wait to see you!";
    const family = render(() => (
      <LoginSection
        apiUrl="http://x"
        result={result([member("Chidi"), member("Ada")])}
        onClaimed={noop}
        welcomeMessage={greeting}
      />
    ));
    expect(family.container.textContent).toContain(greeting);
    expect(family.container.textContent).not.toContain("We are delighted to invite you");
    cleanup();

    const individual = render(() => (
      <LoginSection
        apiUrl="http://x"
        result={result([member("Chidi")])}
        onClaimed={noop}
        welcomeMessage={greeting}
      />
    ));
    expect(individual.container.textContent).toContain(greeting);
    expect(individual.container.textContent).not.toContain("We are delighted to invite you");
  });
});

describe("LoginSection form/welcome swap", () => {
  const panels = (container: HTMLElement) => {
    const divs = container.querySelectorAll("section > div > div");
    return { form: divs[0] as HTMLElement, welcome: divs[1] as HTMLElement };
  };

  it("follows `revealed` in BOTH directions", () => {
    // The point of the prop. `display` has exactly one owner, so the swap is
    // reversible — the failure it replaced was an imperative
    // `style.display = "none"` from the unlock animation, which desynchronised
    // Solid's binding: Solid went on believing `display` was `""`, so every
    // later attempt to show the form again was a diff it skipped, and the code
    // form could never come back for the life of the page.
    const [revealed, setRevealed] = createSignal(false);
    const { container } = render(() => (
      <LoginSection
        apiUrl="http://x"
        result={result([member("Chidi")])}
        revealed={revealed()}
        onClaimed={noop}
      />
    ));

    expect(panels(container).form.style.display).toBe("");
    expect(panels(container).welcome.style.display).toBe("none");

    setRevealed(true);
    expect(panels(container).form.style.display).toBe("none");
    expect(panels(container).welcome.style.display).toBe("");

    // Back again — a sign-out, or a claim rolled back after a failed follow-up.
    setRevealed(false);
    expect(panels(container).form.style.display).toBe("");
    expect(panels(container).welcome.style.display).toBe("none");
  });

  it("falls back to `result` when no `revealed` is passed", () => {
    // Callers that don't choreograph the unlock (and every greeting test above)
    // get the plain instant swap.
    const claimed = render(() => (
      <LoginSection apiUrl="http://x" result={result([member("Chidi")])} onClaimed={noop} />
    ));
    expect(panels(claimed.container).form.style.display).toBe("none");
    expect(panels(claimed.container).welcome.style.display).toBe("");
    cleanup();

    const unclaimed = render(() => (
      <LoginSection apiUrl="http://x" result={null} onClaimed={noop} />
    ));
    expect(panels(unclaimed.container).form.style.display).toBe("");
    expect(panels(unclaimed.container).welcome.style.display).toBe("none");
  });
});

describe("LoginSection code field", () => {
  function codeInput() {
    const { container } = render(() => (
      <LoginSection apiUrl="http://x" result={null} onClaimed={noop} />
    ));
    const input = container.querySelector("input[type=text]");
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  // jsdom computes no colours, so the contrast contract is pinned as classes —
  // the same tactic the sticky-footer and grid-column contracts use. The values
  // were measured in a real browser against the live invite's palette: the fill
  // lifts the field off its section (1.00:1 → 1.09:1, i.e. from literally
  // indistinguishable to a visible well) and the border roughly doubles its
  // separation (1.27:1 → 1.77:1).
  it("draws the field one step off whatever surface it sits on", () => {
    const cls = codeInput().className;
    // Ink-at-alpha, NOT a surface token: the organiser chooses this section's
    // tone (ground / card / raised), so a fixed surface token would vanish on
    // the tone that matches it. Ink adapts to any palette in the right
    // direction — darkening a light scheme, lightening a dark one.
    expect(cls).toContain("bg-text/[0.045]");
    expect(cls).toContain("border-text/25");
    // `border-border` is the same ink at 0.12 — the hairline this replaced, and
    // the reason the field read as flat page on a pale scheme.
    expect(cls).not.toContain("border-border");
    // A fill means the field is no longer see-through.
    expect(cls).not.toContain("bg-transparent");
  });

  it("keeps the gold focus border and ring", () => {
    // The fill must not have displaced the focus affordance — this is the page's
    // only input, and the ring is what keeps keyboard users oriented.
    const cls = codeInput().className;
    expect(cls).toContain("focus:border-gold");
    expect(cls).toContain("focus-visible:outline-[var(--invite-focus)]");
  });
});
