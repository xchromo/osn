---
"@cire/api": patch
"@cire/organiser": patch
---

Let an `editor` co-host set the wedding's RSVP-by date.

The deadline lives in Settings, which is owner-only — but it is the one field
on that panel that *runs* the wedding rather than describing it. The co-host
chasing replies is exactly the person who needs to move the date, and nothing
about it is something an owner can't undo.

`PUT /api/organiser/weddings/:weddingId/settings` moves from `weddingOwner()`
to `weddingEditor()` plus a field-level owner check, because a middleware can't
say "this field, not that one": the gate decides who reaches the handler (a
`viewer` still gets 403 `read_only_role`), and the handler rejects a non-owner
patch that touches anything beyond `rsvpDeadline`/`rsvpDeadlineTimezone` with
403 `owner_only_fields`, naming the keys. Shape is decoded first, so a co-host
who typos a date is told the date is wrong rather than that they lack
permission for a field they may write. The refusal is whole — a patch mixing
the deadline with an owner-only field writes neither — and it is a refusal
rather than a silent filter, since a save that reports success while discarding
half the form is the worse failure. The allow-list sits beside the field
definitions in `schemas/settings.ts`, so a setting added later is owner-only
until someone says otherwise.

Both deadline keys travel together: admitting the date without its zone would
leave a co-host able to set a deadline they can't say the zone of, and the zone
is what makes "the end of that day" mean anything.

In the portal, a co-host now sees the profile fields still disabled with the
RSVP-by picker live, under a button labelled "Save RSVP-by date" — "Save
settings" beside five disabled fields reads as a button about to overwrite
them. That save sends the deadline pair alone, not the untouched values sitting
in the disabled inputs, which would earn the 403.
