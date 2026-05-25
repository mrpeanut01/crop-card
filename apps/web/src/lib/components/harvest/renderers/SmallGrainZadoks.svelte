<script lang="ts">
  import { Wheat } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';

  /**
   * Phase 25c (#88) — small-grain single-cut harvest renderer.
   *
   * Cereal grains (wheat, barley, oats, rye, broomcorn). Single-event
   * harvest at Zadoks stage Z89 (full ripeness, ~12-14% moisture for
   * malt barley, 13.5% for wheat). Adds a wheat-themed header + a
   * grain-moisture hint above the generic form.
   *
   * Future enhancement: read `crop.zadoksStages` + `crop.moistureGates`
   * from the plugin (both already in the schema) to show the operator
   * which Zadoks stage we expect them to be at + the moisture threshold
   * for the next operation (windrow vs combine vs bin). For now the
   * renderer's role is to differentiate the chrome + reuse the shared
   * commit form via FallbackHarvestRenderer.
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

<div class="grain-renderer">
  <header class="archetype-head">
    <Wheat size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Small-grain harvest</span>
      <span class="archetype-sub">
        Single cut at Z89 (full ripeness). Check moisture before binning.
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
  .grain-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(212, 167, 92, 0.12);
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
