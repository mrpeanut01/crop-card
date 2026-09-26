<script lang="ts">
  import { resolveSpacing } from '$lib/garden/plantCount';
  import { familyLabel } from '$lib/garden/rotation';
  import { shortDate } from '$lib/garden/occupancy';
  import type { GardenCrop } from '$lib/garden/types';
  import { getDesigner } from './designerState.svelte';

  const d = getDesigner();
  const MAX_RESULTS = 40;

  let query = $state('');
  let input = $state<HTMLInputElement | null>(null);

  const target = $derived(d.cropTargetBedId ? d.bed(d.cropTargetBedId) : null);

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const recent = new Map(d.recentPluginIds.map((id, i) => [id, i]));
    const matches = d.catalog.filter(
      (c) =>
        !q ||
        c.displayName.toLowerCase().includes(q) ||
        c.cropFamily.toLowerCase().includes(q) ||
        familyLabel(c.cropFamily).toLowerCase().includes(q)
    );
    const sorted = matches.sort((a, b) => {
      const ra = recent.get(a.pluginId) ?? Infinity;
      const rb = recent.get(b.pluginId) ?? Infinity;
      return ra - rb || a.displayName.localeCompare(b.displayName);
    });
    return sorted.slice(0, q || recent.size ? MAX_RESULTS : 0);
  });

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

{#if d.cropPanelOpen}
  <section class="panel" aria-labelledby="crop-panel-title" data-testid="crop-panel">
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
          <li>
            <button
              type="button"
              class="row"
              onclick={() =>
                d.chooseCrop({ source: 'planting', cropId: p.cropId, label: p.varietyDisplayName })}
            >
              <span class="name">{p.varietyDisplayName}</span>
              <span class="meta">
                {d.bed(p.blockId)?.name ?? ''}{p.plantingDateMs != null
                  ? ` · ${shortDate(p.plantingDateMs)}`
                  : ' · no date'}{p.plantCount ? ` · ${p.plantCount} plants` : ''}
              </span>
            </button>
          </li>
        {/each}
      </ul>
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
    {/if}
    {#each groups as [family, crops] (family)}
      <h3>{family}</h3>
      <ul class="list">
        {#each crops as c (c.pluginId)}
          <li>
            <button
              type="button"
              class="row"
              onclick={() =>
                d.chooseCrop({ source: 'catalog', pluginId: c.pluginId, label: c.displayName })}
            >
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
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
  }
</style>
