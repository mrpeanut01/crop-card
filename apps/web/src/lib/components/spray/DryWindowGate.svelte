<script lang="ts">
  import Pill from '$lib/components/ui/Pill.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { DryWindow, RainfastCheck, WeatherProvenance } from '$lib/weather/leafWet';

  interface Props {
    rainfast: RainfastCheck;
    dryWindow: DryWindow | null;
    provenance: WeatherProvenance;
    /** True when the rainfast interval came from a product label; false = 4h default. */
    rainfastFromLabel: boolean;
    acknowledged: boolean;
  }

  let {
    rainfast,
    dryWindow,
    provenance,
    rainfastFromLabel,
    acknowledged = $bindable(false)
  }: Props = $props();

  const status = $derived<'clear' | 'rain-risk' | 'unknown'>(
    provenance === 'fallback' ? 'unknown' : rainfast.status
  );

  function fmt(ms: number): string {
    return new Date(ms).toLocaleString('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
</script>

<div class="tile {status}" data-testid="dry-window-gate" data-state={status}>
  <div class="head">
    <span class="title">Rain/dew dry window</span>
    {#if status === 'clear'}
      <Pill tone="forest">Dry window OK</Pill>
    {:else if status === 'rain-risk'}
      <Pill tone="wheat">Rain in rainfast window</Pill>
    {:else}
      <Pill tone="neutral">Unknown</Pill>
    {/if}
    <span class="advisory">Advisory</span>
  </div>

  <p class="need">
    Needs <strong class="mono">{rainfast.rainfastHours} h</strong> dry after application
    {#if rainfastFromLabel}
      <Provenance source="plugin" detail="label rainfast interval" compact />
    {:else}
      <span class="muted">(default — label rainfast interval not on file)</span>
    {/if}
  </p>

  {#if status === 'unknown'}
    <p class="msg" role="status">
      {#if provenance === 'fallback'}
        Weather unavailable — check conditions yourself.
      {:else}
        Forecast covers only {rainfast.coveredHours} of the next {rainfast.rainfastHours} h — check conditions
        yourself.
      {/if}
    </p>
  {:else if status === 'clear'}
    <p class="msg">
      No rain forecast in the next {rainfast.rainfastHours} h (max PoP {rainfast.maxPopPct ?? 0}%).
      <Provenance source="data" detail="NWS gridpoint forecast" compact />
    </p>
  {:else}
    <p class="msg" role="alert">
      Rain forecast {rainfast.firstRiskMs ? `from ${fmt(rainfast.firstRiskMs)}` : ''} (max PoP {rainfast.maxPopPct ??
        0}%, {rainfast.totalPrecipMm} mm) could wash product off before it is rainfast.
      <Provenance source="data" detail="NWS gridpoint forecast" compact />
    </p>
    <p class="msg">
      {#if dryWindow}
        Next dry window: <strong>{fmt(dryWindow.startMs)} – {fmt(dryWindow.endMs)}</strong>.
      {:else}
        No {rainfast.rainfastHours}-hour dry window in the next 3 days of forecast.
      {/if}
    </p>
    <label class="ack">
      <input type="checkbox" bind:checked={acknowledged} data-testid="dry-window-ack" />
      <span>I've checked the forecast and still want to record this application.</span>
    </label>
  {/if}
</div>

<style>
  .tile {
    border: 1px solid var(--pill-neutral-bd);
    background: var(--color-paper, #fff);
    border-radius: 6px;
    padding: 12px 14px;
  }
  .tile.clear {
    background: #eff6e9;
    border-color: var(--pill-forest-bd);
  }
  .tile.rain-risk {
    background: #fbf1dc;
    border-color: var(--pill-wheat-bd);
    border-left: 4px solid var(--color-wheat);
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 6px;
  }
  .title {
    font-family: var(--font-serif, serif);
    font-size: 1.05rem;
    color: var(--color-forest-deep);
  }
  .advisory {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--color-ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .need,
  .msg {
    margin: 0 0 6px;
    font-size: 0.9rem;
    color: var(--color-ink);
    line-height: 1.45;
  }
  .muted {
    color: var(--color-ink-soft);
  }
  .mono {
    font-family: var(--font-mono, monospace);
  }
  .ack {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    margin-top: 6px;
    padding: 6px 10px;
    border: 1px solid var(--pill-wheat-bd);
    border-radius: 6px;
    background: var(--color-paper, #fff);
    cursor: pointer;
    font-weight: 500;
    color: var(--color-ink);
  }
  .ack input {
    width: 24px;
    height: 24px;
    min-height: 0;
    margin: 0;
    flex-shrink: 0;
    accent-color: var(--color-forest);
  }
</style>
