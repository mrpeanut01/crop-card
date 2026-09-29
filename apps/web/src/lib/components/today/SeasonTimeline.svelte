<script lang="ts">
  /**
   * /today Season view: timelines only. A farm-wide growing-season band,
   * then one row per planting with its grow period and jobs, and a Field
   * work row for a block's prep or fallow-block work no planting holds. Recorded work
   * is solid, planned or suggested work is dashed. Tapping a row opens its
   * dates in a sheet.
   */
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { cardHref, cardKey } from '$lib/cards/model';
  import {
    SEASON_SPAN_LABEL,
    type SeasonSpanKind,
    type SeasonTimeline
  } from '$lib/today/seasonTimeline';
  import { fmt } from '$lib/prefsState.svelte';

  interface Props {
    year: number;
    years: number[];
    timeline: SeasonTimeline;
    now: number;
    onSelectYear: (year: number) => void;
    onOpenRow: (index: number) => void;
  }
  const { year, years, timeline, now, onSelectYear, onOpenRow }: Props = $props();

  const DAY_MS = 86_400_000;
  const LEGEND: SeasonSpanKind[] = ['grow', 'plant', 'till', 'fertilize', 'spray', 'harvest'];

  const span = $derived(Math.max(DAY_MS, timeline.toMs - timeline.fromMs));
  const pos = (ms: number) => Math.min(100, Math.max(0, ((ms - timeline.fromMs) / span) * 100));
  const width = (a: number, b: number) => Math.max(0.8, pos(b) - pos(a));

  const ordered = $derived([...years].sort((a, b) => a - b));
  const earlier = $derived(ordered.filter((y) => y < year).at(-1) ?? null);
  const later = $derived(ordered.find((y) => y > year) ?? null);

  const ticks = $derived.by(() => {
    const out: { ms: number; label: string }[] = [];
    const start = new Date(timeline.fromMs);
    let d = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    while (d.getTime() <= timeline.toMs) {
      const ms = d.getTime();
      out.push({
        ms,
        label:
          d.getMonth() === 0
            ? fmt.instant(ms, 'date', { day: undefined })
            : fmt.instant(ms, 'date', { day: undefined, year: undefined })
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return out;
  });
  const showToday = $derived(now >= timeline.fromMs && now <= timeline.toMs);

  /** Room each month label needs; at phone width only every few months get
   *  one, so labels never run together (#467). */
  const LABEL_PX = 44;
  let axisWidth = $state(0);
  const tickStep = $derived(
    axisWidth > 0 ? Math.max(1, Math.ceil((ticks.length * LABEL_PX) / axisWidth)) : 1
  );
  const shownTicks = $derived(
    ticks.map((t, i) => ({ ...t, labelled: i % tickStep === 0 && pos(t.ms) <= 92 }))
  );
  const runsOn = (endMs: number) => endMs > timeline.toMs;
</script>

<section class="season" data-testid="season-timeline" aria-labelledby="season-title">
  <div class="head">
    <h3 id="season-title" class="serif">Season {year}</h3>
    <div class="pick">
      <button
        type="button"
        class="nav-btn"
        aria-label="Earlier season"
        disabled={earlier === null}
        onclick={() => earlier !== null && onSelectYear(earlier)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <select
        aria-label="Season"
        value={year}
        onchange={(e) => onSelectYear(Number(e.currentTarget.value))}
      >
        {#each years as y (y)}
          <option value={y}>Season {y}</option>
        {/each}
      </select>
      <button
        type="button"
        class="nav-btn"
        aria-label="Later season"
        disabled={later === null}
        onclick={() => later !== null && onSelectYear(later)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  </div>
  <p class="window">
    Prep for {year} starts around {fmt.instant(timeline.prepStartMs, 'date')}, and prep for {year +
      1} around {fmt.instant(timeline.nextPrepMs, 'date')}.
  </p>
  <ul class="legend" aria-label="Key">
    {#each LEGEND as k (k)}
      <li><span class="sw" data-kind={k}></span>{SEASON_SPAN_LABEL[k]}</li>
    {/each}
    <li><span class="sw solid"></span>Done</li>
    <li><span class="sw dashed"></span>Planned or suggested</li>
  </ul>

  {#if timeline.rows.length === 0}
    <p class="hint" data-testid="season-empty">
      Nothing is planted or planned for {year} yet. Plan a crop on the Plan page to see its season here.
    </p>
    <a class="plan-link" href="/plan">Open the Plan page</a>
  {:else}
    <div class="gantt">
      <div class="row axis-row" aria-hidden="true">
        <span class="label"></span>
        <div class="track axis" bind:clientWidth={axisWidth}>
          {#each shownTicks as t (t.ms)}
            <span class="tick" class:quiet={!t.labelled} style="left:{pos(t.ms)}%"
              >{t.labelled ? t.label : ''}</span
            >
          {/each}
        </div>
      </div>
      {#if timeline.band}
        <div class="row band-row">
          <span class="label">Growing season</span>
          <div class="track">
            <span
              class="band"
              style="left:{pos(timeline.band.startMs)}%; width:{width(
                timeline.band.startMs,
                timeline.band.endMs
              )}%"
            ></span>
            {#if showToday}<span class="now" style="left:{pos(now)}%"></span>{/if}
          </div>
          <span class="sr-only">
            {timeline.band.source === 'frost'
              ? `From the last spring frost, ${fmt.instant(timeline.band.startMs, 'date')}, to the first fall frost, ${fmt.instant(timeline.band.endMs, 'date')}`
              : `From your first planting, ${fmt.instant(timeline.band.startMs, 'date')}, to your last harvest, ${fmt.instant(timeline.band.endMs, 'date')}`}
          </span>
        </div>
      {/if}
      {#each timeline.rows as row, i (row.plantingId)}
        <div class="row" data-planting-id={row.plantingId}>
          <span class="label">
            {#if row.blockWork}
              <span class="work-name">{row.name}</span>
            {:else}
              <a href={cardHref('planting', cardKey('planting', row.plantingId))}>{row.name}</a>
            {/if}
            <span class="block">{row.blockName}</span>
          </span>
          <button
            type="button"
            class="track tap"
            aria-label="{row.name} on {row.blockName}: {row.spans.length === 0
              ? 'no dates yet'
              : `${row.spans.length} dates`}. Open dates"
            onclick={() => onOpenRow(i)}
          >
            {#each row.spans as s, k (k)}
              <span
                class="bar"
                class:grow={s.kind === 'grow'}
                class:mark={s.startMs === s.endMs}
                class:planned={!s.recorded}
                class:runs-on={s.startMs !== s.endMs && runsOn(s.endMs)}
                data-kind={s.kind}
                style={s.startMs === s.endMs
                  ? `left:min(${pos(s.startMs)}%, calc(100% - 4px))`
                  : `left:${pos(s.startMs)}%; width:${width(s.startMs, s.endMs)}%`}
              ></span>
            {/each}
            {#if showToday}<span class="now" style="left:{pos(now)}%"></span>{/if}
            {#if row.plantingDate === null && !row.blockWork}<span class="undated"
                >No planting date yet</span
              >{/if}
          </button>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .season {
    background: var(--color-paper);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-card);
    padding: 14px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }
  .head h3 {
    margin: 0;
    font-size: 18px;
    color: var(--color-forest-deep);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 48px;
    min-height: 48px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    cursor: pointer;
  }
  .nav-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  select {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
  }
  .nav-btn:focus-visible,
  select:focus-visible,
  .tap:focus-visible,
  .label a:focus-visible,
  .plan-link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .window {
    margin: 8px 0;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .legend {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .sw {
    display: inline-block;
    width: 14px;
    height: 10px;
    border-radius: 2px;
    background: var(--kind, var(--color-ink-soft));
  }
  .sw.solid {
    background: var(--color-ink-soft);
  }
  .sw.dashed {
    background: transparent;
    border: 1.5px dashed var(--color-ink-soft);
  }
  [data-kind='grow'] {
    --kind: rgba(44, 82, 55, 0.35);
  }
  [data-kind='plant'] {
    --kind: var(--color-forest, #2c5237);
  }
  [data-kind='till'] {
    --kind: #8a6a3a;
  }
  [data-kind='fertilize'] {
    --kind: var(--color-wheat, #d4a75c);
  }
  [data-kind='spray'] {
    --kind: var(--color-rust, #ba4b38);
  }
  [data-kind='harvest'] {
    --kind: #b35900;
  }
  .hint {
    margin: 0 0 8px;
    color: var(--color-ink-soft);
  }
  .plan-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .gantt {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 9rem minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .label {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .label a,
  .label .work-name {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest-deep);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .block {
    font-size: 11.5px;
    font-weight: 400;
    color: var(--color-ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    position: relative;
    height: 28px;
    border-radius: 4px;
    background: var(--color-cream);
    overflow: hidden;
  }
  .track.tap {
    display: block;
    width: 100%;
    height: 48px;
    padding: 0;
    border: 1px solid var(--color-divider-soft);
    font: inherit;
    cursor: pointer;
  }
  .axis {
    height: 18px;
    background: transparent;
    overflow: hidden;
  }
  .tick.quiet {
    border-left-style: dotted;
  }
  .tick {
    position: absolute;
    top: 0;
    padding-left: 3px;
    border-left: 1px solid var(--color-divider);
    font-size: 10.5px;
    color: var(--color-ink-soft);
    white-space: nowrap;
  }
  .band {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: 3px;
    background: rgba(44, 82, 55, 0.22);
    border: 1px solid rgba(44, 82, 55, 0.5);
  }
  .bar {
    position: absolute;
    top: 14px;
    bottom: 14px;
    border-radius: 3px;
    background: var(--kind);
  }
  .bar.grow {
    top: 8px;
    bottom: 8px;
  }
  .bar.mark {
    width: 6px !important;
    margin-left: -3px;
    top: 6px;
    bottom: auto;
    height: 12px;
  }
  /* Marks of different kinds sit on their own line so a spray and a
     harvest on nearby days do not hide each other. */
  .bar.mark[data-kind='fertilize'],
  .bar.mark[data-kind='spray'] {
    top: 18px;
  }
  .bar.mark[data-kind='harvest'] {
    top: 30px;
  }
  .bar.runs-on {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .bar.runs-on::after {
    content: '';
    position: absolute;
    right: -1px;
    top: 50%;
    transform: translateY(-50%);
    border-left: 6px solid var(--color-forest-deep);
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
  }
  .bar.planned {
    background: transparent;
    border: 2px dashed var(--kind);
  }
  .bar.grow.planned {
    border-width: 1.5px;
  }
  .now {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--color-forest-deep);
    opacity: 0.6;
  }
  .undated {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding-left: 8px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
      gap: 2px;
    }
    .axis-row .label {
      display: none;
    }
    .label {
      flex-direction: row;
      align-items: baseline;
      gap: 6px;
    }
  }
</style>
