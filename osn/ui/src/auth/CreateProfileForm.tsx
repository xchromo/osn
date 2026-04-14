import { useAuth } from "@osn/client/solid";
import { createSignal } from "solid-js";
import { toast } from "solid-toast";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const HANDLE_RE = /^[a-z0-9_]{1,30}$/;

export interface CreateProfileFormProps {
  onSuccess?: (profile: { id: string; handle: string }) => void;
  onCancel?: () => void;
}

export function CreateProfileForm(props: CreateProfileFormProps) {
  const { createProfile } = useAuth();

  const [handle, setHandle] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  function onHandleInput(value: string) {
    setHandle(value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  }

  const handleValid = () => HANDLE_RE.test(handle());

  async function submit(e: Event) {
    e.preventDefault();
    if (!handleValid() || busy()) return;
    setBusy(true);
    try {
      const profile = await createProfile(handle(), displayName().trim() || undefined);
      toast.success(`Profile @${profile.handle} created`);
      props.onSuccess?.(profile);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <Label for="cpf-handle">Handle</Label>
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground">@</span>
          <Input
            id="cpf-handle"
            type="text"
            required
            autocomplete="username"
            value={handle()}
            onInput={(e) => onHandleInput(e.currentTarget.value)}
            placeholder="lowercase, numbers, _"
            class="flex-1"
          />
        </div>
        {handle() && !handleValid() && (
          <span class="text-destructive text-xs">
            1-30 chars: lowercase letters, numbers, underscores
          </span>
        )}
      </div>

      <div class="flex flex-col gap-1">
        <Label for="cpf-display-name">Display name (optional)</Label>
        <Input
          id="cpf-display-name"
          type="text"
          value={displayName()}
          onInput={(e) => setDisplayName(e.currentTarget.value)}
        />
      </div>

      <div class="flex gap-2">
        <Button type="submit" disabled={!handleValid() || busy()} class="flex-1">
          {busy() ? "Creating..." : "Create profile"}
        </Button>
        {props.onCancel && (
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
