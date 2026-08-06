---
"@cire/web": patch
"@cire/organiser": patch
---

Let the recorded-RSVP confirmation actually be seen, and keep the invite
preview reachable on a phone.

**The confirmation played behind the sheet that was covering it.** #388 moved
the flourish onto the events section's Respond button precisely because that
control survives the sheet closing — but it cued the animation from
`setSaved`, the moment the reply is recorded, while the sheet still sits over
that button for its full `SAVED_DWELL_MS` dwell. The choreography runs
`TOTAL_DURATION_MS`, which is longer: the sweep-in, the tick draw and the
entire hold all elapsed under the open sheet, and the guest was uncovered onto
the closing fade alone — green draining off a button they never saw fill,
which reads as nothing having happened at all. `onConfirmed` now fires paired
with `onClose`, so the celebration starts on the frame the button becomes
visible and plays in full. A guest who dismisses the sheet early skips it and
keeps the permanent tick, which was always driven by the recorded data rather
than by this cue.

The seam slipped through because each side was tested alone: the invite-page
tests stub `RsvpModal` and invoke `onConfirmed` by hand, so nothing pinned it
against the dwell. `RsvpModal`'s own test now does.

**The invite preview had no entry point on mobile.** The top bar wrapped
"Preview invite" in `hidden @2xl/frame:inline`, and the command palette
carries modules, weddings and account but no preview command — so below that
width the control did not exist anywhere in the portal. The button is now
mounted at every width and collapses to its glyph on a narrow bar, keeping its
label as `sr-only` (never `hidden`) so the accessible name survives the width
where only the glyph is drawn.
