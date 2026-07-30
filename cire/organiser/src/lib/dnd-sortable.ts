// SolidJS bindings for dnd-kit (https://github.com/clauderic/dnd-kit).
//
// dnd-kit ships framework adapters for React only; its `@dnd-kit/dom` core is
// framework-agnostic imperative JS, so this module is the thin Solid adapter —
// the same job `@dnd-kit/react`'s `DragDropProvider` + `useSortable` do, in ~80
// lines of Solid primitives.
//
// Two pieces:
//  - {@link createSortableList} owns one `DragDropManager` per list and turns
//    dnd-kit's `dragend` into a plain `(from, to)` index pair the caller commits
//    to its own state.
//  - {@link createSortableItem} registers one row and hands back the `ref`s to
//    spread onto the row element + its drag handle.
//
// Rendering model: dnd-kit only TRANSFORMS the rows while a drag is in flight —
// it never reorders the DOM itself. The list stays the caller's state, so the
// real reorder happens when `onReorder` commits and Solid's `<For>` moves the
// nodes; dnd-kit then animates from the transformed position to the new one.
// That's also why `ids()` is read at drop time and still holds the PRE-drag
// order — the index maths below depends on it.
//
// Accessibility comes from dnd-kit's default preset: `KeyboardSensor` (Space /
// Enter to lift, arrows to move, Escape to cancel) plus the `Accessibility`
// plugin's live-region announcements. The handle must therefore be a focusable
// element — pass a `<button>` to `handleRef`.
//
// Scope: ONE flat list per manager. dnd-kit's `group` (multi-container sorting)
// is deliberately not surfaced; add it here if a second caller needs it.
import { DragDropManager } from "@dnd-kit/dom";
import { Sortable } from "@dnd-kit/dom/sortable";
import { type Accessor, createEffect, createSignal, onCleanup, onMount } from "solid-js";

export interface SortableListOptions {
  /**
   * The list's item ids in their CURRENT (pre-drag) order. Read once, at drop
   * time, to resolve dnd-kit's source/target entities back to array indices.
   */
  ids: () => readonly string[];
  /** Commit a drop: move the item at index `from` to index `to`. */
  onReorder: (from: number, to: number) => void;
}

export interface SortableList {
  /** The manager backing this list. Pass to each row's {@link createSortableItem}. */
  readonly manager: DragDropManager;
  /** Id of the row currently being dragged, or `null` when idle. */
  readonly draggingId: Accessor<string | null>;
}

/**
 * Create the drag-and-drop controller for one sortable list. Call inside a
 * component (or any reactive owner) — the manager is destroyed on cleanup.
 */
export function createSortableList(options: SortableListOptions): SortableList {
  const manager = new DragDropManager();
  const [draggingId, setDraggingId] = createSignal<string | null>(null);

  const unsubscribes = [
    manager.monitor.addEventListener("dragstart", ({ operation }) => {
      setDraggingId(operation.source ? String(operation.source.id) : null);
    }),
    manager.monitor.addEventListener("dragend", ({ operation }) => {
      setDraggingId(null);
      const { source, target, canceled } = operation;
      if (canceled || !source || !target) return;

      const ids = options.ids();
      const from = ids.indexOf(String(source.id));
      if (from === -1) return;

      // dnd-kit's optimistic sorting already projected the slot the row was
      // dropped into onto `source.index`; trust that when it moved, and fall
      // back to the target row's own position when it didn't (e.g. a drop onto
      // a row the projection never reached). Mirrors `@dnd-kit/helpers`' `move`,
      // which duck-types the index for the same reason — a sortable source is a
      // `SortableDraggable`, but nothing in the event's type says so.
      const projected = "index" in source && typeof source.index === "number" ? source.index : -1;
      const to =
        projected !== from && projected >= 0 && projected < ids.length
          ? projected
          : ids.indexOf(String(target.id));
      if (to === -1 || to === from) return;

      options.onReorder(from, to);
    }),
  ];

  onCleanup(() => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    manager.destroy();
  });

  return { manager, draggingId };
}

export interface SortableItemOptions {
  /** The list this row belongs to. */
  list: SortableList;
  /** This row's stable id — must be one of the list's {@link SortableListOptions.ids}. */
  id: () => string;
  /** This row's current index within the list. */
  index: () => number;
  /** Suppress dragging (e.g. while the list is saving). Default `false`. */
  disabled?: () => boolean;
}

export interface SortableItem {
  /** `ref` for the row element dnd-kit drags and measures. */
  ref: (element: HTMLElement) => void;
  /** `ref` for the drag handle — must be focusable for keyboard sorting. */
  handleRef: (element: HTMLElement) => void;
  /** True while THIS row is the one being dragged. */
  isDragging: Accessor<boolean>;
}

/**
 * Register one row of a {@link createSortableList} list. Call inside the row
 * component; the registration is torn down on cleanup, so `<For>` removing the
 * row unregisters it.
 */
export function createSortableItem(options: SortableItemOptions): SortableItem {
  // `register: false` — registration measures the element, so it waits for
  // `onMount` (by which point the `ref` has run AND the node is in the document).
  const sortable = new Sortable(
    { id: options.id(), index: options.index(), register: false },
    options.list.manager,
  );

  onMount(() => onCleanup(sortable.register()));
  onCleanup(() => sortable.destroy());

  // Keep dnd-kit's view of the row in sync with the reactive props. `index`
  // matters most: dnd-kit mutates it optimistically mid-drag, and this effect
  // re-asserts the committed value once the caller's state catches up. It can't
  // fight the optimistic value mid-drag because the caller's order — and so
  // `index()` — doesn't change until the drop commits.
  createEffect(() => {
    sortable.id = options.id();
  });
  createEffect(() => {
    sortable.index = options.index();
  });
  createEffect(() => {
    sortable.disabled = options.disabled?.() ?? false;
  });

  return {
    ref: (element) => {
      sortable.element = element;
    },
    handleRef: (element) => {
      sortable.handle = element;
    },
    isDragging: () => options.list.draggingId() === options.id(),
  };
}
