<script lang="ts">
  import { resolveSpacing } from '$lib/garden/plantCount';
  import { familyLabel } from '$lib/garden/rotation';
  import type { GardenCrop } from '$lib/garden/types';
  import { getDesigner, type CropChoice } from './designerState.svelte';

  const d = getDesigner();
  const MAX_RESULTS = 40;
  const DRAG_START_PX = 6;

  const draggable = $derived(d.canEdit && d.view === 'canvas');
  let press: { id: number; x: number; y: number; choice: CropChoice } | null = null;
  let suppressClick = false;

  function onRowPointerDown(e: PointerEvent, choice: CropChoice): void {
    if (!draggable || press) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const onGrip = e.target instanceof Element && !!e.target.closest('[data-drag-grip]');
    if (e.pointerType !== 'mouse' && !onGrip) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, choice };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  }

  function onMove(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    if (!d.cropDrag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START_PX) return;
      if (!d.startCropDrag(press.choice, e.clientX, e.clientY)) return end();
    }
    e.preventDefault();
    d.moveCropDrag(e.clientX, e.clientY);
  }

  function onUp(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    if (d.cropDrag) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      void d.dropCrop();
    }
    end();
  }

  function onCancel(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    d.cancelCropDrag();
    end();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !d.cropDrag) return;
    e.preventDefault();
    d.cancelCropDrag();
    end();
  }

  function end(): void {
    press = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
  }

  function choose(choice: CropChoice): void {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    d.chooseCrop(choice);
  }

  $effect(() => end);

  let query = $state('');
  let input = $state<HTMLInputElement | null>(null);

  const target = $derived(d.cropTargetBedId ? d.bed(d.cropTargetBedId) : null);

  function rank(c: GardenCrop, q: string): number {
    if (!q) return 0;
    const name = c.displayName.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s—(),-]+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    if (
      c.cropFamily.toLowerCase().includes(q) ||
      familyLabel(c.cropFamily).toLowerCase().includes(q)
    )
      return 3;
    return -1;
  }

  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const recent = new Map(d.recentPluginIds.map((id, i) => [id, i]));
    return d.catalog
      .map((c) => ({ c, r: rank(c, q) }))
      .filter((m) => m.r >= 0)
      .sort((a, b) => {
        const ra = recent.get(a.c.pluginId) ?? Infinity;
        const rb = recent.get(b.c.pluginId) ?? Infinity;
        return ra - rb || a.r - b.r || a.c.displayName.localeCompare(b.c.displayName);
      })
      .map((m) => m.c);
  });
  const results = $derived(
    matches.slice(0, query.trim() || d.recentPluginIds.length ? MAX_RESULTS : 0)
  );

  const groups = $derived.by(() => {
    const out = new Map<string, GardenCrop[]>();
    for (const c of results) {
      const key = d.recentPluginIds.includes(c.pluginId)
        ? 'Recently used'
        : familyLabel(c.cropFamily);
      const list = out.get(key) ?? [];
      list.push(c);
      out.set(key, list);
    }
    return [...out.entries()];
  });

  function spacingText(c: GardenCrop): string {
    const s = resolveSpacing(c, 'square');
    return `${Math.round(s.inRowIn)} in apart`;
  }

  $effect(() => {
    if (d.cropPanelOpen) queueMicrotask(() => input?.focus());
  });
</script>

