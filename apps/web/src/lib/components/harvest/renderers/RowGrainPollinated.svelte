<script lang="ts">
  import { Wheat } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';

  /**
   * Phase 25c (#88) — row-grain pollinated renderer (corn).
   *
   * Wind-pollinated grain on a row spacing. Different stages (sweet
   * vs dent vs popcorn) target different Reproductive stages — R3
   * (milk stage, ~78-88 DAP) for sweet corn at fresh-eating moisture,
   * R6 (black layer, ~110-130 DAP) for dent corn at full grain fill.
   * The kicker reminds the operator which stage to target based on
   * the crop's `cornType` discriminator.
   */

  import type { RendererProps } from './types';

  const props: RendererProps = $props();
</script>

<div class="corn-renderer">
  <header class="archetype-head">
    <Wheat size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Row-grain harvest</span>
      <span class="archetype-sub">
        Wind-pollinated. Sweet corn at R3 (milk); dent / popcorn at R6 (black layer + dry-down).
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
  .corn-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(212, 167, 92, 0.18);
    border-left: 3px solid var(--color-wheat, #d4a75c);
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: var(--color-wheat, #d4a75c);
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
