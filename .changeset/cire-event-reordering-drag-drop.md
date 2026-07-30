---
"@cire/organiser": patch
---

Re-order the schedule by dragging, not by clicking arrows.

The host dashboard's Schedule → Edit list had a ▲/▼ button pair on every event
row. Those are replaced by a grip handle you drag, built on
[dnd-kit](https://github.com/clauderic/dnd-kit).

dnd-kit ships a React adapter only, so `lib/dnd-sortable.ts` is a small SolidJS
adapter over its framework-agnostic `@dnd-kit/dom` core: `createSortableList`
owns one `DragDropManager` per list and turns a `dragend` into a plain
`(from, to)` index pair, and `createSortableItem` registers a row and returns
the element + handle refs. dnd-kit transforms rows mid-drag rather than
reordering the DOM, so the list stays draft state and `<For>` performs the move
on commit — which is why the adapter reads the item ids at drop time and still
sees the pre-drag order. The draft store follows suit:
`moveEvent(key, ±1)` becomes `reorderEvents(from, to)`.

Keyboard re-ordering survives the arrows' removal: the grip is a real
`<button>`, so dnd-kit's default keyboard sensor drives it (Space/Enter to lift,
arrows to move, Escape to cancel) with live-region announcements, and
`touch-action: none` on the handle keeps touch drags from being eaten by
scrolling.

dnd-kit costs ~105 kB raw, which pushed the organiser's main chunk past Vite's
500 kB warning, so `ModuleShell` now `lazy()`-loads `EventsEditor` behind a
`<Suspense>` — the same treatment `EventTable` already gives cropperjs. dnd-kit
lands in a 124 kB on-demand chunk that only the write-only Edit sub-tab pulls,
and the main chunk is back under the threshold.

Frontend-only: no API, schema or `sortOrder` semantics change.
