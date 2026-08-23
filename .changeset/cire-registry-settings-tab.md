---
"@cire/api": patch
"@cire/host": patch
---

Give the registry its settings, so a couple can actually open their gift list.

Four decisions the guest surface has been reading all along had nowhere to be
made: whether the list is published, what it says at the top, where parcels go,
and whether guests may give money instead. They are now a third sub-tab in the
registry module, beside the gift list and the gifts received — deep-linkable at
`#/w/<id>/registry/settings`, and reading the same cached snapshot the list
does, so switching costs no fetch and a save patches the settings row in place.

**Publishing is blocked while the list is empty**, and the notice says why:
guests reach the list — and the money-gift option with it — only once it is
published. An already-published list keeps the toggle live, or deleting the last
gift would freeze a couple on "Published" with no way back.

**Stripe onboarding is owner-only, and an editor sees that.** Everything else on
the tab is `weddingEditor`, because a co-host helping with the list may write it;
naming the bank account gifts are paid into is not ordinary help. The panel is
visible to an editor, disabled, with the reason — a co-host who wonders why money
gifts are off gets an answer rather than a missing section.

**Intent and capability stay two things.** "Let guests give money" is disabled
until Stripe can take a charge, and the API's own `stripe_not_ready` 409 is
answered by saying so, rather than "check the fields". One live Stripe read
happens on mount for a couple mid-onboarding — they have just come back from
Stripe and the webhook can be seconds behind them — and for nobody else.
