<script lang="ts">
  import { resolveArchetype, type Archetype, type HarvestStyle } from '$lib/plugins/schemas';
  import type { RendererData, RendererProps } from './renderers/types';
  import FallbackHarvestRenderer from './renderers/FallbackHarvestRenderer.svelte';
  import SmallGrainZadoks from './renderers/SmallGrainZadoks.svelte';
  import ContinuousHarvestFruit from './renderers/ContinuousHarvestFruit.svelte';
  import ForageCuttingCycle from './renderers/ForageCuttingCycle.svelte';
  import RowGrainPollinated from './renderers/RowGrainPollinated.svelte';
  import CutAndComeAgainLeafy from './renderers/CutAndComeAgainLeafy.svelte';
  import DrySeedLegume from './renderers/DrySeedLegume.svelte';
  import WinterSquashCure from './renderers/WinterSquashCure.svelte';
  import CoverCropTermination from './renderers/CoverCropTermination.svelte';
  import PerennialVineQuality from './renderers/PerennialVineQuality.svelte';
  import TreeFruitMultiPick from './renderers/TreeFruitMultiPick.svelte';

  // resolveArchetype() order: archetypeOverride > archetype > harvestStyle (legacy) > cropFamily fallback.

  interface Props extends RendererProps {
    /** Plugin-declared archetype (Phase 27A, preferred). */
    archetype?: Archetype;
    /** Per-planting operator override (Sprint 6 / Phase 27A migration
     *  0039). Takes priority over the plugin's declared archetype. */
    archetypeOverride?: Archetype | null;
    /** Legacy discriminator. Kept for plugins authored before Phase 27A
     *  ships the explicit field; `resolveArchetype()` derives from this. */
    harvestStyle?: HarvestStyle;
  }

  const props: Props = $props();

  // Override wins over plugin field wins over derivation. $derived so a
  // reactive parent (e.g. operator flips archetypeOverride mid-session)
  // re-dispatches without remounting the whole HarvestRouter tree.
  const resolved: Archetype = $derived(
    resolveArchetype({
      archetype: props.archetypeOverride ?? props.archetype ?? undefined,
      harvestStyle: props.harvestStyle,
      cropFamily: props.cropFamily
    })
  );

  // Strip the dispatch-only fields when handing off to the renderer.
  const rendererProps: RendererProps = $derived({
    plantingId: props.plantingId,
    blockId: props.blockId,
    blockName: props.blockName,
    cropPluginId: props.cropPluginId,
    varietyDisplayName: props.varietyDisplayName,
    cropFamily: props.cropFamily,
    plantingDate: props.plantingDate,
    windowStartMs: props.windowStartMs,
    windowEndMs: props.windowEndMs,
    harvestIndicators: props.harvestIndicators,
    onCommit: props.onCommit,
    error: props.error,
    onCancel: props.onCancel,
    rendererData: props.rendererData
  });
</script>

{#if resolved === 'small-grain.zadoks'}
  <SmallGrainZadoks {...rendererProps} />
{:else if resolved === 'row-grain.pollination'}
  <RowGrainPollinated {...rendererProps} />
{:else if resolved === 'dry-seed-legume'}
  <DrySeedLegume {...rendererProps} />
{:else if resolved === 'winter-squash-cure'}
  <WinterSquashCure {...rendererProps} />
{:else if resolved === 'continuous-harvest-fruit'}
  <ContinuousHarvestFruit {...rendererProps} />
{:else if resolved === 'cut-and-come-again-leafy'}
  <CutAndComeAgainLeafy {...rendererProps} />
{:else if resolved === 'cover-crop.termination'}
  <CoverCropTermination {...rendererProps} />
{:else if resolved === 'forage-cutting-cycle'}
  <ForageCuttingCycle {...rendererProps} />
{:else if resolved === 'perennial-vine-quality'}
  <PerennialVineQuality {...rendererProps} />
{:else if resolved === 'tree-fruit-multi-pick'}
  <TreeFruitMultiPick {...rendererProps} />
{:else}
  <FallbackHarvestRenderer {...rendererProps} />
{/if}
