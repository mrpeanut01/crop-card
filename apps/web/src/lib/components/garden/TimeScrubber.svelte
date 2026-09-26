<script lang="ts">
  import { ONE_DAY_MS } from '$lib/garden/occupancy';
  import type { ScrubRange } from '$lib/garden/types';
  import { longDate } from './format';

  interface Tick {
    ms: number;
    kind: 'frost' | 'change';
    label: string;
  }

  interface Props {
    range: ScrubRange;
    value: number;
    changeDays: readonly number[];
    lastSpringFrostMs: number;
    firstFallFrostMs: number;
    wholeSeason: boolean;
    onchange: (ms: number) => void;
    onwholeseason: (on: boolean) => void;
  }

  const {
    range,
    value,
    changeDays,
    lastSpringFrostMs,
    firstFallFrostMs,
    wholeSeason,
    onchange,
    onwholeseason
  }: Props = $props();

  const span = $derived(Math.max(ONE_DAY_MS, range.endMs - range.startMs));
  const ticks = $derived.by<Tick[]>(() => {
    const out: Tick[] = [];
    for (const [ms, label] of [
      [lastSpringFrostMs, 'Last spring frost'],
      [firstFallFrostMs, 'First fall frost']
    ] as const) {
      if (ms >= range.startMs && ms <= range.endMs) out.push({ ms, kind: 'frost', label });
    }
    for (const ms of changeDays) {
      if (ms >= range.startMs && ms <= range.endMs)
        out.push({ ms, kind: 'change', label: 'A bed changes' });
    }
    return out;
  });
  const stops = $derived(
    [...new Set([range.startMs, ...changeDays, lastSpringFrostMs, firstFallFrostMs, range.endMs])]
      .filter((d) => d >= range.startMs && d <= range.endMs)
      .sort((a, b) => a - b)
  );

  function pct(ms: number): number {
    return ((ms - range.startMs) / span) * 100;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const next =
        e.key === 'PageDown'
          ? stops.find((d) => d > value)
          : [...stops].reverse().find((d) => d < value);
      if (next !== undefined) onchange(next);
    }
  }
</script>

<div class="scrubber" data-testid="time-scrubber">
  <div class="row">
    <label for="designer-scrubber" class="label">
      On <strong>{longDate(value)}</strong>
    </label>
    <div class="controls">
      <button
        type="button"
        class="chip"
        onclick={() => onchange(range.todayMs)}
        disabled={value === range.todayMs}>Today</button
      >
      <label class="whole">
        <input
          type="checkbox"
          checked={wholeSeason}
          onchange={(e) => onwholeseason((e.currentTarget as HTMLInputElement).checked)}
        />
        Whole season
      </label>
    </div>
  </div>
  <div class="track">
    <input
      id="designer-scrubber"
      type="range"
      min={range.startMs}
      max={range.endMs}
      step={ONE_DAY_MS}
      {value}
      aria-valuetext={longDate(value)}
      oninput={(e) => onchange(Number((e.currentTarget as HTMLInputElement).value))}
      onkeydown={onKey}
    />
    <div class="ticks" aria-hidden="true">
      {#each ticks as t (`${t.kind}-${t.ms}`)}
        <span class="tick {t.kind}" style:left="{pct(t.ms)}%" title={t.label}></span>
      {/each}
    </div>
  </div>
</div>

<style>
  .scrubber {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .label {
    font-size: var(--font-size-body);
    color: var(--color-ink);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .chip,
  .whole {
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
  }
  .whole input {
    width: 20px;
    height: 20px;
  }
  .chip:disabled {
    opacity: 0.6;
  }
  .track {
    position: relative;
    padding-bottom: 10px;
  }
  input[type='range'] {
    width: 100%;
    min-height: 48px;
    margin: 0;
    accent-color: var(--color-forest);
  }
  input[type='range']:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-input);
  }
  .ticks {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 0;
    height: 10px;
  }
  .tick {
    position: absolute;
    bottom: 0;
    width: 2px;
    height: 8px;
    background: var(--color-ink-soft);
    transform: translateX(-1px);
  }
  .tick.frost {
    height: 10px;
    background: var(--color-sky);
  }
</style>
