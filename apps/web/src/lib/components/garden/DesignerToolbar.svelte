<script lang="ts">
  import { BED_PRESETS } from '$lib/garden/geometry';
  import type { BedPresetId } from '$lib/garden/types';
  import { getDesigner } from './designerState.svelte';

  interface Props {
    oncustom: () => void;
  }

  const { oncustom }: Props = $props();
  const d = getDesigner();

  const PRESET_ORDER: BedPresetId[] = [
    'raised-4x8',
    'in-ground-3x10',
    'row-30in',
    'container-5gal',
    'custom'
  ];
  const PRESET_LABEL: Record<BedPresetId, string> = {
    'raised-4x8': '4×8 raised',
    'in-ground-3x10': '3×10 in-ground',
    'row-30in': '30 in row',
    'container-5gal': '5 gal container',
    custom: 'Custom'
  };

  const bed = $derived(d.selectedBed);
  const planting = $derived(d.selectedPlanting);

  function preset(id: BedPresetId): void {
    if (id === 'custom') oncustom();
    else d.choosePreset(id);
  }
</script>

{#if d.canEdit}
  {#if d.mode.kind === 'place-bed' || d.mode.kind === 'move-bed' || d.mode.kind === 'place-crop' || d.mode.kind === 'move-planting'}
    <div class="bar banner floating" role="region" aria-label="Placing">
      <span class="banner-text" data-testid="placing-banner">
        {#if d.mode.kind === 'place-bed'}
          Tap the garden where the {BED_PRESETS[d.mode.presetId].label} goes, or choose {PRESET_LABEL[
            d.mode.presetId
          ]} again for the first open spot.
        {:else if d.mode.kind === 'move-bed'}
          Tap where {d.bed(d.mode.blockId)?.name}'s top-left corner should go.
        {:else if d.mode.kind === 'place-crop'}
          Tap a bed to place {d.mode.crop.label}
        {:else}
          Tap where the planting should go.
        {/if}
      </span>
      {#if d.mode.kind === 'place-bed'}
        <button
          type="button"
          class="tb"
          onclick={() =>
            d.mode.kind === 'place-bed' &&
            d.choosePreset(d.mode.presetId, { widthFt: d.mode.widthFt, lengthFt: d.mode.lengthFt })}
        >
          First open spot
        </button>
      {/if}
      <button type="button" class="tb" onclick={() => d.cancelMode()}>Cancel</button>
    </div>
  {/if}
  {#if bed && (d.mode.kind === 'idle' || d.mode.kind === 'carry-bed')}
    <div
      class="bar floating"
      role="toolbar"
      aria-label="{bed.name} actions"
      data-testid="bed-toolbar"
    >
      {#if planting && planting.blockId === bed.blockId}
        <span class="what">{planting.varietyDisplayName}</span>
        <button type="button" class="tb" onclick={() => d.startMovePlanting(planting.cropId)}
          >Move</button
        >
        <button type="button" class="tb" onclick={() => (d.selectedCropId = null)}>Bed</button>
      {:else}
        <span class="what">{bed.name}</span>
        <button type="button" class="tb" onclick={() => d.startMove(bed.blockId)}>Move</button>
        <button type="button" class="tb" onclick={() => d.turnBed(bed.blockId)}>Turn</button>
        <button type="button" class="tb" onclick={() => d.duplicateBed(bed.blockId)}
          >Duplicate</button
        >
        <button type="button" class="tb" onclick={() => d.sizeRequest++}>Size</button>
        <button type="button" class="tb" onclick={() => d.renameRequest++}>Rename</button>
        <button type="button" class="tb" onclick={() => d.openCropPanel(bed.blockId)}
          >Add crop</button
        >
        <button type="button" class="tb danger" onclick={() => d.askDelete(bed.blockId)}
          >Delete</button
        >
      {/if}
      <button type="button" class="tb" onclick={() => d.selectBed(null)}>Done</button>
    </div>
  {:else if !bed && (d.mode.kind === 'idle' || d.mode.kind === 'place-bed')}
    <div class="bar" role="toolbar" aria-label="Add a bed" data-testid="preset-bar">
      {#each PRESET_ORDER as id (id)}
        <button
          type="button"
          class="tb"
          aria-pressed={d.mode.kind === 'place-bed' && d.mode.presetId === id}
          onclick={() => preset(id)}
        >
          {PRESET_LABEL[id]}
        </button>
      {/each}
      <button type="button" class="tb" onclick={() => d.openCropPanel(null)}>Add crop</button>
    </div>
  {/if}
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }
  .banner {
    padding: var(--space-2);
    border-radius: var(--radius-input);
    background: var(--pill-wheat-bg);
    border: 1px solid var(--pill-wheat-bd);
  }
  .banner-text {
    flex: 1 1 200px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .what {
    font-weight: 700;
    color: var(--color-forest-deep);
    margin-right: var(--space-1);
    overflow-wrap: anywhere;
  }
  .tb {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
    font-size: var(--font-size-body);
  }
  .tb[aria-pressed='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
    color: var(--pill-forest-fg);
  }
  .tb.danger {
    color: var(--color-rust);
  }
  .tb:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  @media (max-width: 639px) {
    .floating {
      position: fixed;
      left: 8px;
      right: 8px;
      bottom: calc(72px + env(safe-area-inset-bottom, 0px));
      z-index: 30;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: var(--space-2);
      border-radius: var(--radius-input);
      background: var(--color-paper);
      border: 1px solid var(--color-divider);
      box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.16);
    }
    .floating.banner {
      flex-wrap: wrap;
      background: var(--pill-wheat-bg);
    }
    .floating .tb {
      flex: 0 0 auto;
    }
  }
</style>
