<script lang="ts">
  /**
   * /today Week and Month calendars. Calendar-aligned, paged with
   * Previous / Next / Today. Each day shows its forecast (the NWS 7 days
   * only) and read-only chips; tapping opens the full card in a sheet.
   */
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  import WeatherIcon from './WeatherIcon.svelte';
  import type { CalendarChip } from '$lib/today/calendar';
  import { CALENDAR_KIND_LABEL } from '$lib/today/calendar';
  import type { CalendarGrid } from '$lib/today/views';
  import { shiftAnchor } from '$lib/today/views';
  import { RAIN_POP_PCT, type DayWeather } from '$lib/today/weatherSummary';
  import { TASK_STATUS_LABEL } from '$lib/tasks/status';
  import { fmt } from '$lib/prefsState.svelte';

  interface Props {
    view: 'week' | 'month';
    anchor: string;
    grid: CalendarGrid;
    todayYmd: string;
    cells: Record<string, CalendarChip[]>;
    weather: Record<string, DayWeather>;
    blockNames: Record<string, string>;
    onPage: (anchor: string | null) => void;
    onOpenChip: (day: string, chip: CalendarChip) => void;
    onOpenDay: (day: string) => void;
  }
  const {
    view,
    anchor,
    grid,
    todayYmd,
    cells,
    weather,
    blockNames,
    onPage,
    onOpenChip,
    onOpenDay
  }: Props = $props();

  const MONTH_CHIPS = 3;
  const unit = $derived(view === 'week' ? 'week' : 'month');
  const title = $derived(
    view === 'month'
      ? fmt.day(`${grid.month}-01`, 'date', { day: undefined, month: 'long' })
      : `Week of ${fmt.day(grid.fromYmd, 'month-day')}`
  );
  const range = $derived(
    `${fmt.day(grid.fromYmd, 'month-day')} to ${fmt.day(grid.toYmd, 'month-day')}`
  );
  const showsToday = $derived(todayYmd >= grid.fromYmd && todayYmd <= grid.toYmd);
  const weekdays = $derived(grid.weeks[0].map((d) => fmt.day(d, 'weekday')));

  function chipLabel(c: CalendarChip): string {
    const where = c.blockId ? blockNames[c.blockId] : undefined;
    const state =
      c.type === 'suggestion'
        ? 'suggested by your crop calendar'
        : `${TASK_STATUS_LABEL[c.status]}${c.queued ? ', waiting to upload' : ''}`;
    return [c.title, where, state].filter(Boolean).join(', ');
  }
  function chipMeta(c: CalendarChip): string {
    const parts: string[] = [CALENDAR_KIND_LABEL[c.kind]];
    if (c.blockId && blockNames[c.blockId]) parts.push(blockNames[c.blockId]);
    if (c.type === 'suggestion') parts.push('Suggested');
    else if (c.status === 'late' || c.status === 'skipped') parts.push(TASK_STATUS_LABEL[c.status]);
    return parts.join(' · ');
  }
  function dayLabel(d: string): string {
    const n = cells[d]?.length ?? 0;
    const w = weather[d];
    const parts = [fmt.day(d, 'date-long', { year: undefined })];
    if (w) parts.push(w.shortForecast ?? '');
    parts.push(n === 0 ? 'nothing scheduled' : n === 1 ? '1 item' : `${n} items`);
    return parts.filter(Boolean).join(', ');
  }
</script>

