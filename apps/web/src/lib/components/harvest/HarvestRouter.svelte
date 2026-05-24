<script lang="ts">
  import type { HarvestStyle } from '$lib/plugins/schemas';
  import FallbackHarvestRenderer from './renderers/FallbackHarvestRenderer.svelte';
  import SmallGrainZadoks from './renderers/SmallGrainZadoks.svelte';
  import ContinuousHarvestFruit from './renderers/ContinuousHarvestFruit.svelte';
  import ForageCuttingCycle from './renderers/ForageCuttingCycle.svelte';

  /**
   * Phase 25c (#88) — HarvestRouter.
   *
   * Dispatches a planting's harvest UI based on the crop plugin's
   * `harvestStyle` discriminator (Phase 25c.0 #87 promoted this to
   * required at 100% coverage, so the fallback is defensive only).
   *
   * Phase 25c ships 3 representative renderers + the dispatch
   * primitive; the remaining 7 archetypes (DrySeedLegume, WinterSquashCure,
   * CutAndComeAgainLeafy, CoverCropTermination, PerennialVineQuality,
   * TreeFruitMultiPick, RowGrainPollinated) ship as one-per-PR
   * follow-ups against this dispatch.
   *
   * Each renderer receives the same `RendererProps` so swapping
   * implementations doesn't require touching the parent. The renderer
   * owns the form + submit; the parent owns the recordingFor state +
   * reload.
   */

  export interface RendererProps {
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
    /** Caller-provided commit hook. Receives the form data + returns
     *  the new event id (or null on failure). Parent handles the
     *  invalidate + UI reset. */
    onCommit: (input: { quantity?: string; lotNumber?: string }) => Promise<string | null>;
    /** Surfaced under the form when the operator's last commit attempt
     *  failed. Parent owns the string; the renderer just displays it. */
    error?: string | null;
    onCancel: () => void;
  }

  interface Props extends RendererProps {
    /** Source of truth for which renderer to dispatch. When undefined
     *  (pre-Phase 25c.0 plugins or unrecognized future styles) we fall
     *  through to FallbackHarvestRenderer. */
    harvestStyle?: HarvestStyle;
  }

  const props: Props = $props();
</script>

{#if props.harvestStyle === 'single-cut-grain'}
  <SmallGrainZadoks
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
{:else if props.harvestStyle === 'continuous-fruit'}
  <ContinuousHarvestFruit
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
{:else if props.harvestStyle === 'forage-cutting-cycle'}
  <ForageCuttingCycle
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
{:else}
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
{/if}
