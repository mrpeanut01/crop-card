<script lang="ts">
  import { untrack } from 'svelte';
  import { Crosshair } from 'lucide-svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

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

  const tr = $derived(createT(page.data?.locale));
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
      source = lat != null && lon != null ? tr('farm.loc.saved') : null;
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
      geoError = tr('farm.loc.noGeo');
      return;
    }
    geoBusy = true;
    geoError = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft(pos.coords.latitude, pos.coords.longitude, tr('farm.loc.gps'));
        geoBusy = false;
      },
      (err) => {
        geoBusy = false;
        geoError =
          err.code === err.PERMISSION_DENIED ? tr('farm.loc.denied') : tr('farm.loc.failed');
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

<Modal {open} {onClose} title={tr('farm.loc.title')}>
  <div class="body">
    <p class="lede">{tr('farm.loc.lede')}</p>
    <Button variant="ghost" size="sm" loading={geoBusy} onclick={useGps} data-testid="gps-locate">
      {#snippet iconLeft()}<Crosshair size={14} />{/snippet}
      {geoBusy ? tr('farm.loc.finding') : tr('farm.loc.useGps')}
    </Button>
    {#if geoError}
      <p class="error" role="alert">{geoError}</p>
    {/if}
    {#if open}
      {#await import('$lib/components/onboarding/LocationPicker.svelte')}
        <div class="map-loading">{tr('farm.loc.loadingMap')}</div>
      {:then { default: LocationPicker }}
        <LocationPicker
          lat={draftLat}
          lon={draftLon}
          {fallback}
          onPick={(la, lo) => setDraft(la, lo, tr('farm.loc.pin'))}
        />
      {:catch}
        <div class="map-loading">{tr('farm.loc.mapFailed')}</div>
      {/await}
    {/if}
    <p class="picked mono" role="status" data-testid="gps-picked">
      {#if draftLat != null && draftLon != null}
        {source ? `${source} · ` : ''}{draftLat.toFixed(4)}, {draftLon.toFixed(4)}
      {:else}
        {tr('farm.loc.none')}
      {/if}
    </p>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={onClose}>{tr('farm.cancel')}</Button>
    <Button onclick={apply} disabled={draftLat == null || draftLon == null} data-testid="gps-apply"
      >{tr('farm.loc.use')}</Button
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
