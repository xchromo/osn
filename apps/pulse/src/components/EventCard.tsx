import { Show } from "solid-js";
import type { EventItem } from "../lib/types";
import { formatTime } from "../lib/utils";

export function EventCard(props: { event: EventItem; onDelete: (id: string) => void }) {
  const e = props.event;
  return (
    <div class="rounded-xl border border-border bg-card overflow-hidden">
      <Show when={e.imageUrl}>
        <img class="w-full h-44 object-cover" src={e.imageUrl!} alt={e.title} />
      </Show>
      <div class="p-4">
        <div class="flex items-center gap-2 mb-2">
          <Show when={e.category}>
            <span class="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {e.category}
            </span>
          </Show>
          <span
            class={`text-xs ${e.status === "ongoing" ? "text-green-600 font-semibold" : e.status === "cancelled" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {e.status}
          </span>
        </div>
        <h2 class="text-base font-semibold text-foreground mb-1">{e.title}</h2>
        <Show when={e.description}>
          <p class="text-sm text-muted-foreground line-clamp-2 mb-3">{e.description}</p>
        </Show>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Show when={e.venue}>
            <span>{e.venue}</span>
          </Show>
          <Show when={e.location}>
            <span>{e.location}</span>
          </Show>
          <span>{formatTime(e.startTime)}</span>
        </div>
        <div class="mt-3 flex justify-end">
          <button
            onClick={() => {
              if (confirm(`Delete "${e.title}"?`)) props.onDelete(e.id);
            }}
            class="text-xs text-destructive hover:text-destructive/80"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
