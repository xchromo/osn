---
title: "Drag and drop — dnd-kit through a SolidJS adapter"
tags: [architecture, organiser, frontend, accessibility]
related:
  - "[[index]]"
  - "[[guest-event-editor]]"
  - "[[monorepo-structure]]"
last-reviewed: 2026-07-30
---

# Drag and drop — dnd-kit through a SolidJS adapter

Drag-to-reorder in the organiser portal is built on [dnd-kit](https://github.com/clauderic/dnd-kit).
dnd-kit publishes a **React** adapter (`@dnd-kit/react`) and a framework-agnostic
imperative core (`@dnd-kit/dom`). We take the core and wrap it in a small Solid
adapter — `cire/organiser/src/lib/dnd-sortable.ts` — which is the Solid
equivalent of React's `DragDropProvider` + `useSortable`.

Dependencies: `@dnd-kit/dom` + `@dnd-kit/abstract` on `@cire/organiser`. Do **not**
add `@dnd-kit/core` or `@dnd-kit/react` — both are React-only.

## The two primitives

| Primitive | Owns | Returns |
|---|---|---|
| `createSortableList({ ids, onReorder })` | One `DragDropManager` for the list, destroyed on owner cleanup | `{ manager, draggingId }` |
| `createSortableItem({ list, id, index, disabled? })` | One `Sortable` registration per row, unregistered on cleanup | `{ ref, handleRef, isDragging }` |

Typical shape:

```tsx
const sortable = createSortableList({
  ids: () => store.rows.map((r) => r.key),
  onReorder: (from, to) => store.reorder(from, to),
});

<ul>
  <For each={store.rows}>
    {(row, index) => <Row row={row} index={index()} sortable={sortable} />}
  </For>
</ul>

// …inside Row:
const item = createSortableItem({ list: props.sortable, id: () => props.row.key, index: () => props.index });
<li ref={item.ref}>
  <button ref={item.handleRef} aria-label={`Reorder ${props.row.name}`} class="cursor-grab touch-none">⠿</button>
  …
</li>
```

## Why the state stays yours

dnd-kit **never reorders the DOM**. Mid-drag it applies transforms to the rows
and projects the dragged row's would-be slot onto `sortable.index`; the real move
happens when your state commits and Solid's `<For>` relocates the nodes, which
dnd-kit then animates into.

Three consequences worth knowing before touching the adapter:

1. **`ids()` is read at drop time and still holds the PRE-drag order.** All the
   index maths depends on that. Don't "helpfully" pre-apply the move.
2. **The projected index wins over the drop target when they disagree** — it's
   where the row visually sits. The adapter falls back to the target row's index
   when the projection never moved (or is out of bounds). This mirrors
   `@dnd-kit/helpers`' `move`, which we don't depend on because our state isn't
   a plain array.
3. **`source.index` is duck-typed, not `instanceof`-checked.** The `dragend`
   event types its source as a bare `Draggable`; `isSortable()` is an
   `instanceof SortableDraggable` test, which is awkward to fake in a test and
   is exactly what `@dnd-kit/helpers` avoids. `dnd-sortable.test.ts` keeps a
   guard asserting the real `SortableDraggable` still carries a numeric `index`,
   so a dnd-kit upgrade that renames it fails there rather than silently in the
   UI.

## Accessibility is not optional here

Replacing ▲/▼ buttons with dragging only stays accessible because the handle is
a real focusable `<button>`. dnd-kit's default preset then gives us, for free:

- `KeyboardSensor` — **Space/Enter** to lift, **arrow keys** to move,
  **Escape** to cancel, Space/Enter/Tab to drop.
- `Accessibility` plugin — live-region announcements plus screen-reader
  instructions wired to the draggable.

Two things you must supply yourself:

- `aria-label` on the handle naming the row ("Reorder Ceremony") — the grip
  glyph alone is meaningless.
- `touch-none` (CSS `touch-action: none`) on the handle, or the browser scrolls
  the page instead of handing the gesture to dnd-kit.

## Bundle cost — lazy-load the consumer

dnd-kit is ~105 kB raw. Adding it to the organiser pushed the main chunk past
Vite's 500 kB warning, so `ModuleShell` `lazy()`-loads the view that uses it
(`EventsEditor`) behind a `<Suspense>` — the same treatment `EventTable` gives
cropperjs via `ImageCropModal`. Keep that pattern for the next adopter: a
drag-and-drop view should be a code-split chunk, not main-bundle weight for
every dashboard load.

## Scope + open follow-ups

The adapter deliberately covers **one flat list per manager**. dnd-kit's `group`
(multi-container sorting — dragging between columns) is not surfaced; add it here
rather than reaching into `@dnd-kit/dom` from a component.

Current adopters:

- **Schedule → Edit** (`EventsEditor`) — see `[[guest-event-editor]]` E7.

Still on arrow buttons, and the obvious next adopters (both would need the
`group` support above, since each reorders within a bucket):

- `ChecklistView` — tasks within a lead-time bucket, persisted via
  `tasks/reorder`.
