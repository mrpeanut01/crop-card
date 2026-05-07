<script lang="ts">
  let { data } = $props();

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function dayNum(iso: string) {
    return parseInt(iso.slice(8, 10), 10);
  }
</script>

<header class="head">
  <h1>Season calendar</h1>
  <p class="lede">
    {data.eventCountTotal} event{data.eventCountTotal === 1 ? '' : 's'}
    derived from {data.blockCount} block{data.blockCount === 1 ? '' : 's'}. Click any day with
    events for details. Color shows event kind.
  </p>
  <nav class="plan-tabs" aria-label="Plan views">
    <a href="/plan">📋 Blocks & plantings</a>
    <a href="/plan/calendar" class="active" aria-current="page">📅 Calendar</a>
  </nav>
  <nav class="month-nav" aria-label="Month navigation">
    <a href="/plan/calendar?ym={data.prev}">← Prev</a>
    <strong>{data.monthLabel}</strong>
    <a href="/plan/calendar?ym={data.next}">Next →</a>
  </nav>
</header>

{#if data.eventCountTotal === 0}
  <section class="empty">
    <h2>Empty calendar</h2>
    <p>Add a block + planting on <a href="/plan">/plan</a> to populate.</p>
  </section>
{:else}
  <div class="grid" role="grid" aria-label={data.monthLabel}>
    {#each dayLabels as d (d)}
      <div class="day-label" role="columnheader">{d}</div>
    {/each}
    {#each data.grid as cell (cell.iso)}
      <div
        class="cell"
        class:in-month={cell.inMonth}
        class:out-of-month={!cell.inMonth}
        class:today={cell.isToday}
        role="gridcell"
      >
        <div class="num">{dayNum(cell.iso)}</div>
        {#if cell.events.length > 0}
          <ul class="events">
            {#each cell.events.slice(0, 3) as e (e.kind + e.cropPluginId + e.startMs)}
              <li class="event {e.kind}" title="{e.title} — {e.varietyDisplayName}">
                <span class="dot" aria-hidden="true"></span>
                <span class="label">{e.title}</span>
              </li>
            {/each}
            {#if cell.events.length > 3}
              <li class="event more">+{cell.events.length - 3} more</li>
            {/if}
          </ul>
        {/if}
      </div>
    {/each}
  </div>

  <section class="legend" aria-label="Event kind legend">
    <h2>Legend</h2>
    <ul>
      <li><span class="dot planting"></span> planting</li>
      <li><span class="dot emergence"></span> emergence</li>
      <li><span class="dot spray-window"></span> spray window</li>
      <li><span class="dot companion-trigger"></span> companion plant trigger</li>
      <li><span class="dot harvest-window"></span> harvest window</li>
      <li><span class="dot cover-termination"></span> cover crop termination</li>
      <li><span class="dot orchard-task"></span> orchard task</li>
      <li><span class="dot curing-progress"></span> curing in progress</li>
      <li><span class="dot curing-ready"></span> curing ready</li>
    </ul>
  </section>
{/if}

<style>
  .head h1 {
    margin: 0;
  }
  .lede {
    color: #555;
    margin: 0.25rem 0 1rem;
  }
  .plan-tabs {
    display: flex;
    gap: 0;
    margin: 0.5rem 0 1.25rem;
    border-bottom: 2px solid #1f5e3a;
  }
  .plan-tabs a {
    padding: 0.75rem 1.25rem;
    text-decoration: none;
    color: #555;
    font-weight: 600;
    border-bottom: 4px solid transparent;
    margin-bottom: -2px;
    min-height: 60px;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .plan-tabs a:hover {
    color: #1f5e3a;
    background: #f8fbf9;
  }
  .plan-tabs a.active {
    color: #1f5e3a;
    border-bottom-color: #1f5e3a;
  }
  .month-nav {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .month-nav a {
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
    padding: 0.5rem 0.75rem;
    border: 2px solid #1f5e3a;
    border-radius: 4px;
    min-height: 48px;
    display: inline-flex;
    align-items: center;
  }
  .month-nav strong {
    font-size: 1.2rem;
    color: #1f5e3a;
  }
  .empty {
    background: white;
    padding: 2rem;
    border-radius: 8px;
    text-align: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    background: #d0d7d0;
    border: 1px solid #d0d7d0;
    border-radius: 6px;
    overflow: hidden;
  }
  .day-label {
    background: #1f5e3a;
    color: white;
    padding: 0.5rem;
    text-align: center;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .cell {
    background: white;
    min-height: 96px;
    padding: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    overflow: hidden;
  }
  .cell.out-of-month {
    background: #f5f7f4;
    color: #aaa;
  }
  .cell.today {
    background: #fffceb;
    box-shadow: inset 0 0 0 2px #ffd400;
  }
  .num {
    font-size: 0.85rem;
    color: #555;
    font-weight: 600;
  }
  .cell.today .num {
    color: #1f5e3a;
  }
  .events {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .event {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: #333;
    line-height: 1.2;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .event .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .event.more {
    color: #888;
    font-style: italic;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .planting .dot,
  .dot.planting {
    background: #1f5e3a;
  }
  .emergence .dot,
  .dot.emergence {
    background: #4d8e36;
  }
  .spray-window .dot,
  .dot.spray-window {
    background: #b35900;
  }
  .companion-trigger .dot,
  .dot.companion-trigger {
    background: #6b3fa0;
  }
  .harvest-window .dot,
  .dot.harvest-window {
    background: #c2185b;
  }
  .orchard-task .dot,
  .dot.orchard-task {
    background: #c45a00;
  }
  .curing-progress .dot,
  .dot.curing-progress {
    background: #d4a017;
  }
  .curing-ready .dot,
  .dot.curing-ready {
    background: #2e7d32;
  }
  .cover-termination .dot,
  .dot.cover-termination {
    background: #777;
  }

  .legend {
    background: white;
    padding: 1rem;
    margin-top: 1rem;
    border-radius: 8px;
  }
  .legend h2 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .legend ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
    color: #555;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
</style>
