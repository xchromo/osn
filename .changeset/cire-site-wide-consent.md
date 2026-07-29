---
"@cire/web": patch
---

Replace the Pinterest-specific consent gate with a site-wide consent framework,
and gate the Google Maps venue embed behind it.

Consent used to be a property of one component: `PinterestBoard` carried its own
`cire:pinterest-consent` localStorage key, signal, prompt and copy, and was the
only gate on the site — while the Google Maps embed sent an equivalent IP +
user-agent transfer to Google on every event-details open, with no gate at all.

New `lib/consent/` provides a category model (`necessary` / `functional` /
`embeds` / `analytics`), a vendor registry that is the single source of truth for
every third party, a versioned consent record stored in a `cire_consent` cookie,
and a shared Solid store. New `components/consent/` provides the banner (Accept
all / Reject all / Choose, rendered through one component so refusal can never be
visually demoted), the per-category preferences dialog, a `<ConsentGate>` wrapper,
and a standing "Privacy Choices" control in the site footer.

`<ConsentGate>` does not render its children while consent is absent, so a gated
component's effects never run — that is what makes the gate real for Pinterest's
injected tracker rather than merely cosmetic. Google Maps falls back to the
existing CSS map card instead of a permission notice, so refusing costs the guest
only the interactive tiles.

The vendor registry drives the preferences dialog and the `/privacy` third-party
list, and a test asserts every declared origin is present in the CSP — so the
notice, the dialog and the security headers can no longer disagree.

Google Fonts is declared `enforcement: "always"` and disclosed as ungated in both
the dialog and `/privacy`: the font `<link>` is in the document `<head>`, so it
loads before any choice can apply. The fix is to self-host the fonts and remove
the vendor rather than to put the site's typography behind a switch.

Behaviour change: the legacy Pinterest consent key is deleted rather than
migrated — it consented to Pinterest specifically, not to the broader `embeds`
category that now also covers Google Maps — so guests who previously accepted the
Pinterest embed are asked once more.
