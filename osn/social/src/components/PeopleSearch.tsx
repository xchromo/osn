import type { ProfileSearchResult, SearchConnectionState } from "@osn/client";
import { clsx } from "@osn/ui/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@osn/ui/ui/avatar";
import { Button } from "@osn/ui/ui/button";
import { Input } from "@osn/ui/ui/input";
import { createEffect, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { toast } from "solid-toast";

import { graphClient, recommendationClient } from "../lib/api";
import { safeAvatarUrl } from "../lib/utils";

/** Keystroke settle time before a request goes out. */
const DEBOUNCE_MS = 250;

/**
 * Mirrors `MIN_SEARCH_QUERY_LENGTH` on the server. Kept client-side too so a
 * single typed character never costs a round trip — the server would answer
 * with an empty list anyway.
 */
const MIN_QUERY_LENGTH = 2;

const RESULT_LIMIT = 8;

const LISTBOX_ID = "people-search-results";
const optionId = (index: number) => `people-search-option-${index}`;

/** Normalises the way the server does, so the two agree on "too short". */
function normalise(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

/**
 * People search with autocomplete. Typing suggests profiles by handle or
 * display name; each result carries the caller's own connection state so the
 * row can offer the right action without a follow-up request.
 *
 * Implemented as an ARIA combobox: the input owns the listbox, arrow keys move
 * a virtual focus (`aria-activedescendant`) without leaving the field, Enter
 * acts on the active row, and Escape closes.
 */
export function PeopleSearch(props: { token: string }) {
  const [query, setQuery] = createSignal("");
  const [debounced, setDebounced] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);
  const [pending, setPending] = createSignal<Set<string>>(new Set());
  /**
   * Local status overrides so a row flips to "Requested" the moment the
   * request lands, instead of waiting for a refetch that would also reorder
   * the list under the user's cursor.
   */
  const [overrides, setOverrides] = createSignal<Record<string, SearchConnectionState>>({});

  createEffect(() => {
    const next = query();
    const timer = setTimeout(() => setDebounced(next), DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  // Abort the previous request whenever a newer one starts: without this a slow
  // early keystroke can land after a fast later one. Solid already discards the
  // stale *result*; aborting also stops the wasted request.
  let inFlight: AbortController | null = null;
  onCleanup(() => inFlight?.abort());

  const [results] = createResource(
    () => {
      const q = normalise(debounced());
      return props.token && q.length >= MIN_QUERY_LENGTH ? { q, token: props.token } : undefined;
    },
    async ({ q, token }) => {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const response = await recommendationClient.searchProfiles(token, q, {
        limit: RESULT_LIMIT,
        signal: controller.signal,
      });
      return response.results;
    },
  );

  const rows = (): ProfileSearchResult[] => results.latest ?? [];
  const statusOf = (row: ProfileSearchResult): SearchConnectionState =>
    overrides()[row.handle] ?? row.connectionStatus;
  const tooShort = () => normalise(query()).length < MIN_QUERY_LENGTH;
  const showPanel = () => open() && !tooShort();

  function setStatus(handle: string, status: SearchConnectionState) {
    setOverrides((prev) => ({ ...prev, [handle]: status }));
  }

  function withPending(handle: string, run: () => Promise<void>) {
    setPending((prev) => new Set(prev).add(handle));
    void run().finally(() =>
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(handle);
        return next;
      }),
    );
  }

  function connect(handle: string) {
    withPending(handle, async () => {
      try {
        await graphClient.sendConnectionRequest(props.token, handle);
        setStatus(handle, "pending_sent");
        toast.success(`Request sent to @${handle}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send request");
      }
    });
  }

  function accept(handle: string) {
    withPending(handle, async () => {
      try {
        await graphClient.acceptConnection(props.token, handle);
        setStatus(handle, "connected");
        toast.success(`You and @${handle} are connected`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to accept request");
      }
    });
  }

  /** Enter acts on the active row: connect if we can, accept if they asked first. */
  function activate(row: ProfileSearchResult) {
    const status = statusOf(row);
    if (status === "none") connect(row.handle);
    else if (status === "pending_received") accept(row.handle);
  }

  function onKeyDown(event: KeyboardEvent) {
    const list = rows();
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (list.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const last = list.length - 1;
      // -1 means "nothing active yet". Both directions wrap, so ArrowUp from
      // the bare field jumps to the last result — the usual combobox affordance.
      setActiveIndex((current) =>
        event.key === "ArrowDown"
          ? current < 0 || current === last
            ? 0
            : current + 1
          : current <= 0
            ? last
            : current - 1,
      );
      return;
    }
    if (event.key === "Enter") {
      const row = list[activeIndex()];
      if (row) {
        event.preventDefault();
        activate(row);
      }
    }
  }

  return (
    <div
      class="relative"
      onFocusIn={() => setOpen(true)}
      onFocusOut={(event) => {
        // Only close when focus actually leaves the combobox — clicking a
        // result button must not tear the panel down before the click lands.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <label class="sr-only" for="people-search-input">
        Search people
      </label>
      <Input
        id="people-search-input"
        type="search"
        autocomplete="off"
        placeholder="Search by name or @handle"
        class="rounded-pill h-10 pl-9"
        role="combobox"
        aria-expanded={showPanel()}
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex() >= 0 ? optionId(activeIndex()) : undefined}
        value={query()}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <svg
        class="text-muted-foreground pointer-events-none absolute top-3 left-3 h-4 w-4"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      <Show when={showPanel()}>
        <div class="border-border bg-background rounded-card absolute inset-x-0 top-12 z-20 border p-1 shadow-lg">
          {/* The status line lives outside the listbox: a listbox may only
              contain options, so "Searching…" can't be a child of the <ul>. */}
          <Show when={rows().length === 0}>
            <p class="text-muted-foreground text-body px-3 py-4 text-center" aria-live="polite">
              {results.loading ? "Searching…" : `No one found for "${normalise(query())}"`}
            </p>
          </Show>
          <ul id={LISTBOX_ID} role="listbox" aria-label="People search results">
            <For each={rows()}>
              {(row, index) => (
                <li
                  id={optionId(index())}
                  role="option"
                  aria-selected={activeIndex() === index()}
                  class={clsx(
                    "flex items-center gap-3 rounded-lg px-3 py-2",
                    activeIndex() === index() && "bg-muted/60",
                  )}
                  onMouseEnter={() => setActiveIndex(index())}
                >
                  <Avatar class="h-8 w-8">
                    <Show when={safeAvatarUrl(row.avatarUrl)}>
                      {(url) => (
                        <AvatarImage
                          src={url()}
                          alt={row.handle}
                          referrerpolicy="no-referrer"
                          loading="lazy"
                        />
                      )}
                    </Show>
                    <AvatarFallback class="text-meta">
                      {row.handle.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div class="min-w-0 flex-1">
                    <p class="text-foreground text-body truncate font-medium">
                      {row.displayName || `@${row.handle}`}
                    </p>
                    <Show when={row.displayName}>
                      <p class="text-subtle text-meta truncate">@{row.handle}</p>
                    </Show>
                  </div>
                  <ResultAction
                    status={statusOf(row)}
                    busy={pending().has(row.handle)}
                    onConnect={() => connect(row.handle)}
                    onAccept={() => accept(row.handle)}
                  />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}

/** The right-hand affordance for a result row, chosen by connection state. */
function ResultAction(props: {
  status: SearchConnectionState;
  busy: boolean;
  onConnect: () => void;
  onAccept: () => void;
}) {
  return (
    <Show
      when={props.status === "none" || props.status === "pending_received"}
      fallback={
        <span class="text-subtle text-meta shrink-0">
          {props.status === "connected" ? "Connected" : "Requested"}
        </span>
      }
    >
      <Button
        size="sm"
        class="text-body rounded-pill h-7 shrink-0 max-md:h-9"
        disabled={props.busy}
        onClick={() => (props.status === "none" ? props.onConnect() : props.onAccept())}
      >
        {props.busy ? "…" : props.status === "none" ? "Connect" : "Accept"}
      </Button>
    </Show>
  );
}
