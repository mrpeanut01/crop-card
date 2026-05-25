<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 left rail with block list + filter.
   *
   * 1:1 port of the left-rail block in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * (lines 28–79). 280px fixed column showing every block with a color
   * stack on the left (multi-bar when poly), block label + acres, crop
   * name, and a "N plantings" pip when poly.
   *
   * The "Add block" button opens whatever flow Plan uses — passes
   * through `onAddBlock`. The filter input does client-side substring
   * filtering on block names.
   */
  import { Plus, Search, Layers } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';

  interface Props {
    blocks: BlockWithPlantings[];
    /** Currently-selected block id. */
    selectedId?: string;
    onSelect: (blockId: string) => void;
    onAddBlock?: () => void;
  }
  const { blocks, selectedId, onSelect, onAddBlock }: Props = $props();

  let filterText = $state('');
  const filtered = $derived(
    filterText.trim()
      ? blocks.filter((b) => b.name.toLowerCase().includes(filterText.trim().toLowerCase()))
      : blocks
  );

  // Stable color hash per planting so the rail bars match the planting
  // grid + season-timeline colors elsewhere.
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
</script>

<aside class="rail">
  <div class="rail-head">
    <div class="head-row">
      <Kicker>Blocks · {blocks.length}</Kicker>
      {#if onAddBlock}
        <button class="add" onclick={onAddBlock} title="New block" aria-label="New block">
          <Plus size={14} strokeWidth={1.75} />
        </button>
      {/if}
    </div>
    <div class="filter-wrap">
      <Search size={13} strokeWidth={1.75} class="filter-icon" />
      <input
        class="filter"
        type="text"
        placeholder="Filter blocks…"
        bind:value={filterText}
        aria-label="Filter blocks by name"
      />
    </div>
  </div>

  {#if filtered.length === 0}
    <div class="empty">
      {filterText.trim() ? `No blocks match “${filterText}”.` : 'No blocks yet.'}
    </div>
  {:else}
    {#each filtered as b (b.id)}
      {@const poly = b.plantings.length > 1}
      <button class="row" class:selected={b.id === selectedId} onclick={() => onSelect(b.id)}>
        <div class="bars">
          {#if b.plantings.length === 0}
            <span class="bar single" style:background="var(--color-divider)"></span>
          {:else}
            {#each b.plantings.slice(0, 3) as p (p.id)}
              <span class="bar" class:single={!poly} style:background={plantingColor(p.id)}></span>
            {/each}
          {/if}
        </div>
        <div class="body">
          <div class="head-line">
            <span class="serif name">{b.name}</span>
            {#if b.acres !== undefined}
              <span class="mono acres">{b.acres} ac</span>
            {/if}
          </div>
          {#if b.plantings.length > 0}
            <div class="crops">
              {b.plantings
                .slice(0, 2)
                .map((p) => p.varietyDisplayName)
                .join(' · ')}{b.plantings.length > 2 ? ` · +${b.plantings.length - 2}` : ''}
            </div>
          {:else}
            <div class="crops empty-crops">No plantings yet</div>
          {/if}
          {#if poly}
            <div class="poly-pill">
              <Layers size={10} strokeWidth={1.75} />
              {b.plantings.length} plantings
            </div>
          {/if}
        </div>
      </button>
    {/each}
  {/if}
</aside>

<style>
  .rail {
    width: 280px;
    border-right: 1px solid var(--color-divider);
    background: var(--color-paper);
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
  }
  .rail-head {
    padding: 20px 18px 14px;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .add {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--color-divider);
    color: var(--color-forest-deep);
    cursor: pointer;
    display: grid;
    place-items: center;
    font-family: inherit;
  }
  .add:hover {
    border-color: var(--color-forest-deep);
    background: var(--color-cream);
  }
  .filter-wrap {
    margin-top: 10px;
    position: relative;
  }
  :global(.filter-wrap .filter-icon) {
    position: absolute;
    left: 9px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-ink-muted);
    pointer-events: none;
  }
  .filter {
    width: 100%;
    padding: 7px 10px 7px 30px;
    font-size: 13px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    color: var(--color-ink);
    outline: none;
    font-family: inherit;
  }
  .filter:focus {
    border-color: var(--color-forest-deep);
  }
  .empty {
    padding: 14px 18px;
    color: var(--color-ink-muted);
    font-size: 12.5px;
    font-style: italic;
  }
  .row {
    width: 100%;
    text-align: left;
    padding: 12px 16px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: transparent;
    border: none;
    border-left: 3px solid transparent;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
    font-family: inherit;
    cursor: pointer;
  }
  .row:hover {
    background: var(--color-cream);
  }
  .row.selected {
    background: var(--color-wheat-tint, #efe6cc);
    border-left-color: var(--color-forest);
  }
  .bars {
    width: 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bar {
    width: 10px;
    height: 9px;
    border-radius: 2px;
  }
  .bar.single {
    height: 28px;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .head-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }
  .name {
    font-family: var(--font-serif, serif);
    font-size: 15px;
    color: var(--color-ink);
  }
  .acres {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
    color: var(--color-ink-muted);
  }
  .crops {
    font-size: 12px;
    color: var(--color-ink-soft);
    margin-top: 2px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty-crops {
    font-style: italic;
    color: var(--color-ink-muted);
  }
  .poly-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    color: var(--color-forest);
    margin-top: 4px;
    font-weight: 600;
  }
  @media (max-width: 900px) {
    .rail {
      width: 100%;
      max-height: 280px;
      border-right: none;
      border-bottom: 1px solid var(--color-divider);
    }
  }
</style>
