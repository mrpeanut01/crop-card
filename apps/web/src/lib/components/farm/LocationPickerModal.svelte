<script lang="ts">
  import { untrack } from 'svelte';
  import { Crosshair } from 'lucide-svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  const {
    open,
    lat,
    lon,
    fallback,
    onClose,
    onApply
  }: {
    open: boolean;
    lat: number | null;
    lon: number | null;
    fallback: { lat: number; lon: number };
    onClose: () => void;
    onApply: (lat: number, lon: number) => void;
  } = $props();

  let draftLat = $state<number | null>(null);
  let draftLon = $state<number | null>(null);
  let source = $state<string | null>(null);
  let geoBusy = $state(false);
  let geoError = $state<string | null>(null);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      draftLat = lat;
      draftLon = lon;
      source = lat != null && lon != null ? 'Saved location' : null;
      geoError = null;
    });
  });

  function setDraft(la: number, lo: number, label: string) {
    draftLat = Number(la.toFixed(5));
    draftLon = Number(lo.toFixed(5));
    source = label;
  }

  function useGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      geoError = "This browser can't share its location. Tap the map instead.";
      return;
    }
    geoBusy = true;
    geoError = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft(pos.coords.latitude, pos.coords.longitude, 'GPS fix');
        geoBusy = false;
      },
      (err) => {
        geoBusy = false;
        geoError =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was declined. Tap the map instead.'
            : "Couldn't get a GPS fix. Tap the map instead.";
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function apply() {
    if (draftLat == null || draftLon == null) return;
    onApply(draftLat, draftLon);
    onClose();
  }
</script>

<Modal {open} {onClose} title="Find your farm on the map">
  <div class="body">
    <p class="lede">Use your phone's GPS, or tap the map where the farm sits.</p>
    <Button variant="ghost" size="sm" loading={geoBusy} onclick={useGps} data-testid="gps-locate">
      {#snippet iconLeft()}<Crosshair size={14} />{/snippet}
      {geoBusy ? 'Finding you…' : 'Use my GPS location'}
    </Button>
    {#if geoError}
      <p class="error" role="alert">{geoError}</p>
    {/if}
    {#if open}
      {#await import('$lib/components/onboarding/LocationPicker.svelte')}
        <div class="map-loading">Loading map…</div>
      {:then { default: LocationPicker }}
        <LocationPicker
          lat={draftLat}
          lon={draftLon}
          {fallback}
          onPick={(la, lo) => setDraft(la, lo, 'Pin on the map')}
        />
      {:catch}
        <div class="map-loading">The map couldn't load. Use GPS or type the coordinates.</div>
      {/await}
    {/if}
    <p class="picked mono" role="status" data-testid="gps-picked">
      {#if draftLat != null && draftLon != null}
        {source ? `${source} · ` : ''}{draftLat.toFixed(4)}, {draftLon.toFixed(4)}
      {:else}
        No location picked yet.
      {/if}
    </p>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={onClose}>Cancel</Button>
    <Button onclick={apply} disabled={draftLat == null || draftLon == null} data-testid="gps-apply"
      >Use this location</Button
    >
  {/snippet}
</Modal>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lede {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13px;
  }
  .error {
    margin: 0;
    color: var(--pill-rust-fg);
    font-size: 13px;
  }
  .picked {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-ink);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .map-loading {
    height: 340px;
    border-radius: 10px;
    border: 1px solid var(--color-divider);
    display: grid;
    place-items: center;
    color: var(--color-ink-muted);
    font-size: 12px;
  }
</style>
