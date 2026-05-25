<script lang="ts">
  import { Grape } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';

  /**
   * Phase 25c (#88) — perennial vine quality renderer.
   *
   * Grape (wine, table, juice), hops, kiwi. Quality-anchored single
   * harvest window — for wine grapes that means Brix + pH + TA
   * triplet at the target. Hops harvest at aroma-cone shatter test.
   * The kicker reminds the operator to log the quality reading along
   * with weight so vintage tracking has the agronomic context.
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

<div class="vine-renderer">
  <header class="archetype-head">
    <Grape size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Perennial-vine quality harvest</span>
      <span class="archetype-sub">
        Quality-anchored single window. Log Brix / pH / aroma-test reading in notes — vintage
        tracking + buyer payments rely on it.
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
  .vine-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(126, 78, 138, 0.14);
    border-left: 3px solid #6a3f7d;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #6a3f7d;
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
