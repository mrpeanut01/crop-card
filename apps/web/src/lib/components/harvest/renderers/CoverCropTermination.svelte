<script lang="ts">
  import { Zap } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';

  /**
   * Phase 25c (#88) — cover-crop termination renderer.
   *
   * Cereal rye, vetch (hairy + crown), tillage radish, phacelia,
   * buckwheat cover, sorghum-sudan summer cover, brassica covers
   * (mustard, tillage radish). The "harvest" event is the kill-and-
   * roll pass: roller-crimper, mow + flame, or herbicide burndown
   * 14-21 days before the next cash crop is planted on this block.
   *
   * The kicker reminds the operator to log the termination method +
   * residue cover estimate. Termination timing drives Phase 25d's
   * cover-credit fertility math.
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

<div class="terminate-renderer">
  <header class="archetype-head">
    <Zap size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Cover-crop termination</span>
      <span class="archetype-sub">
        Kill-and-roll pass 14-21 days before the next cash crop. Log the method (crimp / mow /
        burndown) + residue cover in the notes for the cover-credit fertility math.
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
  .terminate-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(106, 150, 105, 0.14);
    border-left: 3px solid #4f7a4f;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #4f7a4f;
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
