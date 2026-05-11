<!--
  GanttStrip.svelte (Phase 14, Phase 5)
  ─────────────────────────────────────
  Supplementary view below the swim-lane: a small horizontal Gantt that
  aggregates equipment + labor crunch periods. Read-only.
  Bars group by equipmentId; overlap renders red.
-->
<script lang="ts">
  interface EquipmentBar {
    equipmentId: string;
    equipmentLabel: string;
    cropId: string;
    startMs: number;
    endMs: number;
  }
  interface Props {
    bars: EquipmentBar[];
    /** Inclusive view window. */
    viewStartMs: number;
    viewEndMs: number;
  }
  const props: Props = $props();
  const DAY_MS = 86_400_000;

  const groups = $derived.by(() => {
    const m = new Map<string, EquipmentBar[]>();
    for (const b of props.bars) {
      if (b.endMs < props.viewStartMs || b.startMs > props.viewEndMs) continue;
      const list = m.get(b.equipmentId) ?? [];
      list.push(b);
      m.set(b.equipmentId, list);
    }
    return [...m.entries()].map(([id, bars]) => ({
      id,
      label: bars[0].equipmentLabel,
      bars: bars.sort((a, b) => a.startMs - b.startMs)
    }));
  });

  function offsetPct(ms: number): number {
    const span = props.viewEndMs - props.viewStartMs;
    if (span <= 0) return 0;
    return ((ms - props.viewStartMs) / span) * 100;
  }
  function widthPct(start: number, end: number): number {
    const span = props.viewEndMs - props.viewStartMs;
    if (span <= 0) return 0;
    return ((end - start) / span) * 100;
  }

  function hasOverlap(bar: EquipmentBar, others: EquipmentBar[]): boolean {
    return others.some((o) => o !== bar && o.endMs > bar.startMs && o.startMs < bar.endMs);
  }
</script>

<div class="gantt-strip" aria-label="Equipment + labor crunch strip">
  {#if groups.length === 0}
    <p class="empty">No equipment-bound tasks in this window.</p>
  {:else}
    <ul class="rows">
      {#each groups as g (g.id)}
        <li class="row">
          <span class="row-label">{g.label}</span>
          <div class="track">
            {#each g.bars as bar (bar.cropId + bar.startMs)}
              {@const conflict = hasOverlap(bar, g.bars)}
              <div
                class="bar"
                class:conflict
                style="left: {offsetPct(bar.startMs)}%; width: {widthPct(bar.startMs, bar.endMs)}%;"
                title={`${g.label}: ${new Date(bar.startMs).toLocaleDateString()} → ${new Date(bar.endMs).toLocaleDateString()}`}
              ></div>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .gantt-strip {
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 0.5rem;
    background: #fff;
  }
  .empty {
    color: #9ca3af;
    font-size: 0.85rem;
    margin: 0;
  }
  ul.rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  li.row {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.8rem;
  }
  .row-label {
    font-weight: 500;
    color: #374151;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track {
    position: relative;
    height: 16px;
    background: #f3f4f6;
    border-radius: 0.25rem;
  }
  .bar {
    position: absolute;
    top: 2px;
    bottom: 2px;
    background: #60a5fa;
    border-radius: 0.2rem;
  }
  .bar.conflict {
    background: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 4px,
      #dc2626 4px,
      #dc2626 7px
    );
  }
</style>
