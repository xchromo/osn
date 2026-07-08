---
"@cire/api": minor
"@cire/organiser": minor
"@cire/web": patch
"@cire/db": patch
---

Make **End** and **Location** optional in the events CSV spec
(`REQUIRED_EVENT_COLUMNS` is now Event Name / Start / Timezone), and stop
silently discarding the Location value.

**End**: a blank or absent End cell stores the `""` no-stated-end sentinel in
`events.end_at` (column stays NOT NULL — no rebuild). Consumers all handle it:
the guest invite's time range already degraded to start-only; the organiser
`EventTable` now drops the dangling "– end" instead of falling into the
Invalid-Date path; Google/ICS calendar links fall back to a zero-duration entry
(`effectiveEnd`) instead of emitting `NaN` timestamps; and the retention sweep
now selects on `max(max(end_at, start_at))` — without that, a wedding whose
events were all open-ended would aggregate to `max("") < cutoff` and have its
guest data swept immediately.

**Location**: the parser required it per-row, then `applyImport` threw it away —
there is no `events.location` column (dropped in migration 0025) and the
invite's "Where" + Open-in-Maps derive from Address, so it was never displayed.
It's now optional (`ParsedEvent.location: string | null`) and, when provided
with a blank Address, is written into `events.address` at import-apply time so
the venue name actually reaches the invite.

`"End is required"` / `"Location is required"` are removed from the closed
`MalformedSpreadsheetReason` union. The organiser template
(`EVENT_REQUIRED_HEADERS`/`EVENT_OPTIONAL_HEADERS`), starter CSV (second row
shows a blank End), and the import explainer's Timestamps/Venue tips are kept
in lockstep; new tests cover the parser optionality, the address fallback
(create + update paths), the retention open-ended cases, the EventTable
rendering, and the calendar zero-duration fallback.
