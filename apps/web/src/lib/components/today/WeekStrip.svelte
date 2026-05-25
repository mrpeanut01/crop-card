<script lang="ts">
  /**
   * Phase 25e (#97) — /today 7-day week strip with task pills.
   *
   * 1:1 port of the `ATodayScreen` week-strip card in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 312–350). Day cards with task items color-coded by kind.
   *
   * Renders a 7-day window starting "today" (locale-derived). Items are
   * keyed by ISO date; the parent fans the tasks + derived events into
   * the map before passing in.
   */
  import Card from '$lib/components/ui/Card.svelte';

  export type WeekKind = 'scout' | 'spray' | 'harvest' | 'fertility' | 'planting' | 'task';
  export interface WeekItem {
    title: string;
    kind: WeekKind;
  }

  interface Props {
    /** ms timestamp for today (local 00:00). */
    todayStartMs: number;
    /** Map keyed by YYYY-MM-DD → items for that day. */
    items: Record<string, WeekItem[]>;
  }
  const { todayStartMs, items }: Props = $props();

  const DAY_MS = 24 * 60 * 60 * 1000;
  const days = $derived.by(() => {
    const out: Array<{
      iso: string;
      weekday: string;
      day: number;
      isToday: boolean;
      items: WeekItem[];
    }> = [];
    for (let i = 0; i < 7; i++) {
      const ms = todayStartMs + i * DAY_MS;
      const d = new Date(ms);
      const iso = d.toISOString().slice(0, 10);
      out.push({
        iso,
        weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
        day: d.getDate(),
        isToday: i === 0,
        items: items[iso] ?? []
      });
    }
    return out;
  });
</script>

<Card>
  <div class="head">
    <h3 class="serif">This week</h3>
  </div>
  <div class="grid">
    {#each days as d (d.iso)}
      <div class="day" class:today={d.isToday}>
        <div class="day-head">
          <span class="weekday">{d.weekday}</span>
          <span class="serif daynum" class:today-num={d.isToday}>{d.day}</span>
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
  .head h3 {
    margin: 0;
    font-size: 18px;
    color: var(--color-forest-deep);
    letter-spacing: -0.01em;
    font-family: var(--font-serif, serif);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 8px;
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
