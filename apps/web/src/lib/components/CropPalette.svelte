<!--
  CropPalette.svelte (Phase 15)
  ──────────────────────────────
  Right rail with seed-stock cards. Phase 15 removed the "To schedule" tray;
  unscheduled crops are now surfaced via the PlantingGroupWizard's input pool
  on /plan?tab=schedule rather than as draggable cards on this rail.
  Keyboard "grab" via Space remains for catalog cards.
-->
<script lang="ts">
  export interface PaletteCard {
    pluginId: string;
    displayName: string;
    cropFamily: string;
    dtmMin?: number;
    dtmMax?: number;
    shadeCasting: boolean;
  }

  export interface SeedStockCard {
    stockItemId: string;
    cropPluginId: string | null;
    displayName: string;
    onHand: number;
    defaultUnit: string;
    cropFamily?: string | null;
  }

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
    cucurbit: 'Cucurbits',
    forage: 'Forage & Hay',
    'herb-culinary': 'Culinary Herbs',
    'leafy-green': 'Leafy Greens',
    legume: 'Legumes',
    orchard: 'Orchard Fruits',
    root: 'Root Vegetables',
    'small-fruit': 'Small Fruits',
    solanaceae: 'Solanaceae — Tomato / Pepper',
    'stone-fruit': 'Stone Fruits',
    'vine-fruit': 'Vine Fruits'
  };

  function familyLabel(family: string | null | undefined): string {
    if (!family) return 'Unclassified';
    return FAMILY_LABEL[family] ?? family;
  }
  function familyIcon(family: string | null | undefined): string {
    if (!family) return '🌱';
    return FAMILY_ICON[family] ?? '🌱';
  }
  function familySortKey(family: string | null | undefined): string {
    return familyLabel(family).toLowerCase();
  }

  interface Props {
    paletteCards?: PaletteCard[];
    seedStockCards?: SeedStockCard[];
    canEdit?: boolean;
    onPaletteDragStart?: (pluginId: string, cropFamily: string) => void;
    onSeedStockClick?: (stockItemId: string) => void;
    onDragEnd: () => void;
    onKeyboardGrab: (
      payload: { kind: 'palette'; pluginId: string; cropFamily: string }
    ) => void;
  }

  const props: Props = $props();
</script>

<div class="palette" aria-label="Crop palette">
  {#if props.seedStockCards && props.seedStockCards.length > 0}
    {@const groups = (() => {
      const byFamily = new Map<string, typeof props.seedStockCards>();
      for (const s of props.seedStockCards ?? []) {
        const key = s.cropFamily ?? '';
        const list = byFamily.get(key) ?? [];
        list.push(s);
        byFamily.set(key, list);
      }
      return [...byFamily.entries()]
        .map(([family, items]) => ({
          family: family || null,
          items: [...items].sort((a, b) => a.displayName.localeCompare(b.displayName))
        }))
        .sort((a, b) => familySortKey(a.family).localeCompare(familySortKey(b.family)));
    })()}
    <section>
      <h3>Seed Stock <span class="count">({props.seedStockCards.length})</span></h3>
      {#each groups as g (g.family ?? '__unc__')}
        <div class="family-group">
          <div class="family-head">
            <span aria-hidden="true">{familyIcon(g.family)}</span>
            <span>{familyLabel(g.family)}</span>
            <span class="count">({g.items.length})</span>
          </div>
          <ul class="cards">
            {#each g.items as s (s.stockItemId)}
              <li>
                <button
                  type="button"
                  class="card seed"
                  class:disabled={props.canEdit === false || !s.cropPluginId}
                  disabled={props.canEdit === false || !s.cropPluginId}
                  onclick={() => props.onSeedStockClick?.(s.stockItemId)}
                  aria-label="Seed: {s.displayName}, on hand {s.onHand} {s.defaultUnit}, click to assign to a block"
                >
                  <span class="card-title">{s.displayName}</span>
                  <span class="card-meta">
                    {s.onHand} {s.defaultUnit}
                    {#if !s.cropPluginId}· no plugin link{/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </section>
  {/if}

</div>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.5rem;
    width: 240px;
    max-height: 75vh;
    overflow-y: auto;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    background: #fff;
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    color: #374151;
  }
  .count {
    color: #6b7280;
    font-weight: 400;
  }
  ul.cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .card {
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.5rem;
    border: 1px solid #e5e7eb;
    border-left: 4px solid #cbd5e1;
    border-radius: 0.25rem;
    background: #fafafa;
    cursor: grab;
    min-height: 48px;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .card:focus-visible {
    outline: 2px solid #4338ca;
    outline-offset: 2px;
  }
  .card.seed {
    border-left-color: #1f5e3a;
    background: #f0f7f3;
    cursor: pointer;
  }
  .card.seed.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .card-title {
    font-size: 0.85rem;
    font-weight: 500;
  }
  .card-meta {
    font-size: 0.7rem;
    color: #6b7280;
  }
</style>
