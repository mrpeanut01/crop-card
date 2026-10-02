<script lang="ts">
  import { pageCropName } from '$lib/i18n/pageCropName';
  import type { BedPresetId } from '$lib/garden/types';
  import type { MessageKey } from '$lib/i18n';
  import { getDesigner, type DesignerMode } from './designerState.svelte';

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

  const DRAG_START_PX = 6;
  const HOLD_MS = 350;
  const EDGE_PX = 56;
  const MAX_SCROLL_PX = 18;
  const CHIP_GAP_PX = 12;
  const GUTTER_PX = 16;

  const draggable = $derived(d.canEdit && d.view === 'canvas');
  let press: {
    id: number;
    touch: boolean;
    x: number;
    y: number;
    presetId: BedPresetId;
    timer: ReturnType<typeof setTimeout> | null;
    ox: number;
    oy: number;
    travelled: boolean;
    prior: DesignerMode;
  } | null = null;
  let suppressClick = false;

  function preset(id: BedPresetId): void {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (id === 'custom') oncustom();
    else d.choosePreset(id);
  }

  function onChipPointerDown(e: PointerEvent, id: BedPresetId): void {
    if (!draggable || press || id === 'custom') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const touch = e.pointerType !== 'mouse';
    press = {
      id: e.pointerId,
      touch,
      x: e.clientX,
      y: e.clientY,
      presetId: id,
      timer: null,
      ox: e.clientX,
      oy: e.clientY,
      travelled: false,
      prior: d.mode
    };
    if (touch) {
      press.timer = setTimeout(onHold, HOLD_MS);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
    }
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  }

  function onHold(): void {
    if (!press) return;
    press.timer = null;
    if (!d.startBedDrag(press.presetId, press.x, press.y)) end();
  }

  function onTouchMove(e: TouchEvent): void {
    if (d.bedDrag && e.cancelable) e.preventDefault();
  }

  function onMove(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    if (!d.bedDrag) {
      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) >= DRAG_START_PX;
      if (press.touch) {
        if (moved) end();
        else {
          press.x = e.clientX;
          press.y = e.clientY;
        }
        return;
      }
      if (!moved) return;
      if (!d.startBedDrag(press.presetId, e.clientX, e.clientY)) return end();
    }
    e.preventDefault();
    if (Math.hypot(e.clientX - press.ox, e.clientY - press.oy) >= DRAG_START_PX) {
      press.travelled = true;
    }
    d.moveBedDrag(e.clientX, e.clientY);
    edgeX = e.clientX;
    edgeY = e.clientY;
    if (edgeSpeed(edgeY) !== 0 && scrollFrame === null) {
      scrollFrame = requestAnimationFrame(autoScroll);
    }
  }

  let edgeX = 0;
  let edgeY = 0;
  let scrollFrame: number | null = null;

  function edgeSpeed(y: number): number {
    const bottom = window.innerHeight - bottomInset();
    if (y < EDGE_PX) return -Math.ceil(((EDGE_PX - y) / EDGE_PX) * MAX_SCROLL_PX);
    if (y > bottom - EDGE_PX)
      return Math.ceil(((y - (bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_PX);
    return 0;
  }

  function bottomInset(): number {
    const nav = document.querySelector('.primary-nav');
    if (!nav || getComputedStyle(nav).position !== 'fixed') return 0;
    return Math.max(0, window.innerHeight - nav.getBoundingClientRect().top);
  }

  function autoScroll(): void {
    scrollFrame = null;
    if (!press || !d.bedDrag) return;
    const dy = edgeSpeed(edgeY);
    if (dy === 0) return;
    const before = window.scrollY;
    window.scrollBy(0, dy);
    if (window.scrollY === before) return;
    d.moveBedDrag(edgeX, edgeY);
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onUp(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    if (d.bedDrag) {
      suppressNextClick();
      const still = Math.hypot(e.clientX - press.ox, e.clientY - press.oy) < DRAG_START_PX;
      if (press.touch && !press.travelled && still) {
        d.tapAfterHold(press.presetId, press.prior);
        return end();
      }
      d.moveBedDrag(e.clientX, e.clientY);
      void d.dropBed();
    }
    end();
  }

  function onCancel(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    d.cancelBedDrag();
    end();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !d.bedDrag) return;
    e.preventDefault();
    d.cancelBedDrag();
    suppressClick = true;
    window.addEventListener('pointerup', () => setTimeout(() => (suppressClick = false), 0), {
      once: true
    });
    end();
  }

  function suppressNextClick(): void {
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  }

  function onContextMenu(e: Event): void {
    if (press?.touch || d.bedDrag) e.preventDefault();
  }

  function end(): void {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
  }

  $effect(() => () => {
    end();
    d.cancelBedDrag();
  });

  let viewportW = $state(0);
  let chipW = $state(0);

  function chipLeft(x: number): number {
    const max = viewportW - GUTTER_PX - chipW;
    const right = x + CHIP_GAP_PX;
    const left = right <= max ? right : x - CHIP_GAP_PX - chipW;
    return Math.max(GUTTER_PX, Math.min(left, max));
  }
</script>

<svelte:window bind:innerWidth={viewportW} />

{#if d.bedDrag}
  <div
    class="drag-chip"
    class:nofit={!!d.bedDrag.rect && !d.bedDrag.fits}
    aria-hidden="true"
    data-testid="bed-drag-chip"
    bind:offsetWidth={chipW}
    style:left="{chipLeft(d.bedDrag.clientX)}px"
    style:top="{d.bedDrag.clientY}px"
  >
    {d.bedDrag.rect && !d.bedDrag.fits
      ? tr('garden.crop.noRoomHere')
      : presetShort(d.bedDrag.presetId)}
  </div>
{/if}

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
          class:chip={id !== 'custom'}
          data-preset-id={id}
          aria-pressed={d.mode.kind === 'place-bed' && d.mode.presetId === id}
          onclick={() => preset(id)}
          onpointerdown={(e) => onChipPointerDown(e, id)}
          oncontextmenu={onContextMenu}
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
  .tb.chip {
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .drag-chip {
    position: fixed;
    z-index: 60;
    transform: translateY(-140%);
    max-width: min(260px, calc(100vw - 32px));
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-input);
    background: var(--color-forest);
    color: #fff;
    font-weight: 600;
    font-size: var(--font-size-caption);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .drag-chip.nofit {
    background: var(--color-rust);
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
