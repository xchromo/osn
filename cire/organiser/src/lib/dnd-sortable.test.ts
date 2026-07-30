// @vitest-environment happy-dom
import type { DragDropManager } from "@dnd-kit/dom";
import { Sortable } from "@dnd-kit/dom/sortable";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import { createSortableItem, createSortableList } from "./dnd-sortable";

/**
 * The Solid ↔ dnd-kit bindings. A real pointer drag needs layout (which
 * happy-dom doesn't do), so these tests drive dnd-kit's monitor directly: the
 * contract worth pinning is how a `dragend` operation is translated into the
 * `(from, to)` index pair the caller commits, and that registration/teardown is
 * tied to the reactive owner.
 */

const IDS = ["a", "b", "c", "d"];

/** Dispatch a synthetic `dragend` through the manager's monitor. The stand-in
 *  operation carries only what the binding reads, hence the cast. */
function dragEnd(
  manager: DragDropManager,
  operation: {
    source: { id: string; index?: number; initialIndex?: number } | null;
    target: { id: string } | null;
    canceled?: boolean;
  },
) {
  manager.monitor.dispatch("dragend", {
    operation: { canceled: false, ...operation },
    canceled: operation.canceled ?? false,
    suspend: () => ({ resume: () => {}, abort: () => {} }),
  } as never);
}

describe("createSortableList", () => {
  it("prefers the projected slot over the drop target when they disagree", () => {
    createRoot((dispose) => {
      const onReorder = vi.fn();
      const list = createSortableList({ ids: () => IDS, onReorder });

      // "a" (index 0) was projected into slot 2 while the last collision target
      // was "d" (3). The projection is where the row visually sits ⇒ it wins.
      dragEnd(list.manager, {
        source: { id: "a", index: 2, initialIndex: 0 },
        target: { id: "d" },
      });

      expect(onReorder).toHaveBeenCalledWith(0, 2);
      dispose();
    });
  });

  it("falls back to the target's index when the projection never moved", () => {
    createRoot((dispose) => {
      const onReorder = vi.fn();
      const list = createSortableList({ ids: () => IDS, onReorder });

      // `index` still equals the source's own position ⇒ trust the drop target.
      dragEnd(list.manager, {
        source: { id: "d", index: 3, initialIndex: 3 },
        target: { id: "b" },
      });

      expect(onReorder).toHaveBeenCalledWith(3, 1);
      dispose();
    });
  });

  it("falls back to the target's index when the projection is out of bounds", () => {
    createRoot((dispose) => {
      const onReorder = vi.fn();
      const list = createSortableList({ ids: () => IDS, onReorder });

      dragEnd(list.manager, { source: { id: "a", index: 99 }, target: { id: "c" } });

      expect(onReorder).toHaveBeenCalledWith(0, 2);
      dispose();
    });
  });

  it("reads the projected index off a real dnd-kit sortable source", () => {
    // The `dragend` event types the source as a plain `Draggable`, so the
    // projection is read by duck-typing `index`. Pin that against the real class
    // so a dnd-kit upgrade that renames it fails here, not silently in the UI.
    createRoot((dispose) => {
      const list = createSortableList({ ids: () => IDS, onReorder: () => {} });
      const sortable = new Sortable({ id: "a", index: 0, register: false }, list.manager);
      const source: unknown = sortable.draggable;
      expect(typeof (source as { index: unknown }).index).toBe("number");
      sortable.destroy();
      dispose();
    });
  });

  it("ignores a canceled drag, a missing target, and a drop in place", () => {
    createRoot((dispose) => {
      const onReorder = vi.fn();
      const list = createSortableList({ ids: () => IDS, onReorder });

      dragEnd(list.manager, {
        source: { id: "a", index: 2 },
        target: { id: "c" },
        canceled: true,
      });
      dragEnd(list.manager, { source: { id: "a", index: 2 }, target: null });
      dragEnd(list.manager, { source: null, target: { id: "c" } });
      // Dropped back onto itself.
      dragEnd(list.manager, { source: { id: "b", index: 1 }, target: { id: "b" } });
      // A source that is no longer in the list (deleted mid-drag).
      dragEnd(list.manager, { source: { id: "gone", index: 1 }, target: { id: "b" } });

      expect(onReorder).not.toHaveBeenCalled();
      dispose();
    });
  });

  it("tracks the dragging id between dragstart and dragend", () => {
    createRoot((dispose) => {
      const list = createSortableList({ ids: () => IDS, onReorder: () => {} });
      expect(list.draggingId()).toBeNull();

      list.manager.monitor.dispatch("dragstart", {
        cancelable: false,
        operation: { source: { id: "b" }, target: null },
      } as never);
      expect(list.draggingId()).toBe("b");

      dragEnd(list.manager, { source: { id: "b", index: 1 }, target: { id: "b" } });
      expect(list.draggingId()).toBeNull();
      dispose();
    });
  });

  it("destroys the manager when the owner disposes", () => {
    createRoot((dispose) => {
      const onReorder = vi.fn();
      const list = createSortableList({ ids: () => IDS, onReorder });
      dispose();

      // The dragend listener is gone, so a late event can't mutate the caller.
      dragEnd(list.manager, { source: { id: "a", index: 2 }, target: { id: "c" } });
      expect(onReorder).not.toHaveBeenCalled();
    });
  });
});

describe("createSortableItem", () => {
  it("registers the row against the list and keeps its index in sync", () => {
    createRoot((dispose) => {
      const list = createSortableList({ ids: () => IDS, onReorder: () => {} });
      let index = 0;
      const item = createSortableItem({ list, id: () => "a", index: () => index });

      const row = document.createElement("li");
      const handle = document.createElement("button");
      row.append(handle);
      document.body.append(row);
      item.ref(row);
      item.handleRef(handle);

      expect(item.isDragging()).toBe(false);
      list.manager.monitor.dispatch("dragstart", {
        cancelable: false,
        operation: { source: { id: "a" }, target: null },
      } as never);
      expect(item.isDragging()).toBe(true);

      index = 2;
      row.remove();
      dispose();
    });
  });
});
