<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { WeatherProvenance, WindowCount } from '$lib/weather/leafWet';

  interface Props {
    past: WindowCount;
    next: WindowCount;
    threshold: number;
    provenance: WeatherProvenance;
  }

  const { past, next, threshold, provenance }: Props = $props();

  const SIZE = 132;
  const STROKE = 12;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;

  const available = $derived(provenance === 'data' && next.coveredHours > 0);
  const frac = $derived(available ? Math.min(1, next.wetHours / 24) : 0);
  const favorable = $derived(available && next.wetHours >= threshold);
  const thresholdAngle = $derived((Math.min(threshold, 24) / 24) * 2 * Math.PI - Math.PI / 2);
  const tick = $derived({
    x1: SIZE / 2 + (R - STROKE) * Math.cos(thresholdAngle),
    y1: SIZE / 2 + (R - STROKE) * Math.sin(thresholdAngle),
    x2: SIZE / 2 + (R + STROKE / 2 + 2) * Math.cos(thresholdAngle),
    y2: SIZE / 2 + (R + STROKE / 2 + 2) * Math.sin(thresholdAngle)
  });
  const label = $derived(
    available
      ? `Leaf-wet hours: ${next.wetHours} of the next ${next.coveredHours} forecast hours; threshold ${threshold} hours${favorable ? ', infection-favorable' : ''}.`
      : 'Leaf-wet hours unavailable — no forecast data.'
  );
</script>

<div class="leaf-wet" data-testid="leaf-wet-dial">
  <div class="head">
    <span class="kicker">Leaf-wet hours</span>
    <Provenance
      source={provenance}
      detail={provenance === 'data' ? 'NWS gridpoint · RH ≥ 90% proxy' : 'weather unavailable'}
      compact
    />
  </div>
  <div class="body">
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 {SIZE} {SIZE}"
      role="img"
      aria-label={label}
      data-testid="leaf-wet-svg"
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke="var(--color-divider-soft)"
        stroke-width={STROKE}
      />
      {#if available}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={favorable ? 'var(--pill-sky-fg)' : 'var(--color-sky)'}
          stroke-width={STROKE}
          stroke-dasharray="{C * frac} {C}"
          transform="rotate(-90 {SIZE / 2} {SIZE / 2})"
          stroke-linecap="butt"
        />
      {/if}
      <line {...tick} stroke="var(--color-ink)" stroke-width="2" />
      <text
        x={SIZE / 2}
        y={SIZE / 2 + 4}
        text-anchor="middle"
        class="big"
        fill={available ? 'var(--pill-sky-fg)' : 'var(--color-ink-muted)'}
      >
        {available ? next.wetHours : '—'}
      </text>
      <text x={SIZE / 2} y={SIZE / 2 + 24} text-anchor="middle" class="unit">hrs · next 24h</text>
    </svg>
    <div class="facts">
      {#if available}
        <p class="status" class:favorable>
          {favorable ? 'Infection-favorable wetness ahead' : 'Below wetness threshold'}
        </p>
        <p>Threshold <strong class="mono">≥{threshold} h</strong> (generic foliar-fungus guide)</p>
        <p>
          Last 24h:
          {#if past.coveredHours > 0}
            <strong class="mono">{past.wetHours} h</strong>
            {#if past.coveredHours < 24}<span class="muted">({past.coveredHours} h of data)</span
              >{/if}
          {:else}
            <span class="muted">not in forecast feed</span>
          {/if}
        </p>
      {:else}
        <p class="status">Weather unavailable — check conditions yourself.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .leaf-wet {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .kicker {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-soft);
  }
  .body {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  svg {
    flex-shrink: 0;
  }
  .big {
    font-family: var(--font-serif, serif);
    font-size: 36px;
    font-weight: 600;
  }
  .unit {
    font-size: 11px;
    fill: var(--color-ink-soft);
  }
  .facts {
    flex: 1;
    min-width: 160px;
  }
  .facts p {
    margin: 0 0 4px;
    font-size: 0.9rem;
    color: var(--color-ink-soft);
  }
  .status {
    font-weight: 600;
    color: var(--color-ink) !important;
  }
  .status.favorable {
    color: var(--pill-sky-fg) !important;
  }
  .muted {
    color: var(--color-ink-muted);
  }
  .mono {
    font-family: var(--font-mono, monospace);
    color: var(--color-ink);
  }
</style>
