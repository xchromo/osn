import type { SecurityEventsClient, SecurityEventSummary } from "@osn/client";
import { createResource, createSignal, For, Show } from "solid-js";

import { Button } from "../components/ui/button";

/**
 * Settings-panel banner for out-of-band security events (M-PK1b).
 *
 * Surfaces "somebody regenerated your recovery codes — was this you?" style
 * prompts on a loop that survives email filtering. The banner is the audit
 * trail's last-mile delivery: it will keep rendering until the user clicks
 * "Got it" (or re-runs the flow themselves), regardless of whether the
 * notification email was delivered.
 *
 * Design notes
 * ------------
 * - Shows one entry per unacknowledged event, newest first. Zero events =
 *   the banner collapses entirely (no empty state) so the settings page
 *   isn't cluttered.
 * - `kind` is a bounded string; we switch on it to produce the human-readable
 *   headline. Unknown kinds fall through to a generic message so a forward-
 *   compatible server can ship a new kind before the client learns about it.
 * - "Got it" calls the ack endpoint and removes the row locally. The ack is
 *   idempotent server-side, so a double-click can't cause trouble.
 */

export interface SecurityEventsBannerProps {
  client: SecurityEventsClient;
  accessToken: string;
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function headlineFor(kind: SecurityEventSummary["kind"]): string {
  switch (kind) {
    case "recovery_code_generate":
      return "Your OSN recovery codes were regenerated";
    default:
      return "Security event on your account";
  }
}

export function SecurityEventsBanner(props: SecurityEventsBannerProps) {
  const [reloadKey, setReloadKey] = createSignal(0);
  const [events] = createResource(reloadKey, async () => {
    const res = await props.client.list({ accessToken: props.accessToken });
    return res.events;
  });
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function acknowledge(id: string) {
    setBusy(true);
    setError(null);
    try {
      await props.client.acknowledge({ accessToken: props.accessToken, id });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={events() && events()!.length > 0}>
      <div class="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
        <Show when={error()}>{(msg) => <p class="text-destructive text-sm">{msg()}</p>}</Show>
        <For each={events()!}>
          {(event: SecurityEventSummary) => (
            <div class="flex items-start justify-between gap-3">
              <div class="flex flex-col gap-0.5">
                <span class="font-medium">{headlineFor(event.kind)}</span>
                <span class="text-muted-foreground text-xs">
                  {formatTs(event.createdAt)}
                  <Show when={event.uaLabel}> · {event.uaLabel}</Show>
                </span>
                <span class="text-muted-foreground text-xs">
                  If you don't recognise this, review your active sessions and rotate your
                  credentials.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => acknowledge(event.id)}
                disabled={busy()}
              >
                Got it
              </Button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
