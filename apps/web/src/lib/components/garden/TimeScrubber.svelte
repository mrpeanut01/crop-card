<script lang="ts">
  import { ONE_DAY_MS, shortDate } from '$lib/garden/occupancy';
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
    /** Shown after the date so it's clear which season is on screen. */
    seasonYear?: number;
    /** False when today falls outside the range, so the Today chip would
     *  only jump to the range's edge; it then jumps to the last frost. */
    todayInRange?: boolean;
  }

  const {
    range,
    value,
    changeDays,
    lastSpringFrostMs,
    firstFallFrostMs,
    wholeSeason,
    onchange,
    onwholeseason,
    seasonYear,
    todayInRange = true
  }: Props = $props();

  let menuOpen = $state(false);

  const span = $derived(Math.max(ONE_DAY_MS, range.endMs - range.startMs));
  const year = $derived(new Date(value).getUTCFullYear());
  const dateLabel = $derived(
    seasonYear !== undefined ? `${longDate(value)}, ${year}` : longDate(value)
  );
  const ticks = $derived.by<Tick[]>(() => {
    const out: Tick[] = [];
    for (const ms of changeDays) {
      if (ms >= range.startMs && ms <= range.endMs)
        out.push({ ms, kind: 'change', label: 'A bed changes' });
    }
    return out;
  });
  const frostMarks = $derived(
    (
      [
        [lastSpringFrostMs, 'Last frost'],
        [firstFallFrostMs, 'First frost']
      ] as const
    )
      .filter(([ms]) => ms >= range.startMs && ms <= range.endMs)
      .map(([ms, label]) => ({ ms, label }))
  );
  const months = $derived.by(() => {
    const out: Array<{ ms: number; label: string }> = [];
    const start = new Date(range.startMs);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    for (;;) {
      const ms = Date.UTC(y, m, 1);
      if (ms > range.endMs) break;
      if (ms >= range.startMs) out.push({ ms, label: 'JFMAMJJASOND'[m] });
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  });
  const stops = $derived(
    [...new Set([range.startMs, ...changeDays, lastSpringFrostMs, firstFallFrostMs, range.endMs])]
      .filter((d) => d >= range.startMs && d <= range.endMs)
      .sort((a, b) => a - b)
  );
  const todayTarget = $derived(
    todayInRange ? range.todayMs : Math.min(range.endMs, Math.max(range.startMs, lastSpringFrostMs))
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

<div class="scrubber" data-testid="time-scrubber" data-hint-anchor="designer_scrubber">
  <div class="row">
    <label for="designer-scrubber" class="label">
      <span class="on">On </span><strong>{dateLabel}</strong>
    </label>
    <button
      type="button"
      class="chip more"
      aria-expanded={menuOpen}
      aria-controls="scrubber-controls"
      onclick={() => (menuOpen = !menuOpen)}>Options</button
    >
    <div class="controls" class:open={menuOpen} id="scrubber-controls">
      <button
        type="button"
        class="chip"
        onclick={() => {
          onchange(todayTarget);
          menuOpen = false;
        }}
        disabled={value === todayTarget}
        title={todayInRange ? undefined : 'Today is outside this season'}
        >{todayInRange ? 'Today' : 'Last frost'}</button
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
      {#each frostMarks as f (f.label)}
        <span class="tick frost" style:left="{pct(f.ms)}%"></span>
      {/each}
    </div>
    <div class="scale months" aria-hidden="true">
      {#each months as m (m.ms)}
        <span class="month" style:left="{pct(m.ms)}%">{m.label}</span>
      {/each}
    </div>
    <div class="scale frosts" aria-hidden="true">
      {#each frostMarks as f (f.label)}
        <span class="frost-label" style:left="{pct(f.ms)}%">{f.label} {shortDate(f.ms)}</span>
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
    position: relative;
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
  .more {
    display: none;
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
    padding-bottom: 38px;
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
  .ticks,
  .scale {
    position: absolute;
    left: 10px;
    right: 10px;
  }
  .ticks {
    bottom: 28px;
    height: 10px;
  }
  .scale {
    overflow: hidden;
    height: 14px;
    font-size: 11px;
    line-height: 14px;
    color: var(--color-ink-soft);
  }
  .months {
    bottom: 14px;
  }
  .frosts {
    bottom: 0;
  }
  .month {
    position: absolute;
    transform: translateX(-50%);
  }
  .frost-label {
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
    font-weight: 600;
    color: var(--color-sky, var(--color-ink-soft));
    pointer-events: none;
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
  @media (max-width: 639px) {
    .scrubber {
      padding: var(--space-1) 0;
    }
    .row {
      flex-wrap: nowrap;
    }
    .label {
      font-size: var(--font-size-meta, 14px);
    }
    .on {
      display: none;
    }
    .more {
      display: inline-flex;
    }
    .controls {
      display: none;
      position: absolute;
      right: 0;
      top: calc(100% + 4px);
      z-index: 6;
      padding: var(--space-2);
      background: var(--color-paper);
      border: 1px solid var(--color-divider);
      border-radius: var(--radius-input);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
    }
    .controls.open {
      display: flex;
    }
  }
</style>
