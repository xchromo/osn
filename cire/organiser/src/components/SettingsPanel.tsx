import { useAuth } from "@osn/client/solid";
import { createSignal, For, onMount, Show } from "solid-js";
import { toast } from "solid-toast";

import { apiUrl, isAuthExpired, redirectToLogin } from "../lib/api";
import SectionIntro from "./SectionIntro";

/** The wedding profile as the settings API reads/writes it. */
interface WeddingProfile {
  id: string;
  slug: string;
  displayName: string;
  weddingDate: string | null;
  locationName: string | null;
  locationLat: number | null;
  locationLng: number | null;
  pricingRegion: string | null;
  guestCountEstimate: number | null;
  currency: string;
  budgetTotalMinor: number | null;
}

interface GeocodePoint {
  lat: number;
  lng: number;
  formattedAddress: string;
}

type GeocodeResponse =
  | { status: "ok"; point: GeocodePoint; pricingRegion: string }
  | { status: "not_found" }
  | { status: "unavailable" };

/** Pricing-region choices — mirrors the API's closed enum (single source of
 *  truth: `cire/api/src/lib/pricing-regions.ts`); the save is validated
 *  server-side against it. Normally set by the location lookup; the select is
 *  the manual fallback. */
const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Not set" },
  { value: "au-nsw", label: "New South Wales" },
  { value: "au-vic", label: "Victoria" },
  { value: "au-qld", label: "Queensland" },
  { value: "au-wa", label: "Western Australia" },
  { value: "au-sa", label: "South Australia" },
  { value: "au-tas", label: "Tasmania" },
  { value: "au-act", label: "ACT" },
  { value: "au-nt", label: "Northern Territory" },
  { value: "au-other", label: "Australia — other" },
  { value: "international", label: "Outside Australia" },
];

const labelClass = "font-body text-text-muted text-[0.72rem] tracking-[0.1em] uppercase";
const inputClass =
  "border-border bg-bg font-body text-text focus:border-gold rounded-sm border px-3 py-2 text-[0.95rem] transition-colors outline-none placeholder:opacity-40 disabled:opacity-40";
const hintClass = "font-body text-text-muted text-[0.75rem] leading-snug";

interface SettingsPanelProps {
  weddingId: string;
  /** Owner of this wedding? Settings writes are owner-only — co-hosts see the
   *  profile read-only. */
  canManage: boolean;
  /** Reports a saved name/slug up so the header + wedding list stay current
   *  without a refetch. */
  onWeddingUpdated?: (patch: { displayName: string; slug: string }) => void;
}

/**
 * The wedding profile: name, guest-site link, date, location (server-side
 * geocoded when a key is configured, manual coordinates otherwise), guest
 * count, currency, and total budget. These facts drive the planning modules
 * (checklist lead times, pricing estimates, vendor search) — none of them
 * change the guest invite except the name and the link slug.
 */
