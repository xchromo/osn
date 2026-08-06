---
"@cire/web": patch
---

Guest invite: confirm a recorded RSVP instead of just closing the sheet.

**A successful RSVP was invisible.** On a 200, `handleSubmit` called `onSubmitted`
and `onClose` back to back, so the sheet vanished the instant the server replied
and the only evidence anything had happened was a sheet that was no longer
there. To a guest that is indistinguishable from a mis-tap that dismissed it,
and the natural response — reopen, re-answer, submit again — is exactly what the
absent feedback provoked.

The Save button now becomes the confirmation. A gold fill sweeps it
left-to-right, a tick draws in behind the sweep, the label changes to "Saved",
and the sheet holds that state for a beat before closing itself. The dwell is
the feature: it is the window in which the guest reads the result.

**The timings are a contract, pinned from three sides.** The sweep is a CSS
transition and the tick a keyframe, which is what earns them reduced-motion
handling for free — the existing global `prefers-reduced-motion` block clamps
both to 0.01ms, so a guest who asks for less motion lands on the finished state
instantly (measured in Chromium: fully swept and drawn within 32ms). The dwell
cannot be CSS, because it gates an `onClose()` call, so it is a `setTimeout`.
That splits one piece of choreography across two languages, and the halves can
drift apart silently — shorten the dwell below the sweep and the sheet starts
closing over a half-drawn tick, which no type check, no build and no test would
catch, since jsdom and happy-dom compute no CSS at all. The durations are
therefore stated once in `components/rsvp-saved.ts` and asserted from both ends:
`rsvp-saved.test.ts` pins the dwell against the animation's end and reads the
keyframe's own numbers back out of `global.css`, and `RsvpModal.test.tsx` pins
the button's `duration-500`, `origin-left` and `scale-x-0` classes.

The dwell is deliberately **not** clamped under reduced motion. Cutting it along
with the animation would close the sheet ~0ms after it confirmed, which is the
original bug wearing a tick. Less motion is a request for less movement, not
less time to read.

**Three details that are easy to get wrong, and their reasons.**

The fill layer is mounted at `scale-x-0` from first render rather than created
when the reply lands: a CSS transition needs a starting frame to travel from, and
an element created already in its end state simply appears there — the sweep
would silently degrade to a pop.

The confirmed Save button carries `aria-disabled`, not `disabled`. It holds
keyboard focus at the moment the reply arrives, and disabling a focused control
drops focus to `<body>` — outside an `aria-modal` dialog with no keyboard route
back in, which is the same failure the C-L2 fix in this component already
documents. The resubmit is stopped by a guard in `handleSubmit` instead, since
`aria-disabled` is advisory to the browser. For the same reason the in-flight
40% fade is now applied explicitly on `loading()` rather than through a
`disabled:opacity-40` variant, which would otherwise drag that fade onto the one
state that has to look most alive.

The tick and the sweep say nothing to a screen reader, so the sheet also carries
an `sr-only` `role="status"` region naming the event. It is mounted empty from
the start and has its text swapped, rather than being wrapped in a `<Show>` — a
live region that springs into existence alongside its content is routinely
missed, whereas a change inside one already being watched is not.

`onSubmitted` now fires as soon as the server confirms, rather than being held
until the sheet closes, so the events section behind the confirmation is already
showing the new answer when the sheet lifts off it.

Host preview plays the whole confirmation too, without a network call and
without calling `onSubmitted`. The point of preview is that a host feels exactly
what a guest feels, and a preview that skipped the confirmation would hide the
one piece of feedback this change adds.

The dwell timer is cleared on unmount, so a guest who dismisses the confirmation
early (Escape, the close chip, a backdrop tap) can't have `onClose` fired a
second time on a disposed component.

Verified in a real browser as well as in the suite, since none of the visual
half is observable to jsdom: the fill reaches 202px of the button's 204px with
`transform-origin` at the left edge, `transition-property` resolving to
`transform, translate, scale, rotate` (Tailwind v4's `scale-*` sets the
standalone `scale` property, so a `transition-transform` that didn't list it
would animate nothing), the label flipping to `--color-bg` on gold, and the tick
path fully drawn. cire/web 728 → 740 tests.
