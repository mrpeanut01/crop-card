<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 season-timeline card.
   *
   * 1:1 port of the season-timeline card in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * (lines 220–286). 7-month axis (Apr → Oct) + one Gantt row per
   * planting with windows derived from calendar-engine events.
   *
   * Windows we render (in priority order):
   *   - planting → harvest span (color: planting color)
   *   - harvest window (color: wheat)
   *   - termination event (color: rust)
   *   - season-long bloom for cover crops (color: planting color)
   *
   * "TODAY" pin sits at the current month proportion.
   */
  import Card from '$lib/components/ui/Card.svelte';
  import type { CalendarEvent } from '$lib/calendar/engine';
  import type { PlantingRecord } from '$lib/db/blocks';

  interface Props {
    plantings: PlantingRecord[];
    /** All calendar-engine events for this block, oldest-first. */
    events: CalendarEvent[];
    /** Plain map of pluginId → daysToMaturity for harvest-window guess
     *  when the calendar engine didn't emit an explicit window. */
    daysToMaturityById?: Record<string, number>;
    /** "2026 · Apr → Oct" caption above the axis. Optional override; we
     *  derive from `currentYear` otherwise. */
    yearLabel?: string;
  }
  const { plantings, events, daysToMaturityById = {}, yearLabel }: Props = $props();

  const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function plantingColor(plantingId: string): string {
    const PALETTE = [
      '#7a8f5a',
      '#c9961f',
      '#6f8fa8',
      '#a85a1f',
      '#4a8b54',
      '#a23a3a',
      '#8a6722',
      '#7a3a4d'
    ];
    let h = 0;
    for (let i = 0; i < plantingId.length; i++) h = (h * 31 + plantingId.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // Compute the axis: April 1 → October 31 of the active year.
  function axisBounds(): { startMs: number; endMs: number; year: number } {
    const year = new Date().getFullYear();
    const start = new Date(year, 3, 1, 0, 0, 0).getTime(); // Apr 1
    const end = new Date(year, 9, 31, 23, 59, 59).getTime(); // Oct 31
    return { startMs: start, endMs: end, year };
  }
  const bounds = $derived(axisBounds());
  const todayPct = $derived(
    Math.min(
      100,
      Math.max(0, ((Date.now() - bounds.startMs) / (bounds.endMs - bounds.startMs)) * 100)
    )
  );
  const computedYearLabel = $derived(yearLabel ?? `${bounds.year} · Apr → Oct`);

  type Window = { start: number; end: number; color: string; label: string };
  function windowsFor(p: PlantingRecord): Window[] {
    const out: Window[] = [];
    const color = plantingColor(p.id);
    // Calendar engine windows for this planting/crop combo.
    const ours = events.filter((e) => e.cropPluginId === p.cropPluginId);

    const plantingEv = ours.find((e) => e.kind === 'planting');
    const harvestEv = ours.find((e) => e.kind === 'harvest-window');
    const terminationEv = ours.find((e) => e.kind === 'cover-termination');

    const plantStart = plantingEv?.startMs ?? p.plantingDate ?? bounds.startMs;
    const dtm = daysToMaturityById[p.cropPluginId];
    const harvestStart = harvestEv?.startMs ?? (dtm ? plantStart + dtm * DAY_MS : null);
    const harvestEnd = harvestEv?.endMs ?? (harvestStart ? harvestStart + 14 * DAY_MS : null);

    if (plantStart && harvestStart && harvestStart > plantStart) {
      out.push({ start: plantStart, end: harvestStart, color, label: 'planting → fruit set' });
    }
    if (harvestStart && harvestEnd) {
      out.push({ start: harvestStart, end: harvestEnd, color: '#c9961f', label: 'harvest' });
    }
    if (terminationEv) {
      out.push({
        start: terminationEv.startMs,
        end: terminationEv.endMs,
        color: 'var(--color-rust, #a64a2a)',
        label: 'terminate'
      });
    }
    if (out.length === 0) {
      // Fallback: 14-day stripe around planting date or May 1 default.
      const fallbackStart = p.plantingDate ?? bounds.startMs + 30 * DAY_MS;
      out.push({
        start: fallbackStart,
        end: fallbackStart + 90 * DAY_MS,
        color,
        label: 'season'
      });
    }
    return out;
  }

  function pct(ms: number): number {
    return Math.max(
      0,
      Math.min(100, ((ms - bounds.startMs) / (bounds.endMs - bounds.startMs)) * 100)
    );
  }
  function widthPct(start: number, end: number): number {
    return Math.max(1, pct(end) - pct(start));
  }
</script>

<Card>
  <div class="head">
    <h3 class="serif">
      Season · {plantings.length > 1 ? 'all plantings overlaid' : 'timeline'}
    </h3>
    <div class="cap">{computedYearLabel}</div>
  </div>

  <div class="axis-row">
    <div class="axis-spacer" aria-hidden="true"></div>
    <div class="axis" role="presentation">
      {#each MONTHS as mo, i (mo)}
        <span class="month" style:left="{(i / (MONTHS.length - 1)) * 100}%">{mo}</span>
      {/each}
      <span class="today-pin" style:left="{todayPct}%">TODAY</span>
    </div>
  </div>

  {#each plantings as p, i (p.id)}
    {@const ws = windowsFor(p)}
    <div class="gantt-row" class:first={i === 0}>
      <div class="gantt-label" title={p.varietyDisplayName}>
        <span class="swatch" style:background={plantingColor(p.id)}></span>
        <span class="label-text">{p.varietyDisplayName.split(' ').slice(0, 3).join(' ')}</span>
      </div>
      <div class="gantt-track">
        <div class="today-line" style:left="{todayPct}%"></div>
        {#each ws as w, j (j)}
          <div
            class="window"
            title={w.label}
            style:left="{pct(w.start)}%"
            style:width="{widthPct(w.start, w.end)}%"
            style:background={w.color}
          >
            {w.label}
          </div>
        {/each}
      </div>
    </div>
  {/each}
</Card>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .head h3 {
    margin: 0;
    font-size: 17px;
    color: var(--color-forest-deep);
    font-family: var(--font-serif, serif);
  }
  .cap {
    font-size: 11.5px;
    color: var(--color-ink-muted);
  }
  .axis-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 12px;
    margin-bottom: 6px;
  }
  .axis {
    position: relative;
    height: 18px;
  }
  .month {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 10.5px;
    color: var(--color-ink-muted);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .today-pin {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    background: var(--color-rust);
    color: var(--color-cream);
    font-size: 9.5px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.05em;
    z-index: 2;
  }
  .gantt-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 12px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px dashed var(--color-divider-soft, var(--color-divider));
  }
  .gantt-row.first {
    border-top: none;
  }
  .gantt-label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .label-text {
    font-size: 12px;
    color: var(--color-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .gantt-track {
    position: relative;
    height: 22px;
    background: var(--color-cream);
    border-radius: 4px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    overflow: hidden;
  }
  .today-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    border-left: 2px solid var(--color-rust);
    opacity: 0.5;
    z-index: 0;
    pointer-events: none;
  }
  .window {
    position: absolute;
    top: 2px;
    bottom: 2px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    padding: 0 6px;
    color: white;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    overflow: hidden;
    white-space: nowrap;
    opacity: 0.85;
    z-index: 1;
  }
</style>
