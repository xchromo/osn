---
"@cire/api": patch
"@cire/invites": patch
---

Let a guest give money, whether or not anything is left on the list.

The other half of cash gifts: hosted Checkout, the gift the webhook writes when
Stripe says the money moved, and the panel a guest actually uses.

**`POST /api/invite/:slug/registry/contribute`** answers with a Stripe Checkout
URL for a DIRECT charge on the couple's connected account — the money is theirs
from the moment it is taken. Every gate runs before Stripe does: the registry
must be visible, the household must belong to this wedding, and the couple must
both have said yes and be able to take a charge today. A guest is turned away
before their card is, or not at all. Its own per-IP limiter (5/min), tighter
than the claim one, because every call is an outbound Stripe request.

**Nothing is recorded at checkout time.** A session is an intention; the row in
`registry_contributions` is written by the `checkout.session.completed` handler,
because Stripe is the only party that knows whether the money moved. Idempotent
on the session id — at-least-once delivery makes a duplicate ordinary — and it
re-checks what the metadata claims: the wedding must own the account the event
arrived on, and the household must belong to that wedding. This endpoint also
hears about sessions a connected account created for itself, where the metadata
is whatever its owner typed.

**The panel sits above the shelves and outside the items-exist branch**, on
purpose. A guest who finds every gift taken has not stopped wanting to give
something, and an option that appears only once the list runs dry reads as a
consolation prize. It takes no card details — the button hands off to Stripe's
own page — and says so before the guest presses, along with who reads the name
and note they wrote: the couple, never the other guests. Amounts are typed in
major units and converted once through the currency's real exponent, so a yen
gift is not 100× wrong. Coming back, `?gift=thanks` says the gift is *on its
way* rather than that it landed, because the row is the webhook's to write.

`PublicRegistryDto.cashGiftsEnabled` is now the couple's intent ANDed with
Stripe's capability, so the guest surface never reasons about the two
separately. Still inert without `STRIPE_SECRET_KEY`: no client, no route, no
button.
