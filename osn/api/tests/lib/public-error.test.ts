import { describe, it, expect } from "vitest";

import { publicError } from "../../src/lib/public-error";

/**
 * The tag walk (P-I1 / tracker#446) reads each own key through a plain
 * property access now, not `Object.getOwnPropertyDescriptor`. These tests
 * pin the behaviour that read has to preserve: a tagged error still maps to
 * its status, an untagged error still falls through to the default, a
 * throwing getter is skipped rather than propagating, and a null-prototype
 * object (no `Object.prototype`, so no inherited helpers) is still walkable.
 */
describe("publicError", () => {
  it("maps a tagged error to its dedicated status", () => {
    const err = { _tag: "ValidationError" };
    expect(publicError(err)).toEqual({ status: 400, body: { error: "invalid_request" } });
  });

  it("falls through to the generic default for an untagged error", () => {
    const err = new Error("boom");
    expect(publicError(err)).toEqual({ status: 400, body: { error: "invalid_request" } });
  });

  it("skips a throwing getter instead of propagating the throw", () => {
    const err = {
      get poison(): never {
        throw new Error("do not read me");
      },
      _tag: "DatabaseError",
    };
    expect(() => publicError(err)).not.toThrow();
    expect(publicError(err)).toEqual({ status: 500, body: { error: "internal_error" } });
  });

  it("walks a null-prototype object without throwing", () => {
    const err = Object.assign(Object.create(null), { _tag: "AuthError" }) as {
      _tag: string;
    };
    expect(publicError(err)).toEqual({ status: 400, body: { error: "invalid_request" } });
  });
});
