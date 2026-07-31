import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";

import { InviteClosing } from "./InviteClosing";

/**
 * Unit tests for the invite's closing section. The two design packs' InvitePage
 * tests cover the CLAIM GATE (absent pre-claim, present post-claim); this file
 * covers the component's own branches, which those tests can't reach cheaply:
 * the cropped-background path vs the plain <img> path, the aspect fallbacks, and
 * the note/image combinations.
 */

const API = "https://api.test";
const IMG = "/api/invite/anita-ben/image/footer?v=7";

const closing = (el: HTMLElement) => el.querySelector("[data-invite-closing]");

describe("InviteClosing", () => {
  afterEach(cleanup);

  describe("emptiness (the whole section is conditional)", () => {
    it("renders nothing when neither a note nor an image is set", () => {
      const { container } = render(() => <InviteClosing apiUrl={API} />);
      expect(closing(container)).toBeNull();
    });

    it("renders nothing for a whitespace-only note and no image", () => {
      const { container } = render(() => <InviteClosing apiUrl={API} message="   " />);
      expect(closing(container)).toBeNull();
    });

    it("renders for a note alone", () => {
      const { container } = render(() => (
        <InviteClosing apiUrl={API} message="No boxed gifts please" />
      ));
      const section = closing(container) as HTMLElement;
      expect(section).toBeTruthy();
      expect(section.querySelector("p")?.textContent).toBe("No boxed gifts please");
      expect(section.querySelector("img")).toBeNull();
    });

    it("renders for an image alone", () => {
      const { container } = render(() => <InviteClosing apiUrl={API} imageUrl={IMG} />);
      const section = closing(container) as HTMLElement;
      expect(section.querySelector("img")).toBeTruthy();
      expect(section.querySelector("p")).toBeNull();
    });
  });

  describe("note + image together", () => {
    it("puts the image above the note, and pads the note's own block", () => {
      const { container } = render(() => (
        <InviteClosing apiUrl={API} imageUrl={IMG} message="See you there" />
      ));
      const section = closing(container) as HTMLElement;
      const img = section.querySelector("img") as HTMLElement;
      const note = section.querySelector("p") as HTMLElement;

      // The image opens the sign-off; the couple's words read last.
      expect(img.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(note.dataset.hasImage).toBe("true");
      // The section itself is unpadded so the band can reach the viewport edge;
      // the padding that used to live there now sits on the note's own block.
      expect(section.className).not.toContain("px-6");
      expect((note.parentElement as HTMLElement).className).toContain("px-6");
      expect((note.parentElement as HTMLElement).className).toContain("py-16");
    });

    it("pads a note that has no image above it just the same", () => {
      const { container } = render(() => <InviteClosing apiUrl={API} message="See you there" />);
      const note = (closing(container) as HTMLElement).querySelector("p") as HTMLElement;
      expect(note.dataset.hasImage).toBe("false");
      expect((note.parentElement as HTMLElement).className).toContain("py-16");
    });

    it("preserves the line breaks an organiser typed", () => {
      const { container } = render(() => (
        <InviteClosing apiUrl={API} message={"line one\nline two"} />
      ));
      const note = (closing(container) as HTMLElement).querySelector("p") as HTMLElement;
      expect(note.textContent).toBe("line one\nline two");
      // `pre-line` is what makes the stored newline visible rather than collapsed.
      expect(note.className).toContain("whitespace-pre-line");
    });

    it("trims surrounding whitespace off the note", () => {
      const { container } = render(() => <InviteClosing apiUrl={API} message="  padded  " />);
      expect((closing(container) as HTMLElement).querySelector("p")?.textContent).toBe("padded");
    });
  });

  describe("image rendering (the full-bleed closing hero)", () => {
    it("resolves the path against the API origin and names a bounded variant", () => {
      const { container } = render(() => <InviteClosing apiUrl={API} imageUrl={IMG} />);
      const img = (closing(container) as HTMLElement).querySelector("img") as HTMLImageElement;

      expect(img.getAttribute("src")).toBe(`${API}${IMG}&variant=card`);
      // Two candidates, so `sizes` has a real choice and a wide desktop band
      // isn't stuck with an 800w render — this spans the viewport now.
      expect(img.getAttribute("srcset")).toContain("variant=card 800w");
      expect(img.getAttribute("srcset")).toContain("variant=hero 1600w");
      expect(img.getAttribute("sizes")).toBe("100vw");
      // Guaranteed off-screen at mount — must not race the in-viewport cards.
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
      // Decorative: the couple's words carry the meaning.
      expect(img.getAttribute("alt")).toBe("");
    });

    it("spans the full width at a fixed band height, cover-fitted", () => {
      const { container } = render(() => <InviteClosing apiUrl={API} imageUrl={IMG} />);
      const img = (closing(container) as HTMLElement).querySelector("img") as HTMLImageElement;

      // Edge to edge: full width, no centred max-width box, no rounding.
      expect(img.className).toContain("w-full");
      expect(img.className).toContain("h-[clamp(16rem,45vw,32rem)]");
      expect(img.className).toContain("object-cover");
      expect(img.className).not.toContain("mx-auto");
      // The band's height is fixed, NOT the image's own aspect — an
      // aspect-driven full-bleed box would be as tall as the viewport is wide.
      expect(img.style.getPropertyValue("aspect-ratio")).toBe("");
    });

    it("renders a cropped image as a full-bleed focal-point background layer", () => {
      const { container } = render(() => (
        <InviteClosing
          apiUrl={API}
          imageUrl={IMG}
          imageCrop={{ x: 0.1, y: 0.1, w: 0.5, h: 0.5, natW: 1000, natH: 500 }}
        />
      ));
      const section = closing(container) as HTMLElement;

      // The crop path replaces the <img> entirely — one node, not both.
      expect(section.querySelector("img")).toBeNull();
      const layer = section.querySelector("[aria-hidden='true']") as HTMLElement;
      expect(layer).toBeTruthy();
      expect(layer.style.getPropertyValue("background-image")).toContain(`${API}${IMG}`);
      // The crop is a FOCAL POINT over a cover fit (the hero's treatment), not
      // an exact frame: the band's shape is the viewport's, not the crop's, so
      // an exact fit would letterbox. Centre of {0.1,0.1,0.5,0.5} = (35%, 35%).
      expect(layer.style.getPropertyValue("background-size")).toBe("cover");
      expect(layer.style.getPropertyValue("background-position")).toBe("35% 35%");
      expect(layer.style.getPropertyValue("aspect-ratio")).toBe("");
      // Same band as the <img> path — the two can't drift.
      expect(layer.className).toContain("h-[clamp(16rem,45vw,32rem)]");
      expect(layer.className).toContain("w-full");
    });

    it("asks for the hero width, the one a full-bleed band actually needs", () => {
      const { container } = render(() => (
        <InviteClosing
          apiUrl={API}
          imageUrl={IMG}
          imageCrop={{ x: 0, y: 0, w: 0.9, h: 0.9, natW: 1000, natH: 1000 }}
        />
      ));
      const layer = (closing(container) as HTMLElement).querySelector(
        "[aria-hidden='true']",
      ) as HTMLElement;
      // A background can't carry a srcset, so it names one bounded variant —
      // and at viewport width the 320w thumb the small box used is far too soft.
      expect(layer.style.getPropertyValue("background-image")).toContain("variant=hero");
    });

    it("renders a legacy crop with no source dims as a focal point too", () => {
      const { container } = render(() => (
        <InviteClosing apiUrl={API} imageUrl={IMG} imageCrop={{ x: 0, y: 0, w: 0.5, h: 0.5 }} />
      ));
      const layer = (closing(container) as HTMLElement).querySelector(
        "[aria-hidden='true']",
      ) as HTMLElement;
      // Focal-point cover needs no captured dims — the pre-dims crops keep
      // framing the band rather than falling back to a fixed shape.
      expect(layer.style.getPropertyValue("background-size")).toBe("cover");
      expect(layer.style.getPropertyValue("background-position")).toBe("25% 25%");
    });
  });

  describe("surface", () => {
    it("paints the section background from the tone vars it is handed", () => {
      const { container } = render(() => (
        <InviteClosing
          apiUrl={API}
          message="See you there"
          themeVars={{ "--invite-section-bg": "var(--color-surface-raised)" }}
        />
      ));
      const section = closing(container) as HTMLElement;
      expect(section.style.getPropertyValue("--invite-section-bg")).toBe(
        "var(--color-surface-raised)",
      );
      expect(section.style.getPropertyValue("background-color")).toBe("var(--invite-section-bg)");
    });
  });
});
