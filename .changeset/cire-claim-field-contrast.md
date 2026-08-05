---
"@cire/web": patch
---

Guest invite: make the claim code field legible, stop hydrating the island that
owns it against the guest's scroll position, and give the form's visibility a
single owner.

Reported as "the claim input box is disappearing sometimes", with a screen
recording from a phone on 4G. Three things in it.

**The field was invisible.** Measured against the live invite's palette, the
input's fill was `bg-transparent` — literally 1.00:1 against the section behind
it — and `border-border` (the scheme's ink at 0.12 alpha) put its outline at
1.27:1. On a pale scheme that is a rectangle of the same cream as the page, and
it reads identically to the outlined submit button below it. The fill and border
now come from `--color-text` at low alpha (0.045 and 0.25): 1.09:1 and 1.77:1,
so the field reads as a field without shouting. Ink-at-alpha rather than a
surface token on purpose — the organiser picks which surface this section sits
on (`welcome_tone`: ground / card / raised), so any fixed token would vanish on
the tone that matches it, whereas ink steps away from whatever is behind it on
every palette and in the right direction (darkening a light scheme, lightening a
dark one). Both packs carry it; gala renders its own claim markup rather than
reusing `LoginSection`, so both are pinned by tests against silent divergence.

**The island that owns the form no longer hydrates on scroll.** In the recording
the whole 465px claim section leaves the layout in a single frame — the document
shrinks by exactly its height and the footer clamps up — at the moment the guest
scrolls it into view, then returns seconds later. `InvitePage` renders nothing
else before a claim, so what vanishes is the island's entire output, and with it
the only way into the invite: no form, no error, nothing. It was
`client:visible={{ rootMargin: "600px" }}`, which ties the server-rendered →
client DOM swap to the guest's scroll position; on a slow link the chunk lands
long after first paint, so the swap happens under their finger. The rootMargin
was also tuned against a `min-h-dvh` hero whose height moves (dvh changes as the
mobile toolbar collapses, the backdrop settles late), so what it observed
drifted. `client:load` hydrates off-screen during the initial load instead —
which is what the note there was already reaching for, since the session restore
wants to resolve while the hero is still on screen rather than when the guest is
already waiting on it. The chunk is one every guest fetches anyway.

**The form's visibility now has one owner.** `unlockRevealSequence` wrote
`loginForm.style.display = "none"` directly on an element whose `display` is also
a reactive SolidJS binding. Solid diffs a style binding against the last value
*it* wrote, so that imperative write didn't duplicate the binding — it
desynchronised it: Solid went on believing `display` was `""` and would skip
every later attempt to show the form again, for the life of the page. Latent
today only because nothing sets `claimResult` back to `null`; a sign-out or a
rolled-back claim surfaces it immediately.

The sequence now *reports* the swap through an `onFormHidden` hook and never
touches `display`; the island owns it through one `revealed` signal, which
`LoginSection` reads via a new optional `revealed` prop (absent ⇒ derived from
`result`, so callers that don't choreograph — and the greeting tests — are
unchanged). `handleClaimed` sets it in a `finally`, so a motion chunk that fails
to load can no longer leave the code form sitting on top of a claimed invite —
previously that was covered only incidentally, by the binding this replaces.

It also fixes the fade the choreography was written for: deriving `display` from
`claimResult` meant Solid hid the form the instant the claim resolved, a beat
*before* the sequence ran, so step 1 was animating an already-invisible element.
The form now stays on screen for its own fade-out.

Root cause of the disappearance is **not** confirmed. Ruled out by reproduction
against the live wedding's exact palette, on both the dev server and a real
`wrangler dev` production build: a slow, failed or stalled `GET /api/invite/:slug`
revalidation; Solid `Suspense` fallback (Astro wraps every island in one, but the
resource carries an `initialValue` and never suspends); hydration-key mismatch;
the returning-guest session restore; and every Turnstile failure mode (pending
forever, resolving, `render()` throwing, `api.js` blocked). What is left is
WebKit-specific and needs a real device — Playwright's WebKit build is not
reachable from this environment.
