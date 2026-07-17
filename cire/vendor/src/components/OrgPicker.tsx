import { useAuth } from "@osn/client/solid";
import { createResource, createSignal, For, Show } from "solid-js";

import { createOrg, listMyOrgs, type OrgSummary } from "../lib/vendor-store";

interface OrgPickerProps {
  onPick: (org: OrgSummary) => void;
}

export default function OrgPicker(props: OrgPickerProps) {
  const { authFetch } = useAuth();

  const [orgs, { mutate }] = createResource(() => listMyOrgs(authFetch));

  // Create-form state.
  const [handle, setHandle] = createSignal("");
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    const h = handle().trim().toLowerCase();
    const n = name().trim();
    if (!h || !n) return;

    setCreating(true);
    setError(null);
    try {
      const desc = description().trim();
      const created = await createOrg(authFetch, {
        handle: h,
        name: n,
        description: desc || undefined,
      });
      // Append to local list.
      mutate((prev) => [...(prev ?? []), created]);
      // Reset form.
      setHandle("");
      setName("");
      setDescription("");
      props.onPick(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organisation.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div class="font-body flex flex-col gap-6">
      {/* Org list */}
      <Show when={(orgs() ?? []).length > 0}>
        <div class="flex flex-col gap-2">
          <h2 class="text-gold-dim font-body text-[0.68rem] tracking-[0.16em] uppercase">
            Your organisations
          </h2>
          <ul class="flex flex-col gap-1">
            <For each={orgs()}>
              {(org) => (
                <li>
                  <button
                    type="button"
                    onClick={() => props.onPick(org)}
                    class="border-border bg-surface/10 hover:bg-surface/30 flex w-full items-center gap-3 rounded-sm border px-4 py-3 text-left"
                  >
                    <span class="text-text font-medium">{org.name}</span>
                    <span class="text-text-muted text-[0.82rem]">@{org.handle}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      {/* Create org form */}
      <form
        onSubmit={handleCreate}
        class="border-border bg-surface/20 flex flex-col gap-4 rounded-sm border p-4"
      >
        <h2 class="text-gold font-body text-[0.68rem] tracking-[0.16em] uppercase">
          Create a new organisation
        </h2>

        <Show when={error()}>
          <p class="border-error/40 text-error rounded-sm border px-3 py-2 text-[0.82rem]">
            {error()}
          </p>
        </Show>

        <label class="flex flex-col gap-1" for="org-handle">
          <span class="text-gold-dim font-body text-[0.68rem] tracking-[0.16em] uppercase">
            Handle
          </span>
          <input
            id="org-handle"
            type="text"
            value={handle()}
            onInput={(e) => setHandle(e.currentTarget.value)}
            placeholder="my-org"
            class="border-border bg-bg text-text rounded-sm border px-3 py-2 text-[0.9rem]"
          />
        </label>

        <label class="flex flex-col gap-1" for="org-name">
          <span class="text-gold-dim font-body text-[0.68rem] tracking-[0.16em] uppercase">
            Name
          </span>
          <input
            id="org-name"
            type="text"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="My Organisation"
            class="border-border bg-bg text-text rounded-sm border px-3 py-2 text-[0.9rem]"
          />
        </label>

        <label class="flex flex-col gap-1" for="org-description">
          <span class="text-gold-dim font-body text-[0.68rem] tracking-[0.16em] uppercase">
            Description (optional)
          </span>
          <input
            id="org-description"
            type="text"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="A short description"
            class="border-border bg-bg text-text rounded-sm border px-3 py-2 text-[0.9rem]"
          />
        </label>

        <button
          type="submit"
          disabled={creating()}
          class="bg-gold text-bg self-start rounded-sm px-4 py-2 text-[0.82rem] tracking-[0.08em] uppercase disabled:opacity-60"
        >
          {creating() ? "Creating…" : "Create organisation"}
        </button>
      </form>
    </div>
  );
}
