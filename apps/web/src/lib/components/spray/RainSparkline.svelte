<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { DailyTotal, WeatherProvenance } from '$lib/weather/leafWet';

  interface Props {
    rain: DailyTotal[];
    leafWet?: DailyTotal[];
    provenance: WeatherProvenance;
  }

  const { rain, leafWet = [], provenance }: Props = $props();

  const W = 260;
  const H = 72;
  const GAP = 8;
  const MM_PER_IN = 25.4;

  const wetByDate = $derived(new Map(leafWet.map((d) => [d.date, d.value])));
  const max = $derived(Math.max(1, ...rain.map((d) => d.value)));
  const barW = $derived(rain.length > 0 ? (W - GAP * (rain.length - 1)) / rain.length : 0);
  const totalMm = $derived(rain.reduce((a, d) => a + d.value, 0));

  const rainText = (mm: number) => fmt.qty(mm / MM_PER_IN, 'precip');

  function dayLabel(date: string): string {
    return fmt.day(date, 'weekday');
  }

  const summary = $derived(
    rain.length === 0
      ? 'Five-day rain forecast unavailable.'
      : `Five-day rain forecast: ${rain.map((d) => `${dayLabel(d.date)} ${rainText(d.value)}`).join(', ')}.`
  );
</script>

<div class="rain" data-testid="rain-sparkline">
  <div class="head">
    <span class="kicker">5-day rain</span>
    <Provenance
      source={provenance}
      detail={provenance === 'data' ? 'NWS QPF' : 'weather unavailable'}
      compact
    />
    {#if rain.length > 0}<span class="total mono">{rainText(totalMm)} total</span>{/if}
  </div>
  {#if rain.length === 0}
    <p class="empty">Weather unavailable — check conditions yourself.</p>
  {:else}
    <svg viewBox="0 0 {W} {H + 42}" role="img" aria-label={summary}>
      {#each rain as d, i (d.date)}
        {@const h = d.value === 0 ? 3 : Math.max(6, (d.value / max) * H)}
        <rect
          x={i * (barW + GAP)}
          y={H - h}
          width={barW}
          height={h}
          rx="3"
          fill={d.value > 0 ? 'var(--pill-sky-fg)' : 'var(--color-divider)'}
        />
        <text x={i * (barW + GAP) + barW / 2} y={H + 13} text-anchor="middle" class="val">
          {rainText(d.value)}
        </text>
        <text x={i * (barW + GAP) + barW / 2} y={H + 26} text-anchor="middle" class="day">
          {dayLabel(d.date)}
        </text>
        {#if wetByDate.has(d.date)}
          <text x={i * (barW + GAP) + barW / 2} y={H + 39} text-anchor="middle" class="wet">
            {wetByDate.get(d.date)}h wet
          </text>
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .rain {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .kicker {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-soft);
  }
  .total {
    margin-left: auto;
    font-size: 0.8rem;
    color: var(--color-ink-soft);
  }
  svg {
    width: 100%;
    max-width: 420px;
    height: auto;
  }
  .val {
    font-size: 10px;
    font-weight: 700;
    fill: var(--color-ink);
  }
  .day {
    font-size: 10px;
    fill: var(--color-ink-soft);
  }
  .wet {
    font-size: 9px;
    fill: var(--pill-sky-fg);
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .mono {
    font-family: var(--font-mono, monospace);
  }
</style>
