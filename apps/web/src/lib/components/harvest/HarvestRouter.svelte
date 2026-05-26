<script lang="ts">
  import {
    resolveArchetype,
    type Archetype,
    type HarvestStyle
  } from '$lib/plugins/schemas';
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

  /**
   * Phase 25c (#88) — HarvestRouter.
   * Phase 27A (#257) — dispatch on explicit `archetype` instead of the
   * inferred `harvestStyle`. The planting-level `archetypeOverride`
   * takes priority over the plugin's declared archetype so operators can
   * route a corn planting through `forage-cutting-cycle` (silage) rather
   * than `row-grain.pollination` (grain) without editing the plugin.
   *
   * Resolution order, via `resolveArchetype()` in plugin-validation:
   *   1. `archetypeOverride` prop (planting-level operator override)
   *   2. `archetype` prop (plugin-declared explicit value)
   *   3. legacy `harvestStyle` 1:1 map (10:1 except `single-event`)
   *   4. `cropFamily` fallback (family-keyed table)
   *
   * `FallbackHarvestRenderer` is now defensive-only — `resolveArchetype()`
   * always returns one of the 10 canonical values. The fallback survives
   * for the missing-data case (no plugin + no override) so a planting
   * with corrupted metadata still renders.
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
    onCommit: (input: { quantity?: string; lotNumber?: string }) => Promise<string | null>;
    error?: string | null;
    onCancel: () => void;
  }

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
    onCancel: props.onCancel
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
