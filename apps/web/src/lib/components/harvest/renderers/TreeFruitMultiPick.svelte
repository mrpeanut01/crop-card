<script lang="ts">
  import { TreeDeciduous } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';

  /**
   * Phase 25c (#88) — tree-fruit multi-pick renderer.
   *
   * Apple, pear, stone-fruit (peach, plum, cherry). Multiple ripening
   * passes per orchard — pickers walk the block 2-4 times across a
   * 2-3 week window picking only what's at color/firmness target on
   * each pass. The kicker calls out that this is a multi-pick model
   * (planting stays open) + reminds the operator to record per-pass
   * yield separately so the orchard's per-tree productivity tracks.
   */

  interface Props {
    plantingId: string;
    blockId: string;
    blockName: string;
    cropPluginId: string;
    varietyDisplayName: string;
    cropFamily?: string;
    plantingDate: number | null;
    windowStartMs?: number;
    windowEndMs?: number;
    harvestIndicators: string[];
    onCommit: (input: { quantity?: string; lotNumber?: string }) => Promise<string | null>;
    error?: string | null;
    onCancel: () => void;
  }

  const props: Props = $props();
</script>

<div class="tree-renderer">
  <header class="archetype-head">
    <TreeDeciduous size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Tree-fruit multi-pick harvest</span>
      <span class="archetype-sub">
        Multiple ripening passes — pick only what's at color/firmness target each pass. Record this
        pass's yield; the planting stays open across the 2-3 week window.
      </span>
    </div>
  </header>

  <FallbackHarvestRenderer
    plantingId={props.plantingId}
    blockId={props.blockId}
    blockName={props.blockName}
    cropPluginId={props.cropPluginId}
    varietyDisplayName={props.varietyDisplayName}
    cropFamily={props.cropFamily}
    plantingDate={props.plantingDate}
    windowStartMs={props.windowStartMs}
    windowEndMs={props.windowEndMs}
    harvestIndicators={props.harvestIndicators}
    onCommit={props.onCommit}
    error={props.error}
    onCancel={props.onCancel}
  />
</div>

<style>
  .tree-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(214, 92, 64, 0.14);
    border-left: 3px solid #c75634;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #c75634;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .archetype-head > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .archetype-name {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .archetype-sub {
    font-size: 12px;
    color: var(--color-ink-soft);
    line-height: 1.35;
  }
</style>
