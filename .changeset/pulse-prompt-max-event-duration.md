---
"@pulse/api": patch
"@pulse/app": patch
---

Pulse: prompt for max event duration when creating events without an end time.

The create-event form now shows a set of duration presets (1h / 2h / 4h / 8h /
All day) when the organiser leaves the end time blank, and explains that an
event without an end time will be marked "potentially finished" after 8 hours
and automatically closed after 48 hours.

Server-side, event duration is now capped at `MAX_EVENT_DURATION_HOURS` (48h)
on both `POST /events` and `PATCH /events/:id` — longer events return 422.
Events without an explicit `endTime` now auto-transition to `"finished"` once
they've been running for more than 48h past their start time.