export default function SettingsPanel(props: SettingsPanelProps) {
  const { authFetch } = useAuth();

  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [geocodingAvailable, setGeocodingAvailable] = createSignal(false);

  // Form state, seeded from the loaded profile. Numbers are kept as input
  // strings so a half-typed value never round-trips through parseFloat.
  const [displayName, setDisplayName] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [savedSlug, setSavedSlug] = createSignal("");
  const [weddingDate, setWeddingDate] = createSignal("");
  const [locationName, setLocationName] = createSignal("");
  const [lat, setLat] = createSignal("");
  const [lng, setLng] = createSignal("");
  const [pricingRegion, setPricingRegion] = createSignal("");
  const [guestCount, setGuestCount] = createSignal("");
  const [currency, setCurrency] = createSignal("AUD");
  const [budget, setBudget] = createSignal("");

  const [lookupBusy, setLookupBusy] = createSignal(false);
  const [lookupNote, setLookupNote] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const readOnly = () => !props.canManage;

  function seed(profile: WeddingProfile) {
    setDisplayName(profile.displayName);
    setSlug(profile.slug);
    setSavedSlug(profile.slug);
    setWeddingDate(profile.weddingDate ?? "");
    setLocationName(profile.locationName ?? "");
    setLat(profile.locationLat === null ? "" : String(profile.locationLat));
    setLng(profile.locationLng === null ? "" : String(profile.locationLng));
    setPricingRegion(profile.pricingRegion ?? "");
    setGuestCount(profile.guestCountEstimate === null ? "" : String(profile.guestCountEstimate));
    setCurrency(profile.currency);
    setBudget(profile.budgetTotalMinor === null ? "" : (profile.budgetTotalMinor / 100).toString());
  }

  onMount(async () => {
    try {
      const res = await authFetch(apiUrl(`/api/organiser/weddings/${props.weddingId}/settings`));
      if (res.status === 401) return redirectToLogin();
      if (!res.ok) {
        setLoadError(`Could not load the wedding profile (${res.status}).`);
        return;
      }
      const body = (await res.json()) as {
        wedding: WeddingProfile;
        geocodingAvailable: boolean;
      };
      seed(body.wedding);
      setGeocodingAvailable(body.geocodingAvailable);
    } catch (err) {
      if (isAuthExpired(err)) return redirectToLogin();
      setLoadError("Could not load the wedding profile. Is the API running?");
    } finally {
      setLoading(false);
    }
  });

  async function lookUpLocation() {
    const query = locationName().trim();
    if (!query || lookupBusy()) return;
    setLookupBusy(true);
    setLookupNote(null);
    try {
      const res = await authFetch(
        apiUrl(`/api/organiser/weddings/${props.weddingId}/settings/geocode`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        },
      );
      if (res.status === 401) return redirectToLogin();
      if (!res.ok) {
        setLookupNote("The lookup failed — you can enter coordinates below instead.");
        return;
      }
      const body = (await res.json()) as GeocodeResponse;
      if (body.status === "ok") {
        setLat(String(body.point.lat));
        setLng(String(body.point.lng));
        setPricingRegion(body.pricingRegion);
        setLookupNote(`Matched: ${body.point.formattedAddress}`);
      } else if (body.status === "not_found") {
        setLookupNote("No match for that address — try adding a suburb or state.");
      } else {
        setLookupNote("Location lookup isn't available — you can enter coordinates below.");
      }
    } catch (err) {
      if (isAuthExpired(err)) return redirectToLogin();
      setLookupNote("The lookup failed — you can enter coordinates below instead.");
    } finally {
      setLookupBusy(false);
    }
  }

  /** Parse the form into the PUT body, or return a human error. Mirrors the
   *  server's validation so the common mistakes never round-trip. */
  function buildBody(): { body: Record<string, unknown> } | { error: string } {
    const name = displayName().trim();
    if (!name) return { error: "Give the wedding a name." };

    const nextSlug = slug().trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug)) {
      return { error: "The link can only use lowercase letters, numbers, and hyphens." };
    }

    const curr = currency().trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(curr)) {
      return { error: "Currency must be a 3-letter code, like AUD." };
    }

    const latText = lat().trim();
    const lngText = lng().trim();
    if ((latText === "") !== (lngText === "")) {
      return { error: "Enter both a latitude and a longitude, or neither." };
    }
    const latNum = latText === "" ? null : Number(latText);
    const lngNum = lngText === "" ? null : Number(lngText);
    if (latNum !== null && (!Number.isFinite(latNum) || Math.abs(latNum) > 90)) {
      return { error: "Latitude must be a number between -90 and 90." };
    }
    if (lngNum !== null && (!Number.isFinite(lngNum) || Math.abs(lngNum) > 180)) {
      return { error: "Longitude must be a number between -180 and 180." };
    }

    const guests = guestCount().trim();
    const guestNum = guests === "" ? null : Number(guests);
    if (guestNum !== null && (!Number.isInteger(guestNum) || guestNum < 1 || guestNum > 10_000)) {
      return { error: "Guest count must be a whole number between 1 and 10,000." };
    }

    const budgetText = budget().trim();
    const budgetNum = budgetText === "" ? null : Number(budgetText);
    if (budgetNum !== null && (!Number.isFinite(budgetNum) || budgetNum < 0)) {
      return { error: "Budget must be a positive amount." };
    }

    return {
      body: {
        displayName: name,
        slug: nextSlug,
        weddingDate: weddingDate() || null,
        locationName: locationName().trim() || null,
        locationLat: latNum,
        locationLng: lngNum,
        pricingRegion: pricingRegion() || null,
        guestCountEstimate: guestNum,
        currency: curr,
        budgetTotalMinor: budgetNum === null ? null : Math.round(budgetNum * 100),
      },
    };
  }

  async function save(e: Event) {
    e.preventDefault();
    if (saving() || readOnly()) return;
    const built = buildBody();
    if ("error" in built) {
      toast.error(built.error);
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(apiUrl(`/api/organiser/weddings/${props.weddingId}/settings`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      if (res.status === 401) return redirectToLogin();
      if (res.status === 409) {
        toast.error("That link is already taken by another wedding — pick a different one.");
        return;
      }
      if (!res.ok) {
        toast.error("Could not save the settings. Please check the fields and try again.");
        return;
      }
      const body = (await res.json()) as { wedding: WeddingProfile };
      seed(body.wedding);
      props.onWeddingUpdated?.({
        displayName: body.wedding.displayName,
        slug: body.wedding.slug,
      });
      toast.success("Settings saved");
    } catch (err) {
      if (isAuthExpired(err)) return redirectToLogin();
      toast.error("Could not save the settings. Is the API running?");
    } finally {
      setSaving(false);
    }
  }

  const disabled = () => readOnly() || saving();

  return (
    <div class="border-border bg-surface/30 flex flex-col gap-6 rounded-sm border p-6">
      <SectionIntro
        eyebrow="Settings"
        title="Wedding profile"
        description="The facts that drive your planning tools — the date, where you're celebrating, roughly how many guests, and your budget. Guests never see any of this; only the name and the invite link appear on the invite."
      />

      <Show when={loadError()}>
        {(message) => (
          <p class="border-error/20 bg-error/5 text-error rounded-sm border p-4 text-[0.88rem]">
            {message()}
          </p>
        )}
      </Show>

      <Show when={!loading() && !loadError()}>
        {/* noValidate: buildBody() mirrors the server's validation with friendlier
            messages, so native constraint UI never fires — and number/step
            constraint math is float-buggy in some DOM engines anyway. */}
        <form class="flex flex-col gap-5" noValidate onSubmit={save}>
          <Show when={readOnly()}>
            <p class={hintClass}>Only the wedding&apos;s owner can change these settings.</p>
          </Show>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class={labelClass}>Wedding name</span>
              <input
                type="text"
                value={displayName()}
                maxLength={120}
                autocomplete="off"
                onInput={(e) => setDisplayName(e.currentTarget.value)}
                disabled={disabled()}
                class={inputClass}
              />
            </label>

            <label class="flex flex-col gap-1.5">
              <span class={labelClass}>Invite link</span>
              <input
                type="text"
                value={slug()}
                maxLength={80}
                autocomplete="off"
                onInput={(e) => setSlug(e.currentTarget.value)}
                disabled={disabled()}
                class={inputClass}
              />
              <Show when={slug().trim().toLowerCase() !== savedSlug()}>
                <span class="font-body text-error text-[0.75rem] leading-snug">
                  Changing the link breaks any invite links you&apos;ve already shared — guests will
                  need the new address.
                </span>
              </Show>
            </label>

            <label class="flex flex-col gap-1.5">
              <span class={labelClass}>Wedding date</span>
              <input
                type="date"
                value={weddingDate()}
                onInput={(e) => setWeddingDate(e.currentTarget.value)}
                disabled={disabled()}
                class={inputClass}
              />
              <span class={hintClass}>
                Leave this empty if you haven&apos;t set a date yet — you can add it any time.
              </span>
            </label>

            <label class="flex flex-col gap-1.5">
              <span class={labelClass}>Expected guests</span>
              <input
                type="number"
                min="1"
                max="10000"
                step="1"
                value={guestCount()}
                onInput={(e) => setGuestCount(e.currentTarget.value)}
                disabled={disabled()}
                class={inputClass}
              />
            </label>
          </div>

          <fieldset class="border-border m-0 flex flex-col gap-4 rounded-sm border p-4">
            <legend class={`${labelClass} px-1`}>Location</legend>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label class="flex flex-1 flex-col gap-1.5">
                <span class={labelClass}>Where are you celebrating?</span>
                <input
                  type="text"
                  value={locationName()}
                  maxLength={200}
                  placeholder="e.g. Bendooley Estate, Berrima NSW"
                  autocomplete="off"
                  onInput={(e) => setLocationName(e.currentTarget.value)}
                  disabled={disabled()}
                  class={inputClass}
                />
              </label>
              <Show when={geocodingAvailable() && !readOnly()}>
                <button
                  type="button"
                  onClick={() => void lookUpLocation()}
                  disabled={disabled() || lookupBusy() || locationName().trim() === ""}
                  class="border-border font-body text-text hover:border-gold hover:text-gold rounded-sm border px-4 py-2 text-[0.82rem] tracking-[0.1em] uppercase transition disabled:opacity-40"
                >
                  {lookupBusy() ? "Looking up…" : "Look up"}
                </button>
              </Show>
            </div>
            <Show when={lookupNote()}>{(note) => <p class={hintClass}>{note()}</p>}</Show>

            <div class="grid gap-4 sm:grid-cols-3">
              <label class="flex flex-col gap-1.5">
                <span class={labelClass}>Latitude</span>
                <input
                  type="text"
                  inputmode="decimal"
                  value={lat()}
                  autocomplete="off"
                  onInput={(e) => setLat(e.currentTarget.value)}
                  disabled={disabled()}
                  class={inputClass}
                />
              </label>
              <label class="flex flex-col gap-1.5">
                <span class={labelClass}>Longitude</span>
                <input
                  type="text"
                  inputmode="decimal"
                  value={lng()}
                  autocomplete="off"
                  onInput={(e) => setLng(e.currentTarget.value)}
                  disabled={disabled()}
                  class={inputClass}
                />
              </label>
              <label class="flex flex-col gap-1.5">
                <span class={labelClass}>Region</span>
                <select
                  value={pricingRegion()}
                  onChange={(e) => setPricingRegion(e.currentTarget.value)}
                  disabled={disabled()}
                  class={inputClass}
                >
                  <For each={REGION_OPTIONS}>
                    {(option) => <option value={option.value}>{option.label}</option>}
                  </For>
                </select>
              </label>
            </div>
            <p class={hintClass}>
              {geocodingAvailable()
                ? "Look up fills the coordinates and region for you; adjust them here if the match is off."
                : "Enter the venue's coordinates and pick a region — they power vendor search and price estimates."}
            </p>
          </fieldset>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class={labelClass}>Currency</span>
              <input
                type="text"
                value={currency()}
                maxLength={3}
                autocomplete="off"
                placeholder="AUD"
                onInput={(e) => setCurrency(e.currentTarget.value.toUpperCase())}
                disabled={disabled()}
                class={inputClass}
              />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class={labelClass}>Total budget ({currency() || "AUD"})</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={budget()}
                onInput={(e) => setBudget(e.currentTarget.value)}
                disabled={disabled()}
                class={inputClass}
              />
            </label>
          </div>

          <Show when={!readOnly()}>
            <button
              type="submit"
              disabled={saving()}
              class="border-gold bg-gold font-body text-bg hover:bg-gold-dim self-start rounded-sm border px-4 py-2 text-[0.82rem] tracking-[0.1em] uppercase transition disabled:opacity-40"
            >
              {saving() ? "Saving…" : "Save settings"}
            </button>
          </Show>
        </form>
      </Show>
    </div>
  );
}
