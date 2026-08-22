---
"@cire/invites": patch
---

Give the gift list its own page at `/<slug>/registry`, and leave a band on the
invite that links to it.

The list used to be the last section of the invite. It is the one part of an
invitation a guest comes *back* to — to see what is still free, to change what
they reserved, to open it in a shop — and none of that should mean scrolling the
whole invitation again. It is also, now, a link a couple can send on its own.

**The route** (`pages/[slug]/registry.astro`) reads the invite and the list in
parallel and renders both server-side, so the gifts are in the first paint. An
unpublished, unentitled or absent list is a 404 with one set of words (the public
read answers one code for all three, and the route must not become the thing that
tells them apart); an unreachable API is a 503, not a 404; a failed *invite* read
still renders the page with the built-in theme.

**The page** (`GiftRegistryDocument.astro` + `GiftRegistryPage.tsx`) is one shell
for both design packs — the gift surfaces were always shared, and the couple's
colours, faces and section tone are what make it theirs. A sticky rail carries
the way back to the invitation; the masthead is a band, not a second hero, over
the invite's own hero image at the same URL (already cached for a guest who came
from it). Above the list, a ledger line: what is still available, and what this
household has reserved. The list itself is grouped into shelves by the couple's
own categories, in their own order, with anything ungrouped last — and no labels
at all when they grouped nothing.

**The band** (`GiftRegistryTeaser.tsx`) replaces the section on the invite:
the same heading and intro, a peek at up to four gifts that have pictures, the
link, and the availability line. It renders nothing at all for a wedding with no
published list, exactly as the section did.

Behaviour that did not change: counts and never names, no optimistic updates, the
409 race refetching and saying so with the guest's form left open, the household
read gated on the claim hint. Two things did: a failed re-read now leaves the
list on screen rather than blanking it (as a page, blanking is the whole page),
and blank organiser copy counts as unset rather than beating the fallbacks.
