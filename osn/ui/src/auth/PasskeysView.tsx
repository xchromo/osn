import type { PasskeysClient, PasskeySummary, StepUpClient, StepUpToken } from "@osn/client";
import { createResource, createSignal, For, Show } from "solid-js";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { StepUpDialog } from "./StepUpDialog";

/**
 * Settings-panel surface for listing, renaming, and deleting the caller's
 * passkeys. Mirrors `SessionsView` in shape.
 *
 * Design notes
 * ------------
 * - The `credentialId` column is never shown to users. It's included in
 *   the list response for client-side device matching ("this device") but
 *   is long, opaque, and unhelpful on screen.
 * - Delete triggers the shared `StepUpDialog` before calling the API so
 *   we fail the ceremony early if the user can't pass the sudo gate.
 * - Rename is inline and does not require step-up — the label is a UX
 *   nicety, not a security control.
 */

export interface PasskeysViewProps {
  client: PasskeysClient;
  stepUpClient: StepUpClient;
  accessToken: string;
  /**
   * Executes the browser-side WebAuthn assertion for the step-up ceremony.
   * Kept caller-side so `@osn/ui` doesn't pull `@simplewebauthn/browser`.
   */
  runPasskeyCeremony?: (options: unknown) => Promise<unknown>;
}

function formatTs(ts: number | null): string {
  if (ts === null) return "never";
  return new Date(ts * 1000).toLocaleString();
}

function friendlyLabel(p: PasskeySummary): string {
  if (p.label && p.label.trim().length > 0) return p.label;
  if (p.backupEligible) return "Synced passkey";
  return "Device passkey";
}

export function PasskeysView(props: PasskeysViewProps) {
  const [reloadKey, setReloadKey] = createSignal(0);
  const [passkeys] = createResource(reloadKey, async () => {
    const res = await props.client.list({ accessToken: props.accessToken });
    return res.passkeys;
  });
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [draftLabel, setDraftLabel] = createSignal("");
  const [stepUpOpen, setStepUpOpen] = createSignal(false);
  const [pendingDelete, setPendingDelete] = createSignal<string | null>(null);

  function startEdit(p: PasskeySummary) {
    setEditingId(p.id);
    setDraftLabel(p.label ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftLabel("");
  }

  async function saveLabel(id: string) {
    const label = draftLabel().trim();
    if (label.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await props.client.rename({ accessToken: props.accessToken, id, label });
      cancelEdit();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't rename passkey");
    } finally {
      setBusy(false);
    }
  }

  function requestDelete(id: string) {
    if (!window.confirm("Remove this passkey? You'll need another credential to sign in.")) {
      return;
    }
    setPendingDelete(id);
    setStepUpOpen(true);
  }

  async function handleStepUp(token: StepUpToken) {
    const id = pendingDelete();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await props.client.delete({
        accessToken: props.accessToken,
        id,
        stepUpToken: token.token,
      });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete passkey");
    } finally {
      setBusy(false);
      setPendingDelete(null);
      setStepUpOpen(false);
    }
  }

  function cancelStepUp() {
    setStepUpOpen(false);
    setPendingDelete(null);
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Passkeys</h2>
      </div>
      <Show when={error()}>{(msg) => <p class="text-destructive text-sm">{msg()}</p>}</Show>
      <Show when={passkeys.loading}>
        <p class="text-muted-foreground text-sm">Loading…</p>
      </Show>
      <Show when={passkeys()}>
        {(list) => (
          <ul class="flex flex-col gap-2">
            <For each={list()}>
              {(p: PasskeySummary) => (
                <li class="flex items-center justify-between rounded-md border p-3">
                  <div class="flex flex-col gap-0.5">
                    <Show
                      when={editingId() === p.id}
                      fallback={
                        <span class="font-medium">
                          {friendlyLabel(p)}
                          <Show when={p.backupEligible}>
                            <span class="text-muted-foreground ml-2 text-xs">(synced)</span>
                          </Show>
                        </span>
                      }
                    >
                      <div class="flex items-center gap-2">
                        <Input
                          class="h-8"
                          value={draftLabel()}
                          maxLength={64}
                          onInput={(e) => setDraftLabel(e.currentTarget.value)}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => saveLabel(p.id)}
                          disabled={busy() || draftLabel().trim().length === 0}
                        >
                          Save
                        </Button>
                        <Button variant="ghost" size="sm" onClick={cancelEdit}>
                          Cancel
                        </Button>
                      </div>
                    </Show>
                    <span class="text-muted-foreground text-xs">
                      Added {formatTs(Math.floor(p.createdAt))} · Last used {formatTs(p.lastUsedAt)}
                    </span>
                  </div>
                  <Show when={editingId() !== p.id}>
                    <div class="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => startEdit(p)}>
                        Rename
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => requestDelete(p.id)}
                        disabled={busy()}
                      >
                        Delete
                      </Button>
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
      <Show when={stepUpOpen()}>
        <StepUpDialog
          client={props.stepUpClient}
          accessToken={props.accessToken}
          onToken={handleStepUp}
          onCancel={cancelStepUp}
          runPasskeyCeremony={props.runPasskeyCeremony}
        />
      </Show>
    </div>
  );
}
