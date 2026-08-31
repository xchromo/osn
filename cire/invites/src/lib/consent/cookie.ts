import { type ConsentRecord, decodeConsentRecord, encodeConsentRecord } from "./record";

/**
 * Cookie transport for the consent record.
 *
 * WHY A COOKIE AND NOT `localStorage` (which is what the old Pinterest-only
 * gate used): a cookie is the only store the *server* can read. Today's two
 * gated embeds both mount inside the click-opened details sheet, so they never
 * appear in server-rendered HTML and localStorage would technically do — but
 * that is a property of where those two components happen to live, not a
 * property of the framework. The moment a third party needs to load from the
 * document `<head>` or from SSR'd markup (an analytics tag, a chat widget, the
 * font `<link>` we'd like to stop shipping to Google), a client-side store is
 * structurally too late: the request has already gone by the time any script
 * reads it. Choosing the cookie now means that case is a code change in one
 * component, not a migration of the whole consent substrate.
 *
 * The consent cookie is itself strictly necessary and needs no consent to set:
 * it exists solely to record and honour the guest's choice, including a refusal.
 * It carries no identifier — just the category booleans and a timestamp.
 *
 * `SameSite=Lax` (not `Strict`): a guest arriving from the couple's emailed
 * link is a cross-site top-level navigation, and `Strict` would withhold the
 * cookie on exactly that first hop, re-prompting someone who already decided.
 * The value is not a credential, so `Lax` costs nothing here. It is deliberately
 * NOT `HttpOnly` — client code has to read and rewrite it.
 */

export const CONSENT_COOKIE_NAME = "cire_consent";

/**
 * The `__Host-` form, written whenever the document is on a secure origin.
 *
 * `__Host-` is a browser-enforced promise, not just a naming convention: a
 * cookie carrying it is rejected outright unless it also has `Secure`,
 * `Path=/`, and no `Domain` attribute — which stops a script on a sibling
 * `*.cireweddings.com` origin from setting a same-named `Domain=.cireweddings.com`
 * cookie that could shadow or outrace this one. Without the prefix, a planted
 * domain cookie and our host-only cookie are both valid matches for the plain
 * name, and which one a browser returns first for `document.cookie` is
 * unspecified — so a guest's stored REFUSAL could be silently overridden back
 * to "allowed" by a cookie this site never set. This is osn-tracker#163.
 *
 * `serialiseConsentCookie` already writes `Path=/`, no `Domain`, and `Secure`
 * whenever `secure` is true, so the prefixed form is compatible with the
 * cookie as written today — no attribute needs to change to add it.
 */
export const PREFIXED_CONSENT_COOKIE_NAME = `__Host-${CONSENT_COOKIE_NAME}`;

/**
 * Six months. Long enough that a guest checking the invite across a year-long
 * engagement isn't nagged every visit, short enough to match the ~6-month
 * re-ask interval European regulators treat as the reasonable ceiling for
 * "consent stays fresh". A vendor-list change re-prompts sooner regardless, via
 * the policy-version check in `decodeConsentRecord`.
 */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

/**
 * Pull the raw consent value out of a cookie string.
 *
 * Accepts either side's format — they are identical: a request's `Cookie`
 * header and the browser's `document.cookie` are both `a=1; b=2`. One parser
 * therefore serves both the (future) server-side read and the client store.
 *
 * Reads BOTH the prefixed and bare names and prefers the prefixed one when
 * both are present. Two things this buys:
 *
 *  - An existing guest's choice, stored under the bare name before this
 *    change shipped, still reads back correctly on http and survives the
 *    upgrade to `__Host-` on https — there is no migration step, just a
 *    fallback.
 *  - A cookie planted under the bare name by a sibling origin (the attack
 *    `PREFIXED_CONSENT_COOKIE_NAME` exists to stop) can never win once this
 *    site has itself written the prefixed one: the prefixed value always
 *    takes precedence, so the planted cookie is inert as soon as this origin
 *    has made its own secure write.
 */
export function readConsentCookieValue(cookieString: string | null | undefined): string | null {
  if (!cookieString) return null;

  let bareValue: string | null = null;
  let prefixedValue: string | null = null;

  for (const part of cookieString.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === PREFIXED_CONSENT_COOKIE_NAME) {
      prefixedValue = part.slice(separator + 1).trim();
    } else if (name === CONSENT_COOKIE_NAME) {
      bareValue = part.slice(separator + 1).trim();
    }
  }
  return prefixedValue ?? bareValue;
}

/** Parse a cookie string straight into a record (or `null` if absent/untrusted). */
export function readConsentRecord(cookieString: string | null | undefined): ConsentRecord | null {
  return decodeConsentRecord(readConsentCookieValue(cookieString));
}

/**
 * Build the `document.cookie` / `Set-Cookie` string for a record.
 *
 * `secure` is a parameter rather than an ambient check because this module is
 * shared by client and (potentially) server callers, and because a `Secure`
 * cookie is silently DROPPED on `http://localhost` — which would make consent
 * appear not to persist in local dev while working fine in production, the most
 * annoying class of bug to chase.
 *
 * Writes {@link PREFIXED_CONSENT_COOKIE_NAME} when `secure` is true and the
 * bare {@link CONSENT_COOKIE_NAME} otherwise. `__Host-` cookies are rejected by
 * the browser without `Secure`, so on http dev the prefixed name would simply
 * fail to set — falling back to the bare name there is what keeps consent
 * persisting in local dev at all, matching the `Secure`-dropping trade above.
 */
export function serialiseConsentCookie(record: ConsentRecord, secure: boolean): string {
  const name = secure ? PREFIXED_CONSENT_COOKIE_NAME : CONSENT_COOKIE_NAME;
  const attributes = [
    `${name}=${encodeConsentRecord(record)}`,
    "Path=/",
    `Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/** Is the current document on a secure origin? Drives the `Secure` attribute. */
function isSecureContext(): boolean {
  return typeof location !== "undefined" && location.protocol === "https:";
}

/** Read the record from `document.cookie`. Returns `null` outside a browser. */
export function readConsentFromDocument(): ConsentRecord | null {
  if (typeof document === "undefined") return null;
  return readConsentRecord(document.cookie);
}

/**
 * Persist a record to `document.cookie`. Best-effort: a browser configured to
 * block cookies outright throws or silently no-ops, and that must not break the
 * page — the in-memory signal still governs the current visit, the guest just
 * gets asked again next time. Failing closed (not remembering an acceptance) is
 * the safe direction.
 */
export function writeConsentToDocument(record: ConsentRecord): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = serialiseConsentCookie(record, isSecureContext());
  } catch {
    // Storage disabled — consent applies for this visit only.
  }
}

/**
 * Write a record and confirm it actually landed, by reading `document.cookie`
 * straight back.
 *
 * `writeConsentToDocument` returns `void` and swallows a blocked write by
 * design (see its doc), so a caller that needs to know whether the write
 * really took — the reload-on-revoke path in `store.ts` (osn-tracker#162) —
 * cannot use "the call returned" as its success signal. A browser that blocks
 * cookies outright, or a Set-Cookie the browser itself rejects (an oversized
 * value, say), leaves `document.cookie` unchanged, and the read-back is the
 * only way to see that from here.
 *
 * Compares the round-tripped record against `record` by RE-encoding both
 * rather than string-matching the raw cookie value, so it does not care which
 * of the two cookie names was actually written.
 */
export function writeConsentToDocumentAndVerify(record: ConsentRecord): boolean {
  writeConsentToDocument(record);
  const readBack = readConsentFromDocument();
  return readBack !== null && encodeConsentRecord(readBack) === encodeConsentRecord(record);
}
