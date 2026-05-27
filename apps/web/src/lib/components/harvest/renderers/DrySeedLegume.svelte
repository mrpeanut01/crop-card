<script lang="ts">
  import { Sprout } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';

  /**
   * Phase 25c (#88) — dry-seed legume renderer.
   *
   * Cowpea, soup beans (cherokee, black turtle, kidney, navy, pinto),
   * lentil, soybean grain, field pea. Single threshing pass at full
   * senescence (~13-15% moisture for storage). The kicker reminds
   * the operator to test moisture before storing — wet beans heat in
   * the bin and rot.
   */

  import type { RendererProps } from './types';

  const props: RendererProps = $props();
</script>

<div class="dry-legume-renderer">
  <header class="archetype-head">
    <Sprout size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Dry-seed legume harvest</span>
      <span class="archetype-sub">
        Threshing pass at full senescence. Test seed moisture (target 13-15%) before storage — wet
        beans heat + rot.
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
  .dry-legume-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(141, 174, 138, 0.14);
    border-left: 3px solid #8a7860;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #8a7860;
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