{#if d.cropDrag}
  <div
    class="drag-chip"
    class:nofit={d.cropDrag.ghost ? !d.cropDrag.ghost.fits : false}
    aria-hidden="true"
    data-testid="drag-chip"
    style:left="{d.cropDrag.clientX}px"
    style:top="{d.cropDrag.clientY}px"
  >
    {d.cropDrag.choice.label}{#if d.cropDrag.bedId}
      · {d.cropDrag.ghost?.fits ? d.bed(d.cropDrag.bedId)?.name : 'No room here'}{/if}
  </div>
{/if}

{#if d.cropPanelOpen}
  <section
    class="panel"
    class:dragging={!!d.cropDrag}
    aria-labelledby="crop-panel-title"
    data-testid="crop-panel"
  >
    <header class="head">
      <h2 id="crop-panel-title">
        {target ? `Add a crop to ${target.name}` : 'Add a crop'}
      </h2>
      <button type="button" class="close" onclick={() => (d.cropPanelOpen = false)}>Close</button>
    </header>

    {#if d.unplacedPlantings.length}
      <h3>This season</h3>
      <ul class="list">
        {#each d.unplacedPlantings as p (p.cropId)}
          {@const choice = {
            source: 'planting' as const,
            cropId: p.cropId,
            label: p.varietyDisplayName
          }}
          <li>
            <button
              type="button"
              class="row"
              class:draggable
              data-testid="crop-row"
              onpointerdown={(e) => onRowPointerDown(e, choice)}
              onclick={() => choose(choice)}
            >
              {#if draggable}<span
                  class="grip"
                  data-drag-grip
                  aria-hidden="true"
                  title="Drag onto a bed"
                ></span>{/if}
              <span class="name">{p.varietyDisplayName}</span>
              <span class="meta">
                {d.bed(p.blockId)?.name ?? ''}{p.plantingDateMs != null
                  ? ` · ${d.dateText(p.plantingDateMs)}`
                  : ' · no date'}{p.plantCount ? ` · ${p.plantCount} plants` : ''}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if draggable}
      <p class="how">Tap a crop, then tap a bed. Or drag it by its handle onto a bed.</p>
    {/if}
    <label class="search-label" for="crop-search">Search crops</label>
    <input
      id="crop-search"
      class="search"
      type="search"
      bind:this={input}
      bind:value={query}
      placeholder="Tomato, lettuce, beans"
      autocomplete="off"
    />
    {#if query.trim() && results.length === 0}
      <p class="empty">No crop matches "{query.trim()}".</p>
    {:else if query.trim() && matches.length > results.length}
      <p class="empty" data-testid="crop-results-cut">
        Showing {results.length} of {matches.length}. Keep typing to narrow it.
      </p>
    {/if}
    {#each groups as [family, crops] (family)}
      <h3>{family}</h3>
      <ul class="list">
        {#each crops as c (c.pluginId)}
          {@const choice = {
            source: 'catalog' as const,
            pluginId: c.pluginId,
            label: c.displayName
          }}
          <li>
            <button
              type="button"
              class="row"
              class:draggable
              data-testid="crop-row"
              onpointerdown={(e) => onRowPointerDown(e, choice)}
              onclick={() => choose(choice)}
            >
              {#if draggable}<span
                  class="grip"
                  data-drag-grip
                  aria-hidden="true"
                  title="Drag onto a bed"
                ></span>{/if}
              <span class="name">{c.displayName}</span>
              <span class="meta">
                {c.daysToMaturity
                  ? `${c.daysToMaturity.min}–${c.daysToMaturity.max} days`
                  : 'days unknown'} · {spacingText(c)}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  </section>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    max-height: 70vh;
    overflow-y: auto;
    min-width: 0;
  }
  @media (max-width: 639px) {
    .panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 40;
      max-height: 60vh;
      border-radius: var(--radius-card) var(--radius-card) 0 0;
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.18);
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-body-lg);
    color: var(--color-forest-deep);
  }
  h3 {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }
  .close,
  .row {
    min-height: 48px;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .close {
    padding: 0 var(--space-3);
    font-weight: 600;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    text-align: left;
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .search-label {
    font-weight: 600;
    margin-top: var(--space-2);
  }
  .search {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    font-size: var(--font-size-body);
    width: 100%;
    box-sizing: border-box;
  }
  .row:focus-visible,
  .close:focus-visible,
  .search:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .empty,
  .how {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .how {
    font-size: var(--font-size-caption);
  }
  .panel.dragging {
    opacity: 0.35;
  }
  .row.draggable {
    position: relative;
    padding-right: 56px;
  }
  .grip {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 48px;
    min-height: 48px;
    touch-action: none;
    cursor: grab;
    background-image: radial-gradient(circle, var(--color-ink-soft) 1.5px, transparent 2px);
    background-size: 8px 8px;
    background-position: center;
    background-repeat: repeat;
    background-clip: content-box;
    padding: 14px 16px;
    box-sizing: border-box;
    border-left: 1px solid var(--color-divider);
  }
  .drag-chip {
    position: fixed;
    z-index: 60;
    transform: translate(12px, -140%);
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
</style>