<section class="cal" data-testid="calendar-{view}" aria-label="{title} calendar">
  <div class="head">
    <div class="title">
      <h3 class="serif">{title}</h3>
      <span class="range">{range}</span>
    </div>
    <div class="nav">
      <button
        type="button"
        class="nav-btn"
        aria-label="Previous {unit}"
        onclick={() => onPage(shiftAnchor(view, anchor, -1))}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="nav-btn today-btn"
        disabled={showsToday && anchor === todayYmd}
        onclick={() => onPage(null)}>Today</button
      >
      <button
        type="button"
        class="nav-btn"
        aria-label="Next {unit}"
        onclick={() => onPage(shiftAnchor(view, anchor, 1))}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  </div>

  {#if view === 'week'}
    <ol class="week">
      {#each grid.weeks[0] as d (d)}
        {@const w = weather[d]}
        {@const chips = cells[d] ?? []}
        <li class="wday" class:today={d === todayYmd} class:past={d < todayYmd} data-day={d}>
          <div class="wday-head">
            <span class="weekday">{fmt.day(d, 'weekday')}</span>
            <span class="serif daynum">{fmt.day(d, 'month-day')}</span>
            {#if w}
              <span class="wx" title={w.shortForecast}>
                <WeatherIcon sky={w.sky} />
                <span class="mono">
                  {#if w.overnightOnly}{fmt.qty(w.lowF, 'temperature')}{:else}{fmt.qty(
                      w.highF,
                      'temperature'
                    )}/{fmt.qty(w.lowF, 'temperature')}{/if}
                </span>
                {#if w.popPct >= RAIN_POP_PCT}<span class="pop">{w.popPct}%</span>{/if}
                {#if w.shortForecast}<span class="sr-only">{w.shortForecast}</span>{/if}
              </span>
            {/if}
          </div>
          {#if chips.length === 0}
            <span class="none">Nothing scheduled</span>
          {:else}
            <ul class="chips">
              {#each chips as c (c.key)}
                <li>
                  <button
                    type="button"
                    class="chip"
                    data-kind={c.kind}
                    data-chip={c.type}
                    data-status={c.type === 'task' ? c.status : 'suggested'}
                    aria-label={chipLabel(c)}
                    onclick={() => onOpenChip(d, c)}
                  >
                    <span class="chip-title">
                      {#if c.type === 'task' && c.status === 'done'}<span aria-hidden="true"
                          >✓
                        </span>{/if}{c.title}
                    </span>
                    <span class="chip-meta">{chipMeta(c)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <div class="month">
      <div class="mrow mhead" aria-hidden="true">
        {#each weekdays as wd, i (i)}
          <span class="mwd">{wd}</span>
        {/each}
      </div>
      {#each grid.weeks as week (week[0])}
        <div class="mrow">
          {#each week as d (d)}
            {@const w = weather[d]}
            {@const chips = cells[d] ?? []}
            <button
              type="button"
              class="mcell"
              class:today={d === todayYmd}
              class:other={d.slice(0, 7) !== grid.month}
              class:past={d < todayYmd}
              data-day={d}
              aria-label={dayLabel(d)}
              onclick={() => onOpenDay(d)}
            >
              <span class="mcell-head">
                <span class="mnum">{Number(d.slice(8))}</span>
                {#if w}
                  <span class="mwx">
                    <WeatherIcon sky={w.sky} size={14} />
                    <span class="mtemp mono"
                      >{w.overnightOnly
                        ? fmt.qty(w.lowF, 'temperature')
                        : `${fmt.qty(w.highF, 'temperature')}/${fmt.qty(w.lowF, 'temperature')}`}</span
                    >
                    {#if w.popPct >= RAIN_POP_PCT}<span class="pop">{w.popPct}%</span>{/if}
                  </span>
                {/if}
              </span>
              {#each chips.slice(0, MONTH_CHIPS) as c (c.key)}
                <span
                  class="mchip"
                  data-kind={c.kind}
                  data-chip={c.type}
                  data-status={c.type === 'task' ? c.status : 'suggested'}
                  >{c.title}{#if c.blockId && blockNames[c.blockId]}<span class="mblock">
                      · {blockNames[c.blockId]}</span
                    >{/if}</span
                >
              {/each}
              {#if chips.length > MONTH_CHIPS}
                <span class="more">+{chips.length - MONTH_CHIPS} more</span>
              {/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .cal {
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
    margin-bottom: 12px;
  }
  .title {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 10px;
    min-width: 0;
  }
  .title h3 {
    margin: 0;
    font-size: 18px;
    color: var(--color-forest-deep);
  }
  .range {
    font-size: 12.5px;
    color: var(--color-ink-soft);
  }
  .nav {
    display: flex;
    gap: 6px;
  }
  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 48px;
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .nav-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .nav-btn:focus-visible,
  .chip:focus-visible,
  .mcell:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .pop {
    font-weight: 700;
    color: var(--color-sky-deep, #2a5a7a);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* Week: seven columns when there is room, one row per day on a phone. */
  .week {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
  }
  .wday {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--color-divider-soft);
    border-radius: 8px;
    background: var(--color-cream);
  }
  .wday.today {
    border-color: var(--color-forest-deep);
    background: var(--color-forest-tint, #e5eedf);
  }
  .wday-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .weekday {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-soft);
  }
  .daynum {
    font-size: 15px;
    color: var(--color-forest-deep);
  }
  .wx {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .none {
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    width: 100%;
    min-height: 48px;
    padding: 4px 8px;
    border: 1px solid var(--color-divider-soft);
    border-left: 4px solid var(--kind, var(--color-ink-soft));
    border-radius: 0 6px 6px 0;
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .chip-title {
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.25;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }
  .chip-meta {
    font-size: 11px;
    color: var(--color-ink-soft);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-kind='scout'] {
    --kind: var(--color-sky, #6f8fa8);
  }
  [data-kind='spray'] {
    --kind: var(--color-rust, #ba4b38);
  }
  [data-kind='harvest'],
  [data-kind='fertility'] {
    --kind: var(--color-wheat, #d4a75c);
  }
  [data-kind='planting'] {
    --kind: var(--color-forest, #2c5237);
  }
  [data-kind='task'] {
    --kind: var(--color-ink-muted, #5a6b6e);
  }
  .chip[data-chip='suggestion'],
  .mchip[data-chip='suggestion'] {
    border-style: dashed;
    opacity: 0.75;
    background: transparent;
  }
  .chip[data-status='done'] .chip-title,
  .chip[data-status='skipped'] .chip-title,
  .mchip[data-status='done'],
  .mchip[data-status='skipped'] {
    text-decoration: line-through;
    color: var(--color-ink-soft);
  }
  .chip[data-status='late'],
  .mchip[data-status='late'] {
    border-color: var(--color-rust, #ba4b38);
  }
  @media (max-width: 720px) {
    .week {
      grid-template-columns: minmax(0, 1fr);
    }
    .wday {
      display: grid;
      grid-template-columns: 5.5rem minmax(0, 1fr);
      align-items: start;
    }
  }

  /* Month */
  .month {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mrow {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
  }
  .mwd {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-ink-soft);
    text-align: center;
  }
  .mcell {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
    min-width: 0;
    min-height: 88px;
    padding: 4px;
    border: 1px solid var(--color-divider-soft);
    border-radius: 6px;
    background: var(--color-cream);
    color: var(--color-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .mcell.other {
    opacity: 0.6;
  }
  .mcell.today {
    border-color: var(--color-forest-deep);
    background: var(--color-forest-tint, #e5eedf);
  }
  .mcell-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 2px;
  }
  .mnum {
    font-weight: 700;
    font-size: 13px;
    color: var(--color-forest-deep);
  }
  .mwx {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 10.5px;
    color: var(--color-ink-soft);
  }
  .mchip {
    display: block;
    padding: 1px 4px;
    border: 1px solid transparent;
    border-left: 3px solid var(--kind, var(--color-ink-soft));
    border-radius: 0 3px 3px 0;
    background: var(--color-paper);
    font-size: 11px;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mblock {
    color: var(--color-ink-soft);
  }
  .more {
    font-size: 10.5px;
    color: var(--color-ink-soft);
  }
  @media (max-width: 640px) {
    .mtemp,
    .mblock {
      display: none;
    }
    .mcell {
      min-height: 64px;
      padding: 3px 2px;
    }
    .mchip {
      font-size: 0;
      height: 6px;
      padding: 0;
      border-left-width: 0;
      background: var(--kind, var(--color-ink-soft));
      border-radius: 3px;
    }
    .mchip[data-chip='suggestion'] {
      background: transparent;
      border: 1px dashed var(--kind, var(--color-ink-soft));
    }
    .more {
      font-size: 9.5px;
    }
  }
  /* Phone width: the month runs edge to edge inside the card with no gaps,
     so each day stays at least 48px wide for a gloved tap. */
  @media (max-width: 480px) {
    .month {
      margin-inline: -14px;
      overflow-x: auto;
    }
    .mrow {
      grid-template-columns: repeat(7, minmax(48px, 1fr));
      gap: 0;
    }
    .mcell {
      min-width: 48px;
      border-radius: 0;
      padding: 3px 2px;
    }
  }
</style>
