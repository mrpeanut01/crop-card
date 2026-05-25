<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 plantings tab strip.
   *
   * 1:1 port of the tab strip in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * (lines 113–126). "All plantings" + per-planting tabs, with color
   * dots. Only renders when there are 2+ plantings — single-planting
   * blocks skip this and go straight to the deep view.
   */
  import type { PlantingRecord } from '$lib/db/blocks';

  interface Props {
    plantings: PlantingRecord[];
    /** -1 = "All plantings"; 0+ = index into plantings[]. */
    activeIdx: number;
    onSelect: (idx: number) => void;
  }
  const { plantings, activeIdx, onSelect }: Props = $props();

  function plantingColor(plantingId: string): string {
    const PALETTE = ['#7a8f5a', '#c9961f', '#6f8fa8', '#a85a1f', '#4a8b54', '#a23a3a', '#8a6722', '#7a3a4d'];
    let h = 0;
    for (let i = 0; i < plantingId.length; i++) h = (h * 31 + plantingId.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function shortName(name: string): string {
    return name.split(' ').slice(0, 3).join(' ');
  }
</script>

<nav class="tabs" aria-label="Plantings">
  <button
    type="button"
    class="tab"
    class:active={activeIdx === -1}
    onclick={() => onSelect(-1)}
  >
    All plantings
    <span class="count" class:on={activeIdx === -1}>{plantings.length}</span>
  </button>
  {#each plantings as p, i (p.id)}
    <button
      type="button"
      class="tab"
      class:active={activeIdx === i}
      onclick={() => onSelect(i)}
    >
      <span class="swatch" style:background={plantingColor(p.id)}></span>
      {shortName(p.varietyDisplayName)}
    </button>
  {/each}
</nav>

<style>
  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
    border-bottom: 1px solid var(--color-divider);
    overflow-x: auto;
    padding-bottom: 0;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px 10px;
    background: transparent;
    border: none;
    color: var(--color-ink-soft);
    font-size: 13px;
    font-weight: 500;
    border-bottom: 2.5px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
  }
  .tab.active {
    color: var(--color-forest-deep);
    font-weight: 700;
    border-bottom-color: var(--color-forest);
  }
  .tab:hover:not(.active) {
    color: var(--color-ink);
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    display: inline-block;
  }
  .count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 99px;
    font-size: 10.5px;
    font-weight: 700;
    margin-left: 2px;
    background: var(--color-divider-soft, var(--color-divider));
    color: var(--color-ink-soft);
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .count.on {
    background: var(--color-forest);
    color: var(--color-cream);
  }
</style>
