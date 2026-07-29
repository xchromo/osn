---
title: "Site-wide consent framework"
tags: [architecture, privacy, compliance, web]
related:
  - "[[index]]"
  - "[[invite-builder]]"
  - "[[web]]"
  - "[[security]]"
last-reviewed: 2026-07-29
---

# Site-wide consent framework

Where the guest site's cookie/third-party consent lives, what it governs, and
the rules for adding a vendor to it. Code: `cire/web/src/lib/consent/` (logic)
and `cire/web/src/components/consent/` (UI).

## Why it exists

Before this, consent was a property of one component. `PinterestBoard.tsx`
carried its own `cire:pinterest-consent` localStorage key, its own module-level
signal, its own prompt and its own copy — and it was the *only* gate on the
site. The Google Maps venue embed made an equivalent transfer (guest IP + UA) to
an equivalent US recipient with no gate at all, not because anyone had decided
that was acceptable but because nobody had written it one. Consent lived
wherever someone had remembered to put it, which meant a new embed shipped
un-gated by default.

The framework inverts that default. A third party is blocked unless it is
wrapped, and the wrapper is one component. Shipping an ungated embed is now a
deliberate act rather than an oversight.

## The model

**Categories are the unit of consent** — a guest allows "third-party content",
not "Pinterest" and "Google Maps" separately. Vendors declare which category
they belong to; the dialog toggles categories and lists the vendors under each.
Granting from a blocked embed's in-place button grants the whole category, and
the button says so, because a hidden per-vendor grant would not appear in the
preferences dialog and so could never be withdrawn.

| Category | Required? | Covers |
|---|---|---|
| `necessary` | yes, locked | `cire_session` claim cookie, Turnstile, the consent record itself |
| `functional` | no | Remembered UI preferences |
| `embeds` | no | Pinterest moodboard, Google Maps venue embed, Google Fonts (see below) |
| `analytics` | no | Nothing today — the slot exists so adding analytics later is a config line, not a new framework |

There is deliberately **no `marketing` / `advertising` category**. We don't do
it, and an unused toggle is a claim we'd have to keep true.

## Files

| File | Responsibility |
|---|---|
| `lib/consent/categories.ts` | The category enum + display metadata. `necessary` is the only required one. |
| `lib/consent/vendors.ts` | **The vendor registry** — one source of truth (see below). |
| `lib/consent/record.ts` | The persisted record: versions, grant normalisation, encode/decode. |
| `lib/consent/cookie.ts` | Cookie transport (`cire_consent`). |
| `lib/consent/store.ts` | Module-level Solid signals shared by every island. |
| `lib/consent/testing.ts` | `seedConsentForTest` / `resetConsentForTest`. |
| `components/consent/ConsentGate.tsx` | The wrapper + the default blocked-content placeholder. |
| `components/consent/ConsentBanner.tsx` | First-layer banner + the standing `ConsentPreferencesLink`. |
| `components/consent/ConsentPreferences.tsx` | The "Choose" dialog. |

## The vendor registry is the source of truth

`vendors.ts` drives the preferences dialog, the `/privacy` page's third-party
list, and (by test assertion) the CSP origin allowlist in
`lib/security-headers.ts`. The same facts used to be maintained in four places
that drifted independently — the consent copy inside the component, the privacy
prose, the CSP, and `wiki/compliance/subprocessors.md`. Adding a vendor meant
four edits, and forgetting one produced either a CSP block (loud) or an
undeclared transfer (silent, and the one that matters).

**To add a third party:**

1. Add a `ConsentVendor` entry to `CONSENT_VENDORS`.
2. Add its origins to `CSP_DIRECTIVES` in `lib/security-headers.ts` —
   `vendors.test.ts` fails until you do.
3. Wrap the component in `<ConsentGate category="…" vendor="…">`.
4. Bump `CONSENT_POLICY_VERSION` in `record.ts` (this re-prompts everyone — see
   below).
5. Add a row to the root `[[wiki/compliance/subprocessors]]` register.

### `enforcement: "gated" | "always"`

Each vendor states plainly whether the gate actually blocks it. A registry that
listed a vendor the gate didn't block would be a lie told in a compliance-shaped
voice.

