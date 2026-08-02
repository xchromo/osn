import { describe, expect, it } from "vitest";

import { MARKETING_URL } from "./invite";

/**
 * The bare domain (`/`) redirects to the marketing site rather than to any one
 * couple's invite — cire is multi-tenant, and the root previously served
 * whichever wedding happened to be newest.
 *
 * These guard the two properties that make that redirect safe. They're cheap,
 * but the failure they catch isn't: a same-origin or relative destination turns
 * `/` into a redirect loop, which is exactly the kind of thing that looks fine
 * in review and takes the guest site's root down in production.
 */
describe("MARKETING_URL", () => {
  it("defaults to the production apex when PUBLIC_MARKETING_URL is unset", () => {
    expect(MARKETING_URL).toBe("https://cireweddings.com");
  });

  it("is an absolute off-origin URL, so `/` can never redirect to itself", () => {
    const url = new URL(MARKETING_URL);
    expect(url.protocol).toBe("https:");
    // The guest site serves invite.cireweddings.com; the apex is a different
    // host, so the 302 leaves this origin instead of re-entering the `/` route.
    expect(url.hostname).not.toBe("invite.cireweddings.com");
  });
});
