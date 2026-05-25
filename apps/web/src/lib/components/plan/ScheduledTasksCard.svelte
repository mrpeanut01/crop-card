<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 scheduled-tasks table card.
   *
   * 1:1 port of the scheduled-tasks card in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * (lines 288–329). Tabular view: Date · Task · Planting · Source ·
   * Status · row-action chevron. Rows are derived from the parent's
   * Task[] + calendar-engine events that fall in the next 30 days.
   *
   * When a planting is selected via the tab strip, the parent filters
   * the row set; this card just displays whatever it's given.
   */
  import { Plus, ChevronRight } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  export type ScheduledRow = {
    id: string;
    dateLabel: string;
    title: string;
    plantingLabel?: string;
    plantingColor?: string;
    source: string;
    status: 'scheduled' | 'today' | 'window-open' | 'overdue';
    href?: string;
  };

  interface Props {
    rows: ScheduledRow[];
    /** Title suffix — "· next 30 days" or "· Cherokee Bean". */
    titleSuffix?: string;
    onAddTask?: () => void;
  }
  const { rows, titleSuffix = '· next 30 days', onAddTask }: Props = $props();

  function statusTone(s: ScheduledRow['status']): 'wheat' | 'rust' | 'neutral' | 'forest' {
    return s === 'window-open' ? 'wheat' : s === 'today' ? 'rust' : s === 'overdue' ? 'rust' : 'neutral';
  }
</script>

<Card>
  <div class="head">
    <h3 class="serif">Scheduled tasks <span class="suffix">{titleSuffix}</span></h3>
    {#if onAddTask}
      <button class="ghost" onclick={onAddTask} type="button">
        <Plus size={13} strokeWidth={1.75} /> Task
      </button>
    {/if}
  </div>

  {#if rows.length === 0}
    <div class="empty">Nothing scheduled in this window.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Task</th>
          <th>Planting</th>
          <th>Source</th>
          <th>Status</th>
          <th aria-label="open"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr>
            <td class="mono date">{row.dateLabel}</td>
            <td class="task">{row.title}</td>
            <td>
              {#if row.plantingLabel}
                <span class="planting-chip">
                  <span class="swatch" style:background={row.plantingColor ?? 'var(--color-divider)'}></span>
                  {row.plantingLabel}
                </span>
              {/if}
            </td>
            <td class="source">{row.source}</td>
            <td><Pill tone={statusTone(row.status)}>{row.status}</Pill></td>
            <td class="chev">
              {#if row.href}
                <a href={row.href} aria-label="Open task">
                  <ChevronRight size={14} strokeWidth={1.75} />
                </a>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
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
  .suffix {
    color: var(--color-ink-muted);
    font-weight: 400;
    font-family: inherit;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-forest-deep);
    border-radius: var(--radius-input, 6px);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
  .empty {
    color: var(--color-ink-muted);
    font-size: 13px;
    padding: 14px 0 0;
    font-style: italic;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  thead th {
    text-align: left;
    padding: 8px 10px 8px 0;
    color: var(--color-ink-muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }
  tbody tr {
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  tbody td {
    padding: 12px 10px 12px 0;
    vertical-align: top;
    color: var(--color-ink);
  }
  .date {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-ink-soft);
    white-space: nowrap;
  }
  .task {
    font-weight: 500;
  }
  .source {
    color: var(--color-ink-muted);
    font-size: 12.5px;
  }
  .planting-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--color-ink);
  }
  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 2px;
  }
  .chev {
    text-align: right;
  }
  .chev a {
    color: var(--color-ink-muted);
    text-decoration: none;
  }
  .chev a:hover {
    color: var(--color-forest-deep);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
</style>
