---
"@cire/organiser": patch
"@cire/theme": patch
"@cire/web": patch
---

Centre the RSVP-by line, lift desktop type, warn about the contrast the palette
can't fix, and stop the hex field completing colours by itself.

The RSVP-by line shipped left-aligned so it sat with the cards it labels. One
line governs every card, though, and running it along their left edge makes it
read as a note on the first one — it is now centred in both design packs, on the
section's own axis.

Desktop type steps up one notch: the guest site's root goes 16px → 17px at
`min-width: 1024px`. The invite's whole scale is written in rem — every
`text-[0.82rem]` and every heading `clamp()` curve — so the root size is the one
lever that lifts all of it at once, and the rem-based spacing riding along is
what keeps the lift from crowding the text. Breakpoints are unaffected: `rem`
inside a media query resolves against the root's initial size, not the declared
one.

A contrast warning is back in the scheme editor, as the complement to
enforcement rather than a return of the old advisory. `derivePalette` holds each
token to WCAG against ONE backdrop, because a token nudged to clear every
surface it might ever touch gets dragged to an extreme by the hardest pair and
stops looking like the organiser's colour. That leaves four pairs genuinely
unguarded: text on `raised` (every modal), muted text on `ground`, and gilt and
bloom on `card` — the colour of every button, rule and marker on an event card.
New `paletteContrastWarnings(tokens)` in `@cire/theme` measures exactly those on
the derived token map, never on the seeds, so the ratio it quotes is the one a
guest gets; `PaletteField` lists each with its measured ratio and the bar it
missed. All five curated presets are clean, which is what makes a non-empty list
worth reading, and it warns rather than blocks — the fix, usually moving `card`
back toward `ground`, is a design decision the builder cannot make for anyone.
The two notices answer different questions and both can be true at once: a white
page with a white card has its `ink` rescued and still leaves modal text just
under 4.5:1.

Finally, the colour picker's hex field no longer completes a half-typed code.
Guarding our own commit path was never enough. Kobalte's `ColorField` runs its
own blur handler that parses whatever is in the field and writes the expansion
back, and Kobalte composes handlers with `composeEventHandlers`, which calls
every one unconditionally and ignores `preventDefault` — so that handler could
not be pre-empted from outside. Three digits into `#d4af37`, the partial `#d4a`
is valid shorthand: it became `#DD44AA` and committed the moment focus left the
field, which is any click on the colour area, the next picker, or outside the
popover. The field is now a plain `<input>` we own. Leaving it re-prints a
committed hex in canonical form and restores the last committed colour for
anything incomplete, so an abandoned edit never invents a colour, and a
keystroke that can't belong to a hex code is refused outright. Three-digit
shorthand no longer expands on blur — the deliberate trade, since every full hex
passes through its own three-digit prefix on the way in.
