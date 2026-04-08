import { onCleanup, onMount, Show } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import L from "leaflet";
// Leaflet CSS is required for the tile layer + control positioning to render
// correctly. We import it directly into the component that uses it so it
// only ships when the map is actually rendered.
import "leaflet/dist/leaflet.css";

/**
 * Read-only map preview for the event detail page. Uses Leaflet + OSM tiles
 * (no API key required, no third-party JS bundle requirements).
 *
 * Falls back to a text "location" card when coordinates are missing.
 */
export function MapPreview(props: {
  latitude: number | null;
  longitude: number | null;
  label?: string | null;
}) {
  let mapEl: HTMLDivElement | undefined;
  let map: L.Map | undefined;

  onMount(() => {
    if (!mapEl || props.latitude == null || props.longitude == null) return;
    map = L.map(mapEl, {
      center: [props.latitude, props.longitude],
      zoom: 15,
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
      dragging: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    L.marker([props.latitude, props.longitude]).addTo(map);
  });

  onCleanup(() => {
    map?.remove();
  });

  async function findDirections() {
    if (props.latitude == null || props.longitude == null) return;
    // Use an `apple.com/maps` URL — on iOS it hands off to Apple Maps,
    // and on other platforms it redirects to the web viewer. Safer than
    // `maps://` which can silently fail on non-Apple web targets.
    const url = `https://maps.apple.com/?daddr=${encodeURIComponent(
      `${props.latitude},${props.longitude}`,
    )}`;
    try {
      await openUrl(url);
    } catch {
      // On non-Tauri web targets `openUrl` is unavailable — fall back to
      // a regular anchor navigation.
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <Show
      when={props.latitude != null && props.longitude != null}
      fallback={
        <Show when={props.label}>
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-sm font-medium text-foreground">Location</p>
            <p class="text-sm text-muted-foreground">{props.label}</p>
          </div>
        </Show>
      }
    >
      <div class="rounded-xl border border-border bg-card overflow-hidden">
        <div ref={mapEl} class="w-full h-48" />
        <div class="p-3 flex items-center justify-between gap-3">
          <Show when={props.label}>
            <p class="text-xs text-muted-foreground truncate">{props.label}</p>
          </Show>
          <button
            type="button"
            onClick={findDirections}
            class="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Find directions
          </button>
        </div>
      </div>
    </Show>
  );
}
