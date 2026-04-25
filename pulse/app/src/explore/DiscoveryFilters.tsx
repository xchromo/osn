import { Button } from "@osn/ui/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@osn/ui/ui/dialog";
import { Input } from "@osn/ui/ui/input";
import { Label } from "@osn/ui/ui/label";
import { Show, createSignal } from "solid-js";

export interface DiscoveryFilterValues {
  from: string | null;
  to: string | null;
  radiusKm: number | null;
  priceMin: number | null;
  priceMax: number | null;
  friendsOnly: boolean;
}

export const emptyFilters = (): DiscoveryFilterValues => ({
  from: null,
  to: null,
  radiusKm: null,
  priceMin: null,
  priceMax: null,
  friendsOnly: false,
});

export const hasActiveFilters = (v: DiscoveryFilterValues): boolean =>
  v.from != null ||
  v.to != null ||
  v.radiusKm != null ||
  v.priceMin != null ||
  v.priceMax != null ||
  v.friendsOnly;

const toNumberOrNull = (raw: string): number | null => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export function DiscoveryFilters(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  signedIn: boolean;
  value: DiscoveryFilterValues;
  onApply: (v: DiscoveryFilterValues) => void;
}) {
  // Internal draft — applied to the outer state only when the user clicks
  // Apply, so a partial edit doesn't trigger a refetch on every keystroke.
  const [draft, setDraft] = createSignal<DiscoveryFilterValues>({ ...props.value });

  const setField = <K extends keyof DiscoveryFilterValues>(
    key: K,
    value: DiscoveryFilterValues[K],
  ) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (v) setDraft({ ...props.value });
        props.onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>More filters</DialogTitle>
        </DialogHeader>

        <div class="flex flex-col gap-4 p-4">
          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1">
              <Label for="discovery-from">From</Label>
              <Input
                id="discovery-from"
                type="datetime-local"
                value={draft().from ?? ""}
                onInput={(e) => setField("from", e.currentTarget.value || null)}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label for="discovery-to">To</Label>
              <Input
                id="discovery-to"
                type="datetime-local"
                value={draft().to ?? ""}
                onInput={(e) => setField("to", e.currentTarget.value || null)}
              />
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <Label for="discovery-radius">Within radius (km)</Label>
            <Input
              id="discovery-radius"
              type="number"
              min="1"
              max="500"
              step="1"
              placeholder="e.g. 25"
              value={draft().radiusKm ?? ""}
              onInput={(e) => setField("radiusKm", toNumberOrNull(e.currentTarget.value))}
            />
            <p class="text-muted-foreground text-xs">Uses your current location. Max 500km.</p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1">
              <Label for="discovery-price-min">Price min</Label>
              <Input
                id="discovery-price-min"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={draft().priceMin ?? ""}
                onInput={(e) => setField("priceMin", toNumberOrNull(e.currentTarget.value))}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label for="discovery-price-max">Price max</Label>
              <Input
                id="discovery-price-max"
                type="number"
                min="0"
                step="1"
                placeholder="Any"
                value={draft().priceMax ?? ""}
                onInput={(e) => setField("priceMax", toNumberOrNull(e.currentTarget.value))}
              />
            </div>
          </div>

          <Show when={props.signedIn}>
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft().friendsOnly}
                onChange={(e) => setField("friendsOnly", e.currentTarget.checked)}
              />
              Only events hosted by or RSVPed by friends
            </label>
          </Show>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(emptyFilters());
              props.onApply(emptyFilters());
              props.onOpenChange(false);
            }}
          >
            Clear
          </Button>
          <Button
            type="button"
            onClick={() => {
              props.onApply(draft());
              props.onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
