<script lang="ts">
  import { untrack } from 'svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import {
    farmZoneFrom,
    lookupZone,
    zoneEstimateLong,
    zoneReachNote,
    zoneSourceDetail,
    zoneValueLabel,
    ZONE_NEAR_MAX_MI,
    ZONE_WIDE_MAX_MI,
    type ZoneLookup
  } from '$lib/climate/zone';

  interface Props {
    lat: number | null;
    lon: number | null;
    /** The owner's saved zone, when they typed one. */
    manualZone: string | null;
    /** Render the override input (settings only). */
    editable?: boolean;
  }

  const { lat, lon, manualZone, editable = false }: Props = $props();

  let lookup = $state<ZoneLookup | null>(null);
  let elevationKnown = $state(false);
  let loaded = $state(false);
  let typed = $state(untrack(() => manualZone ?? ''));
  let seq = 0;

  async function elevationAt(la: number | null, lo: number | null): Promise<number | null> {
    if (la == null || lo == null) return null;
    try {
      const res = await fetch(`/api/climate/elevation?lat=${la}&lon=${lo}`);
      if (!res.ok) return null;
      const body = (await res.json()) as { elevationFt?: unknown };
      return typeof body.elevationFt === 'number' ? body.elevationFt : null;
    } catch {
      return null;
    }
  }

  $effect(() => {
    const la = lat;
    const lo = lon;
    const mine = ++seq;
    const t = setTimeout(async () => {
      const elevationFt = await elevationAt(la, lo);
      const result = await lookupZone(la, lo, { elevationFt });
      if (mine !== seq) return;
      lookup = result;
      elevationKnown = elevationFt !== null;
      loaded = true;
    }, 250);
    return () => clearTimeout(t);
  });

  const estimate = $derived(farmZoneFrom(null, lookup));
  const shown = $derived(farmZoneFrom(manualZone, lookup));
</script>

<div class="zone" data-testid="zone-chip">
  <div class="line">
    <span class="lbl">Hardiness zone</span>
    {#if shown}
      <span class="serif value" data-testid="zone-value">{zoneValueLabel(shown)}</span>
      {#if zoneReachNote(shown)}
        <span class="reach" data-testid="zone-reach">· {zoneReachNote(shown)}</span>
      {/if}
      <Provenance
        source={shown.provenance}
        detail={zoneSourceDetail(shown)}
        label={shown.provenance === 'data' ? 'Weather service' : undefined}
        long={zoneEstimateLong(shown)}
      />
    {:else if lat == null || lon == null}
      <span class="muted">Set the location to estimate it.</span>
    {:else if loaded}
      <span class="muted" data-testid="zone-none"
        >{elevationKnown
          ? `No station with enough winters within ${ZONE_WIDE_MAX_MI} mi at a similar elevation.`
          : `No station with enough winters within ${ZONE_NEAR_MAX_MI} mi.`}</span
      >
    {:else}
      <span class="muted">Looking it up…</span>
    {/if}
  </div>
  {#if estimate && estimate.extremeMinF !== null}
    <p class="muted small">
      {shown?.provenance === 'manual'
        ? 'Station estimate: zone ' + estimate.zone + '. '
        : ''}Average coldest night of the year, 1991-2020: {fmt.qty(
        estimate.extremeMinF,
        'temperature'
      )}. {estimate.reach === 'wide'
        ? 'A rougher estimate from one farther station at a similar elevation'
        : 'An estimate from one station'}, not the USDA map. Nothing in CropCard is limited by it.
    </p>
  {/if}
  {#if editable}
    <label class="row">
      <span class="lbl">Your zone (optional)</span>
      <input
        name="hardinessZone"
        type="text"
        inputmode="text"
        autocomplete="off"
        placeholder={estimate ? estimate.zone : 'e.g. 7a'}
        maxlength="8"
        bind:value={typed}
        data-testid="zone-input"
      />
      <span class="muted small">Leave blank to use the estimate.</span>
    </label>
  {/if}
</div>

<style>
  .zone {
    display: grid;
    gap: 8px;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .lbl {
    font-weight: 600;
    font-size: 13.5px;
  }
  .value {
    font-size: 18px;
  }
  .reach {
    font-size: 13.5px;
    color: var(--color-ink-soft);
  }
  .muted {
    margin: 0;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .small {
    font-size: 12.5px;
  }
  .row {
    display: grid;
    gap: 6px;
    max-width: 260px;
  }
  .row input {
    font: inherit;
    padding: 0 12px;
    min-height: 48px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    min-width: 0;
  }
</style>
