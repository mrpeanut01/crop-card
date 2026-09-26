<script lang="ts">
  /**
   * Phase 25e (#97) — /today 7-day week strip with task pills.
   *
   * 1:1 port of the `ATodayScreen` week-strip card in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 312–350). Day cards with task items color-coded by kind.
   *
   * Renders a 7-day window starting the user's "today" (their time zone). Items are
   * keyed by ISO date; the parent fans the tasks + derived events into
   * the map before passing in.
   */
  import Card from '$lib/components/ui/Card.svelte';
  import { fmt } from '$lib/prefsState.svelte';

  export type WeekKind = 'scout' | 'spray' | 'harvest' | 'fertility' | 'planting' | 'task';
  export interface WeekItem {
    title: string;
    kind: WeekKind;
  }

  export type Period = 'week' | 'month' | 'season';
  const PERIODS: { id: Period; label: string; days: number }[] = [
    { id: 'week', label: 'Week', days: 7 },
    { id: 'month', label: 'Month', days: 28 },
    { id: 'season', label: 'Season', days: 84 }
  ];

  interface Props {
    /** ms timestamp for the user's today at 00:00 UTC (`Date.parse(fmt.today())`). */
    todayStartMs: number;
    /** Map keyed by YYYY-MM-DD → items for that day. Should cover 84 days for Season view. */
    items: Record<string, WeekItem[]>;
  }
  const { todayStartMs, items }: Props = $props();

  let period = $state<Period>('week');
  const periodMeta = $derived(PERIODS.find((p) => p.id === period)!);

  const DAY_MS = 24 * 60 * 60 * 1000;
  const days = $derived.by(() => {
    const out: Array<{
      iso: string;
      weekday: string;
      day: number;
      month: string | null;
      isToday: boolean;
      items: WeekItem[];
    }> = [];
    for (let i = 0; i < periodMeta.days; i++) {
      const ms = todayStartMs + i * DAY_MS;
      const d = new Date(ms);
      const iso = d.toISOString().slice(0, 10);
      const day = d.getUTCDate();
      out.push({
        iso,
        weekday: fmt.day(iso, 'weekday'),
        day,
        month: i === 0 || day === 1 ? fmt.day(iso, 'month-day', { day: undefined }) : null,
        isToday: i === 0,
        items: items[iso] ?? []
      });
    }
    return out;
  });
  const range = $derived(
    days.length > 0
      ? `${fmt.day(days[0].iso, 'month-day')} – ${fmt.day(days[days.length - 1].iso, 'month-day')}`
      : ''
  );
</script>

<Card>
  <div class="head">
    <div class="title">
      <h3 class="serif">
        {period === 'week' ? 'This week' : period === 'month' ? 'Next 4 weeks' : 'This season'}
      </h3>
      <span class="range">{range}</span>
    </div>
    <div class="seg" role="tablist" aria-label="View period">
      {#each PERIODS as p (p.id)}
        <button
          type="button"
          role="tab"
          aria-selected={period === p.id}
          class:active={period === p.id}
          onclick={() => (period = p.id)}
        >
          {p.label}
        </button>
      {/each}
    </div>
  </div>
  <div class="grid" data-period={period}>
    {#each days as d (d.iso)}
      <div class="day" class:today={d.isToday} class:month-start={d.day === 1}>
        <div class="day-head">
          <span class="weekday">{d.weekday}</span>
          <span class="serif daynum" class:today-num={d.isToday}>
            {#if d.month}<span class="month">{d.month}</span>{/if}{d.day}
          </span>
        </div>
        {#each d.items as item, k (k)}
          <div class="item" data-kind={item.kind}>{item.title}</div>
        {/each}
      </div>
    {/each}
  </div>
</Card>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .range {
    font-size: 12px;
    color: var(--color-ink-muted);
  }
  .head h3 {
    margin: 0;
    font-size: 18px;
    color: var(--color-forest-deep);
    letter-spacing: -0.01em;
    font-family: var(--font-serif, serif);
  }
  .seg {
    display: inline-flex;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 999px;
    padding: 2px;
    gap: 2px;
  }
  .seg button {
    min-height: 48px;
    min-width: 48px;
    padding: 0 14px;
    border: none;
    background: transparent;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-ink-muted);
    cursor: pointer;
    font-family: inherit;
  }
  .seg button.active {
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 8px;
  }
  .grid[data-period='month'] .day,
  .grid[data-period='season'] .day {
    min-height: 90px;
  }
  .day {
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
    padding: 10px;
    min-height: 130px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .day.today {
    background: var(--color-forest-tint, #e5eedf);
    border-color: var(--color-forest-deep);
  }
  .day-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 2px 4px;
    min-width: 0;
  }
  @media (max-width: 480px) {
    .grid {
      gap: 4px;
    }
    .day {
      padding: 6px 4px;
      min-width: 0;
    }
    .day-head {
      flex-direction: column;
      align-items: flex-start;
    }
    .daynum {
      font-size: 15px;
    }
    .month {
      display: block;
      margin-right: 0;
    }
  }
  .weekday {
    font-size: 11px;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .daynum {
    font-size: 18px;
    color: var(--color-ink-soft);
    font-family: var(--font-serif, serif);
  }
  .month {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-forest);
    margin-right: 4px;
    font-family: var(--font-sans, inherit);
  }
  .day.month-start {
    border-left: 3px solid var(--color-forest);
  }
  .today-num {
    color: var(--color-forest-deep);
  }
  .item {
    padding: 6px 8px;
    background: var(--color-paper);
    border-radius: 0 4px 4px 0;
    font-size: 11.5px;
    color: var(--color-ink);
    line-height: 1.3;
    border-left: 3px solid var(--color-divider);
  }
  .item[data-kind='scout'] {
    border-left-color: var(--color-sky, #6f8fa8);
  }
  .item[data-kind='spray'] {
    border-left-color: var(--color-rust, #ba4b38);
  }
  .item[data-kind='harvest'] {
    border-left-color: var(--color-wheat, #d4a75c);
  }
  .item[data-kind='fertility'] {
    border-left-color: var(--color-wheat, #d4a75c);
  }
  .item[data-kind='planting'] {
    border-left-color: var(--color-forest, #2c5237);
  }
  .item[data-kind='task'] {
    border-left-color: var(--color-ink-muted, #5a6b6e);
  }
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: repeat(7, minmax(70px, 1fr));
      overflow-x: auto;
    }
    .day {
      min-height: 110px;
    }
  }
</style>
