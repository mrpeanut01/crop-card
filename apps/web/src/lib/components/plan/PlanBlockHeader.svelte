<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 block-header bar.
   *
   * 1:1 port of the block-header in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * (lines 88–111). Kicker line ("Block · 0.8 ac · 2 plantings") + serif
   * h1 ("Block A — Bloody Butcher corn") + pill stack + action button
   * cluster (View on map · Refine with AI · Edit block · Add planting).
   *
   * Action callbacks all optional — parent wires them to whatever
   * legacy flows /plan still owns. Provided as buttons (not anchors)
   * so the consumer can route them however it likes (navigate, open
   * a Modal, etc.).
   */
  import { Map, Sprout, Wrench, Plus, Layers } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';

  interface Props {
    block: BlockWithPlantings;
    /** Optional: shows the harvest-window summary pill when known. */
    harvestWindowLabel?: string;
    /** Status pill content + tone. */
    statusLabel?: string;
    statusTone?: 'forest' | 'wheat' | 'rust' | 'sky' | 'neutral';
    /** Optional action handlers. Buttons hide when handler is null. */
    onOpenMap?: () => void;
    onRefineWithAi?: () => void;
    onEditBlock?: () => void;
    onAddPlanting?: () => void;
  }
  const {
    block,
    harvestWindowLabel,
    statusLabel,
    statusTone = 'forest',
    onOpenMap,
    onRefineWithAi,
    onEditBlock,
    onAddPlanting
  }: Props = $props();

  const isPoly = $derived(block.plantings.length > 1);
  const cropSummary = $derived.by(() => {
    if (block.plantings.length === 0) return 'No plantings yet';
    if (block.plantings.length === 1) return block.plantings[0].varietyDisplayName;
    return `${block.plantings.length} plantings · ${block.plantings
      .slice(0, 2)
      .map((p) => p.varietyDisplayName)
      .join(', ')}…`;
  });
  const kickerText = $derived.by(() => {
    const ac = block.acres !== undefined ? `${block.acres} ac` : 'no acres recorded';
    const polyLabel = isPoly
      ? `${block.plantings.length} plantings`
      : block.plantings.length === 1
        ? 'single planting'
        : 'empty block';
    return `Block · ${ac} · ${polyLabel}`;
  });
</script>

<header class="bh">
  <div class="bh-left">
    <Kicker>{kickerText}</Kicker>
    <h1 class="serif title">
      {block.name} <span class="dash">—</span>
      <span class="crop-name">{cropSummary}</span>
    </h1>
    <div class="pills">
      {#if isPoly}
        <Pill tone="forest">
          <Layers size={10} strokeWidth={1.75} />
          Polyculture
        </Pill>
      {/if}
      {#if block.acres !== undefined}
        <Pill tone="neutral">{block.acres} ac</Pill>
      {/if}
      {#if harvestWindowLabel}
        <Pill tone="wheat">Harvest {harvestWindowLabel}</Pill>
      {/if}
      {#if statusLabel}
        <Pill tone={statusTone}>{statusLabel}</Pill>
      {/if}
    </div>
  </div>
  <div class="bh-actions">
    {#if onOpenMap}
      <button class="ghost" onclick={onOpenMap} title="View this block on the field map">
        <Map size={14} strokeWidth={1.75} /> View on map
      </button>
    {/if}
    {#if onRefineWithAi}
      <button class="ghost" onclick={onRefineWithAi} title="Open the season-plan chat with this block in context">
        <Sprout size={14} strokeWidth={1.75} /> Refine with AI
      </button>
    {/if}
    {#if onEditBlock}
      <button class="ghost" onclick={onEditBlock}>
        <Wrench size={14} strokeWidth={1.75} /> Edit block
      </button>
    {/if}
    {#if onAddPlanting}
      <button class="primary" onclick={onAddPlanting}>
        <Plus size={14} strokeWidth={1.75} /> Add planting
      </button>
    {/if}
  </div>
</header>

<style>
  .bh {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 18px;
    gap: 16px;
    flex-wrap: wrap;
  }
  .bh-left {
    flex: 1;
    min-width: 0;
  }
  .title {
    margin: 6px 0 0;
    font-size: 30px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
    line-height: 1.1;
    font-family: var(--font-serif, serif);
  }
  .dash {
    color: var(--color-ink-muted);
    font-weight: 400;
  }
  .crop-name {
    color: var(--color-ink-soft);
    font-weight: 500;
  }
  .pills {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .bh-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .ghost,
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    border: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-forest-deep);
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
    background: var(--color-cream);
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border-color: var(--color-forest);
  }
  .primary:hover {
    background: var(--color-forest-deep);
    border-color: var(--color-forest-deep);
  }
  @media (max-width: 700px) {
    .title {
      font-size: 24px;
    }
  }
</style>
