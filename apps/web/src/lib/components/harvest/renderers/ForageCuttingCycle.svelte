<script lang="ts">
  import { Scissors } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';

  /**
   * Phase 25c (#88) — forage cutting-cycle renderer.
   *
   * Perennial forage (alfalfa, clover, orchard-grass, timothy). Multi-
   * cut model: typically 2-4 cuttings per season at 28-35 day intervals.
   * Each cut sets the regrowth timer for the next. The kicker reminds
   * the operator to check the 3-day weather window before mowing (per
   * the FR-22 NOAA forecast hook) — wet hay is the #1 forage failure.
   *
   * Future enhancement: read `crop.hayOperations.cuttingsPerSeason` +
   * `cutIntervalDays` from the plugin, count completed cuts against
   * the planting year, surface "cutting 2 of 3" + days-since-last-cut.
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

<div class="forage-renderer">
  <header class="archetype-head">
    <Scissors size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Forage cutting cycle</span>
      <span class="archetype-sub">
        Multi-cut perennial. Check the 3-day weather window before mowing — wet hay molds in the
        bale.
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
  .forage-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(44, 82, 55, 0.08);
    border-left: 3px solid var(--color-forest-deep, #2c5237);
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: var(--color-forest-deep, #2c5237);
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