- `"gated"` — no request until the category is granted. Pinterest and Google
  Maps: both mount inside the click-opened details sheet, so they never appear
  in server-rendered HTML and a client-side gate is genuinely sufficient.
- `"always"` — loads regardless. **Google Fonts only**, because the font
  `<link>` sits in the `<head>` of the server-rendered document. The right fix
  is to delete the vendor (self-host the two woff2 families), not to put the
  site's typography behind a switch and swap the typeface mid-visit. Tracked in
  `[[web]]`. Until then the dialog and `/privacy` both say "loads on every
  visit" rather than implying the toggle covers it.

## Storage

A cookie, `cire_consent`, `Path=/`, `Max-Age` 182 days, `SameSite=Lax`, `Secure`
on https only. Not `HttpOnly` — client code rewrites it.

**Why a cookie and not `localStorage`** (which the old Pinterest gate used): a
cookie is the only store the server can read. Both currently-gated embeds mount
client-side, so localStorage would technically do — but that is a property of
where those two components happen to live, not of the framework. The moment a
third party needs to load from the `<head>` or from SSR'd markup (an analytics
tag, a chat widget, the font `<link>`), a client-side store is structurally too
late: the request has gone before any script reads it.

`SameSite=Lax` not `Strict`, because a guest arriving from the couple's emailed
link is a cross-site top-level navigation and `Strict` would withhold the cookie
on exactly that first hop — re-prompting someone who already decided.

### Two versions, two jobs

- `CONSENT_RECORD_VERSION` — the storage shape. Bump when the record's structure
  changes incompatibly.
- `CONSENT_POLICY_VERSION` — the disclosure. **Bump whenever the vendor list or
  what a vendor does materially changes.** A guest who agreed to a Pinterest
  embed has not thereby agreed to whatever we add next month, so their stored
  consent was never *informed* about the newcomer and cannot be reused. A
  mismatch decodes to `null`, which re-prompts.

### `null` vs "refused everything"

The distinction the design turns on. `null` (no record) means **never asked** →
show the banner. A record with every optional grant `false` means **refused** →
never re-ask. A banner that reappeared after a refusal would be nagging the
guest towards consent.

## Hydration rule

`record()` starts `null` and is only populated in `hydrateConsent()`, which runs
from `onMount`. This keeps the server-rendered markup and the first client
render identical (both show the un-consented state), and nothing third-party can
load in the gap because gates deny until the same hydration completes. Every
gate calls `hydrateConsent` itself rather than depending on a banner having
mounted first.

## UI rules that are not negotiable

- **Reject is as easy as accept.** All three banner actions render through one
  `BannerButton` component, so they carry identical styling by construction —
  making accept "primary" would mean deliberately breaking them apart.
  `ConsentBanner.test.tsx` asserts the classNames match.
- **The dialog's toggles are a local draft** until Save. A guest who flicks a
  switch to see what it covers and then closes the dialog has granted nothing.
- **Withdrawal is permanent and findable** — `ConsentPreferencesLink` in
  `SiteFooter.astro` on every page, plus a copy on `/privacy`.
- **Consent layers sit above everything** (`Z_LAYER.CONSENT` = 200,
  `CONSENT_DIALOG` = 210). Blocked embeds live inside the details modal, so the
  dialog opened from one must not be buried behind it.

Only one mounted component renders the dialog at a time
(`claimConsentDialogHost`), or a page with both a banner and a footer link would
open two stacked copies with two independent drafts.

## Legacy migration

The old `cire:pinterest-consent` key is **deleted on hydration, not migrated**.
That click consented to Pinterest specifically; the `embeds` category now also
covers the Google Maps embed, so importing it would silently widen a narrow
consent into a broader one the guest was never shown. Those guests are asked
once more — the honest cost of consolidating the gates.

## Where it's mounted

`<ConsentBanner client:idle />` in all four document shells:
`designs/classic/Document.astro`, `designs/gala/Document.astro`,
`layouts/LegalLayout.astro`, `components/NotFoundDocument.astro`.

## Not covered

- **The organiser portal** (`cire/organiser`) has no consent surface. It loads
  no third-party embeds, and its users are authenticated hosts rather than
  guests. If it ever gains one, promote `lib/consent/` to a `@cire/consent`
  package rather than copying it.
- **Google Fonts** — see `enforcement: "always"` above.
