<script lang="ts">
  import { pageCropName } from '$lib/i18n/pageCropName';
  import type { BedPresetId } from '$lib/garden/types';
  import type { MessageKey } from '$lib/i18n';
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
  const tr = $derived(d.tr);
  const presetShort = (id: BedPresetId): string => tr(`garden.preset.short.${id}` as MessageKey);
  const presetThe = (id: BedPresetId): string => tr(`garden.preset.the.${id}` as MessageKey);

  const bed = $derived(d.selectedBed);
  const planting = $derived(d.selectedPlanting);

  function preset(id: BedPresetId): void {
    if (id === 'custom') oncustom();
    else d.choosePreset(id);
  }
</script>

{#if d.canEdit}
  {#if d.mode.kind === 'place-bed' || d.mode.kind === 'move-bed' || d.mode.kind === 'place-crop' || d.mode.kind === 'move-planting'}
    <div class="bar banner floating" role="region" aria-label={tr('garden.placing.aria')}>
      <span class="banner-text" data-testid="placing-banner">
        {#if d.mode.kind === 'place-bed'}
          {tr('garden.placing.bed', {
            preset: presetThe(d.mode.presetId),
            short: presetShort(d.mode.presetId)
          })}
        {:else if d.mode.kind === 'move-bed'}
          {tr('garden.placing.moveBed', { name: d.bed(d.mode.blockId)?.name ?? '' })}
        {:else if d.mode.kind === 'place-crop'}
          {tr('garden.placing.crop', { label: d.mode.crop.label })}
        {:else}
          {tr('garden.placing.planting')}
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
          {tr('garden.toolbar.firstSpot')}
        </button>
      {/if}
      <button type="button" class="tb" onclick={() => d.cancelMode()}
        >{tr('garden.common.cancel')}</button
      >
    </div>
  {/if}
  {#if bed && (d.mode.kind === 'idle' || d.mode.kind === 'carry-bed')}
    <div
      class="bar floating"
      role="toolbar"
      aria-label={tr('garden.toolbar.actions', { name: bed.name })}
      data-testid="bed-toolbar"
    >
      {#if planting && planting.blockId === bed.blockId}
        <span class="what">{pageCropName(planting.cropPluginId, planting.varietyDisplayName)}</span>
        <button type="button" class="tb" onclick={() => d.startMovePlanting(planting.cropId)}
          >{tr('garden.common.move')}</button
        >
        <button type="button" class="tb" onclick={() => (d.selectedCropId = null)}
          >{tr('garden.toolbar.bed')}</button
        >
      {:else}
        <span class="what">{bed.name}</span>
        <button type="button" class="tb" onclick={() => d.startMove(bed.blockId)}
          >{tr('garden.common.move')}</button
        >
        <button type="button" class="tb" onclick={() => d.turnBed(bed.blockId)}
          >{tr('garden.common.turn')}</button
        >
        <button type="button" class="tb" onclick={() => d.duplicateBed(bed.blockId)}
          >{tr('garden.common.duplicate')}</button
        >
        <button type="button" class="tb" onclick={() => d.sizeRequest++}
          >{tr('garden.common.size')}</button
        >
        <button type="button" class="tb" onclick={() => d.renameRequest++}
          >{tr('garden.common.rename')}</button
        >
        <button type="button" class="tb" onclick={() => d.openCropPanel(bed.blockId)}
          >{tr('garden.common.addCrop')}</button
        >
        <button type="button" class="tb danger" onclick={() => d.askDelete(bed.blockId)}
          >{tr('garden.common.delete')}</button
        >
      {/if}
      <button type="button" class="tb" onclick={() => d.selectBed(null)}
        >{tr('garden.common.done')}</button
      >
    </div>
  {:else if !bed && (d.mode.kind === 'idle' || d.mode.kind === 'place-bed')}
    <div
      class="bar"
      role="toolbar"
      aria-label={tr('garden.toolbar.addBed')}
      data-testid="preset-bar"
      data-hint-anchor="garden_designer"
    >
      {#each PRESET_ORDER as id (id)}
        <button
          type="button"
          class="tb"
          aria-pressed={d.mode.kind === 'place-bed' && d.mode.presetId === id}
          onclick={() => preset(id)}
        >
          {presetShort(id)}
        </button>
      {/each}
      <button type="button" class="tb" onclick={() => d.openCropPanel(null)}
        >{tr('garden.common.addCrop')}</button
      >
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
    .floating .what {
      flex: 0 0 auto;
      max-width: 9rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      overflow-wrap: normal;
    }
  }
</style>
