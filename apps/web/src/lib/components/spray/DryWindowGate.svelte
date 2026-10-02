<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
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

  const tr = $derived(createT(page.data?.locale));

  const status = $derived<'clear' | 'rain-risk' | 'unknown'>(
    provenance === 'fallback' ? 'unknown' : rainfast.status
  );

  function when(ms: number): string {
    return fmt.instant(ms, 'weekday', { hour: 'numeric', minute: '2-digit' });
  }
</script>

<div class="tile {status}" data-testid="dry-window-gate" data-state={status}>
  <div class="head">
    <span class="title">{tr('sprayui.dry.title')}</span>
    {#if status === 'clear'}
      <Pill tone="forest">{tr('sprayui.dry.ok')}</Pill>
    {:else if status === 'rain-risk'}
      <Pill tone="wheat">{tr('sprayui.dry.risk')}</Pill>
    {:else}
      <Pill tone="neutral">{tr('sprayui.dry.unknown')}</Pill>
    {/if}
    <span class="advisory">{tr('sprayui.dry.advisory')}</span>
  </div>

  <p class="need">
    {tr('sprayui.dry.needs')} <strong class="mono">{rainfast.rainfastHours} h</strong>
    {tr('sprayui.dry.needsAfter')}
    {#if rainfastFromLabel}
      <Provenance source="plugin" detail={tr('sprayui.dry.labelInterval')} compact />
    {:else}
      <span class="muted">{tr('sprayui.dry.defaultInterval')}</span>
    {/if}
  </p>

  {#if status === 'unknown'}
    <p class="msg" role="status">
      {#if provenance === 'fallback'}
        {tr('sprayui.weatherUnavailable')}
      {:else}
        {tr('sprayui.dry.partial', {
          covered: rainfast.coveredHours,
          hours: rainfast.rainfastHours
        })}
      {/if}
    </p>
  {:else if status === 'clear'}
    <p class="msg">
      {tr('sprayui.dry.noRain', { hours: rainfast.rainfastHours, pop: rainfast.maxPopPct ?? 0 })}
      <Provenance source="data" detail={tr('sprayui.nwsGridpoint')} compact />
    </p>
  {:else}
    <p class="msg" role="alert">
      Rain forecast {rainfast.firstRiskMs ? `from ${when(rainfast.firstRiskMs)}` : ''} (max PoP {rainfast.maxPopPct ??
        0}%, {fmt.qty(rainfast.totalPrecipMm / 25.4, 'precip')}) could wash product off before it is
      rainfast.
      <Provenance source="data" detail={tr('sprayui.nwsGridpoint')} compact />
    </p>
    <p class="msg">
      {#if dryWindow}
        {tr('sprayui.dry.nextWindow')}
        <strong>{when(dryWindow.startMs)} – {when(dryWindow.endMs)}</strong>.
      {:else}
        {tr('sprayui.dry.noWindow', { hours: rainfast.rainfastHours })}
      {/if}
    </p>
    <label class="ack">
      <input type="checkbox" bind:checked={acknowledged} data-testid="dry-window-ack" />
      <span>{tr('sprayui.dry.ack')}</span>
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
