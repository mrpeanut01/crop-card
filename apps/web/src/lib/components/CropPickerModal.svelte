<script lang="ts">
  type CatalogItem = {
    pluginId: string;
    displayName: string;
    cropFamily: string | undefined;
    daysToMaturity?: { min: number; max: number };
  };

  let {
    catalog,
    blockName,
    onSelect,
    onClose
  }: {
    catalog: CatalogItem[];
    blockName: string;
    onSelect: (pluginId: string, date: string | null) => void;
    onClose: () => void;
  } = $props();

  const FAMILY_ICON: Record<string, string> = {
    allium: '🧅',
    apiaceae: '🥕',
    bramble: '🫐',
    brassica: '🥦',
    'broadleaf-companion': '🌸',
    'cereal-grain': '🌾',
    corn: '🌽',
    'cover-grass': '🌿',
    'cover-legume': '🌿',
    cucurbit: '🎃',
    forage: '🌾',
    'herb-culinary': '🌿',
    'leafy-green': '🥬',
    legume: '🫘',
    orchard: '🍎',
    root: '🥕',
    'small-fruit': '🍓',
    solanaceae: '🍅',
    'stone-fruit': '🍑',
    'vine-fruit': '🍇'
  };

  const FAMILY_LABEL: Record<string, string> = {
    allium: 'Alliums',
    apiaceae: 'Apiaceae — Carrots / Celery',
    bramble: 'Brambles',
    brassica: 'Brassicas',
    'broadleaf-companion': 'Broadleaf Companions',
    'cereal-grain': 'Cereal Grains',
    corn: 'Corn',
    'cover-grass': 'Cover Grasses',
    'cover-legume': 'Cover Legumes',
    cucurbit: 'Cucurbits — Squash / Pumpkins',
    forage: 'Forage & Hay',
    'herb-culinary': 'Culinary Herbs',
    'leafy-green': 'Leafy Greens',
    legume: 'Legumes',
    orchard: 'Orchard Fruits',
    root: 'Root Vegetables',
    'small-fruit': 'Small Fruits',
    solanaceae: 'Solanaceous — Tomatoes / Peppers',
    'stone-fruit': 'Stone Fruits',
    'vine-fruit': 'Vine Fruits'
  };

  let search = $state('');
  let familyFilter = $state('');
  let selectedPluginId = $state<string | null>(null);
  let plantingDate = $state('');

  const families = $derived([...new Set(catalog.map((c) => c.cropFamily ?? 'other'))].sort());

  const filtered = $derived(
    catalog.filter((c) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        c.displayName.toLowerCase().includes(q) ||
        (c.cropFamily ?? '').toLowerCase().includes(q);
      const matchFamily = !familyFilter || c.cropFamily === familyFilter;
      return matchSearch && matchFamily;
    })
  );

  const grouped = $derived.by(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const c of filtered) {
      const fam = c.cropFamily ?? 'other';
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  const selectedItem = $derived(
    selectedPluginId ? (catalog.find((c) => c.pluginId === selectedPluginId) ?? null) : null
  );

  function dtLabel(dtm: { min: number; max: number }): string {
    return dtm.min === dtm.max ? `${dtm.min} d` : `${dtm.min}–${dtm.max} d`;
  }

  function confirm() {
    if (!selectedPluginId) return;
    onSelect(selectedPluginId, plantingDate || null);
  }
</script>

<div
  class="picker-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Select a crop variety"
  onclick={(e) => e.target === e.currentTarget && onClose()}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
  tabindex="-1"
>
  <div class="picker-modal">
    <div class="picker-header">
      <h2>Select a crop variety</h2>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="picker-controls">
      <div class="search-wrap">
        <span class="search-icon" aria-hidden="true">🔍</span>
        <input
          type="search"
          class="search-input"
          placeholder="Search varieties…"
          bind:value={search}
          autocomplete="off"
        />
      </div>
      <select class="family-filter" bind:value={familyFilter} aria-label="Filter by crop type">
        <option value="">All crop types</option>
        {#each families as fam}
          <option value={fam}>{FAMILY_LABEL[fam] ?? fam}</option>
        {/each}
      </select>
    </div>

    <div class="picker-list">
      {#if grouped.length === 0}
        <p class="no-results">No varieties match your search.</p>
      {/if}
      {#each grouped as [fam, items]}
        <div class="family-group">
          <div class="family-heading">
            <span aria-hidden="true">{FAMILY_ICON[fam] ?? '🌱'}</span>
            {FAMILY_LABEL[fam] ?? fam}
            <span class="family-count">({items.length})</span>
          </div>
          {#each items as item (item.pluginId)}
            <button
              type="button"
              class="variety-row"
              class:selected={selectedPluginId === item.pluginId}
              onclick={() => {
                selectedPluginId = selectedPluginId === item.pluginId ? null : item.pluginId;
              }}
            >
              <span class="variety-name">{item.displayName}</span>
              {#if item.daysToMaturity}
                <span class="variety-days">{dtLabel(item.daysToMaturity)}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>

    {#if selectedItem}
      <div class="picker-footer">
        <div class="footer-crop">
          <strong>{selectedItem.displayName}</strong>
          <span class="footer-arrow">→ {blockName}</span>
        </div>
        <div class="footer-actions">
          <label class="date-label">
            Planting date <span class="optional">(optional)</span>
            <input type="date" bind:value={plantingDate} />
          </label>
          <button type="button" class="add-btn" onclick={confirm}>
            + Add to {blockName}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1200;
    padding: 1rem;
  }

  .picker-modal {
    background: white;
    border-radius: 10px;
    width: 100%;
    max-width: 640px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    border-top: 6px solid #1f5e3a;
  }

  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid #e4e9e4;
    flex-shrink: 0;
  }

  .picker-header h2 {
    margin: 0;
    font-size: 1.15rem;
    color: #1f5e3a;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.2rem;
    color: #666;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    line-height: 1;
    min-width: 36px;
    min-height: 36px;
  }

  .close-btn:hover {
    background: #f0f0f0;
  }

  .picker-controls {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #e4e9e4;
    flex-shrink: 0;
    background: #f8fbf9;
  }

  .search-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 0.6rem;
    font-size: 0.9rem;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 0.55rem 0.75rem 0.55rem 2rem;
    border: 2px solid #d0d7d0;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
    min-height: 44px;
  }

  .search-input:focus {
    outline: none;
    border-color: #1f5e3a;
  }

  .family-filter {
    padding: 0.55rem 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 6px;
    font-size: 0.9rem;
    font-family: inherit;
    min-height: 44px;
    min-width: 160px;
    background: white;
  }

  .family-filter:focus {
    outline: none;
    border-color: #1f5e3a;
  }

  .picker-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .no-results {
    padding: 2rem;
    text-align: center;
    color: #888;
  }

  .family-group {
    margin-bottom: 0.25rem;
  }

  .family-heading {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem 0.3rem;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #1f5e3a;
    background: #f2f7f3;
    border-top: 1px solid #dfe8df;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .family-count {
    color: #888;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }

  .variety-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.65rem 1rem;
    background: none;
    border: none;
    border-bottom: 1px solid #f0f4f0;
    font-family: inherit;
    font-size: 0.95rem;
    text-align: left;
    cursor: pointer;
    min-height: 52px;
    gap: 0.75rem;
  }

  .variety-row:hover {
    background: #f5fbf6;
  }

  .variety-row.selected {
    background: #e6f3ec;
    border-left: 4px solid #1f5e3a;
  }

  .variety-name {
    flex: 1;
    line-height: 1.3;
  }

  .variety-days {
    font-size: 0.82rem;
    color: #666;
    white-space: nowrap;
    background: #eef3ee;
    padding: 0.15rem 0.45rem;
    border-radius: 10px;
    flex-shrink: 0;
  }

  .variety-row.selected .variety-days {
    background: #c6e0cf;
    color: #1a4e30;
  }

  .picker-footer {
    border-top: 2px solid #1f5e3a;
    padding: 0.9rem 1rem;
    background: #f8fbf9;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .footer-crop {
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .footer-arrow {
    color: #555;
  }

  .footer-actions {
    display: flex;
    gap: 0.6rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .date-label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.82rem;
    color: #555;
  }

  .optional {
    color: #888;
    font-weight: 400;
  }

  .date-label input[type='date'] {
    padding: 0.5rem 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
    min-height: 44px;
  }

  .date-label input[type='date']:focus {
    outline: none;
    border-color: #1f5e3a;
  }

  .add-btn {
    flex: 1;
    min-height: 48px;
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    font-family: inherit;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0 1.25rem;
    white-space: nowrap;
  }

  .add-btn:hover {
    background: #2a7849;
  }

  @media (max-width: 480px) {
    .picker-controls {
      flex-direction: column;
    }

    .family-filter {
      min-width: 0;
    }

    .footer-actions {
      flex-direction: column;
    }

    .add-btn {
      width: 100%;
    }
  }
</style>
