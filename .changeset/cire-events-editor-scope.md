---
"@cire/api": patch
"@cire/host": patch
---

Give the events editor its own change scope, so it stops loading guests and households just to keep the diff safe.

`EventsEditor.loadInto` fetched `/events`, `/guests`, and `/households` in parallel, even though this tab only edits events. It had to: the editor's save always sent `scope: "both"`, and under that scope an omitted household reads as "delete this household." Loading the other two lists just to keep their rows present in the draft was the only way to avoid data loss.

`DesiredStateChangeBody` now carries an optional `scope`, and `decodeChangeBody` uses it when present (falling back to `"both"` for callers that still send the whole draft, such as `GuestsEditor`). `EventsEditor` now loads only events, seeds guests/households as empty, and posts `scope: "events"` on preview — so the diff skips guest and household removal entirely, and the two unrelated reads are gone. Apply is unchanged: it still posts only `{ changeId }`, and `handleApply` still invalidates the guest and household caches, since removing an event still cascades into `guest_events` and `rsvps`.
