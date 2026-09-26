<script lang="ts">
  import { BED_PRESETS } from '$lib/garden/geometry';
  import { shortDate } from '$lib/garden/occupancy';
  import type { BedPresetId } from '$lib/garden/types';
  import BedInspector from './BedInspector.svelte';
  import { getDesigner } from './designerState.svelte';
  import { bedKindLabel, ft, sizeLabel } from './format';

  interface Props {
    oncustom: () => void;
  }

  const { oncustom }: Props = $props();
  const d = getDesigner();

  const beds = $derived(
    [...d.beds].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  );
  let addOpen = $state(false);
  const PRESETS: BedPresetId[] = [
    'raised-4x8',
    'in-ground-3x10',
    'row-30in',
    'container-5gal',
    'custom'
  ];

  function openFrom(blockId: string): string {
    const occ = d.occupancy.get(blockId);
    if (!occ) return '';
    if (occ.occupants.length === 0)
      return occ.openSinceMs != null ? `Open from ${shortDate(occ.openSinceMs)}` : 'Open';
    return occ.nextOpenMs != null ? `Opens ${shortDate(occ.nextOpenMs)}` : 'Full';
  }

  function inIt(blockId: string): string {
    const occ = d.occupancy.get(blockId);
    if (!occ || occ.occupants.length === 0) return 'Nothing';
    return occ.occupants
      .map((o) => {
        const p = d.design.plantings.find((q) => q.cropId === o.cropId);
        const stage = d.stageOf(o.cropId);
        return p ? `${p.varietyDisplayName}${stage ? ` (${stage.toLowerCase()})` : ''}` : '';
      })
      .filter(Boolean)
      .join(', ');
  }

  function toggle(blockId: string): void {
    d.selectBed(d.selectedBedId === blockId ? null : blockId);
  }

  async function add(id: BedPresetId): Promise<void> {
    addOpen = false;
    if (id === 'custom') oncustom();
    else await d.addBedAtFreeSpot(id);
  }
</script>

<div class="listview" data-testid="designer-list">
  {#if d.canEdit}
    <div class="add">
      <button type="button" class="btn" aria-expanded={addOpen} onclick={() => (addOpen = !addOpen)}
        >Add bed</button
      >
      {#if addOpen}
        <div class="presets" role="group" aria-label="Bed size">
          {#each PRESETS as id (id)}
            <button type="button" class="btn" onclick={() => add(id)}
              >{BED_PRESETS[id].label}</button
            >
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if beds.length === 0}
    <p class="empty">No beds yet.{d.canEdit ? ' Add one to start.' : ''}</p>
  {:else}
    <ul class="beds">
      {#each beds as bed (bed.blockId)}
        {@const open = d.selectedBedId === bed.blockId}
        <li class="bed" class:open data-testid="list-bed" data-bed-name={bed.name}>
          <button
            type="button"
            class="summary"
            aria-expanded={open}
            aria-controls="list-{bed.blockId}"
            onclick={() => toggle(bed.blockId)}
          >
            <span class="name">{bed.name}</span>
            <span class="cells">
              <span>{bedKindLabel(bed)}</span>
              <span>{sizeLabel(bed.widthFt, bed.lengthFt)}</span>
              <span>{ft(bed.rect.x)} ft from west, {ft(bed.rect.y)} ft from north</span>
              {#if bed.rotationDeg}<span>turned {bed.rotationDeg}°</span>{/if}
              <span data-testid="list-in-it">In it: {inIt(bed.blockId)}</span>
              <span data-testid="list-open">{openFrom(bed.blockId)}</span>
              {#if d.unplaced.has(bed.blockId)}<span>Not placed yet</span>{/if}
            </span>
          </button>
          {#if open}
            <div id="list-{bed.blockId}">
              <BedInspector {bed} idPrefix="list" />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .listview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .add,
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .btn {
    min-height: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
  }
  .beds {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .bed {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    overflow: hidden;
  }
  .bed.open {
    border-color: var(--color-rust);
  }
  .summary {
    width: 100%;
    min-height: 48px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 0;
    background: none;
    text-align: left;
    color: var(--color-ink);
  }
  .name {
    font-weight: 700;
    color: var(--color-forest-deep);
  }
  .cells {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .btn:focus-visible,
  .summary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
  }
</style>
