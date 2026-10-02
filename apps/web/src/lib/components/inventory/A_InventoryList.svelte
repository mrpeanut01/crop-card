<script lang="ts">
  /**
   * Sprint 7 / Phase 27B (#257) — unified inventory list.
   *
   * One canonical list chrome for every inventory type per CLAUDE.md
   * Invariant 8. Per-type columns + KPIs swap; the chrome (search row,
   * type-swap chips, Stock/Catalog toggle, table shell) does not.
   * Sprayers are equipment and live on /equipment (#474).
   *
   * Server loader: `apps/web/src/routes/inventory/+page.server.ts`.
   * Detail dispatch: `apps/web/src/routes/inventory/[type]/[id]/`.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { cropDisplayNameByEnglish } from '$lib/i18n/cropName';
  import { createT } from '$lib/i18n';
  import { invTypeWord } from './typeLabel';
  import InvTypeChip from './InvTypeChip.svelte';
  import InventoryEmptyGrid from './InventoryEmptyGrid.svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import { expectedQuantityText, inventoryRowCard, inventoryRowId } from '$lib/inventory/rowCards';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatStockQuantity, isLabelUnitCategory } from '$lib/stock/units';
  import { stockCategoryLabel } from '$lib/stock/categories';
  import type { InventoryType } from '$lib/inventory/types';
  import { visibleInventoryTypes } from '$lib/inventory/chips';
  import type { CatalogRow, InventoryRow, StockRow } from '../../../routes/inventory/+page.server';

  interface Props {
    type: InventoryType;
    mode: 'stock' | 'catalog';
    counts: Record<InventoryType, number>;
    rows: InventoryRow[];
    /** Owners get add links in the empty state; helpers are told to ask. */
    canAdd?: boolean;
    /** Chips shown; feed and animal-health hide until the farm has animals
     *  or stock of that type (Phase 32D). */
    visibleTypes?: readonly InventoryType[];
  }

  const { type, mode, counts, rows, canAdd = true, visibleTypes: visibleProp }: Props = $props();

  const tr = $derived(createT($page.data?.locale));

  const visibleTypes = $derived(
    visibleProp ?? visibleInventoryTypes({ stockCounts: counts, hasAnimals: false, active: type })
  );

  let search = $state('');

  const filteredRows: InventoryRow[] = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.kind === 'stock') return r.displayName.toLowerCase().includes(q);
      return r.displayName.toLowerCase().includes(q) || r.pluginId.toLowerCase().includes(q);
    });
  });

  function switchType(next: InventoryType): void {
    const url = new URL($page.url);
    url.searchParams.set('type', next);
    // Reset mode when switching: pesticide/fertility/seed default to stock,
    // crop forces catalog.
    url.searchParams.delete('mode');
    goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
  }

  function switchMode(next: 'stock' | 'catalog'): void {
    const url = new URL($page.url);
    url.searchParams.set('mode', next);
    goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
  }

  function navigateTo(row: InventoryRow): void {
    const id = row.kind === 'stock' ? row.id : row.pluginId;
    goto(`/inventory/${type}/${encodeURIComponent(id)}`);
  }

  // Per-type KPI shape. Returns 4 cards; types swap based on `mode`.
  const kpis: Array<{ label: string; value: string | number }> = $derived.by(() => {
    if (type === 'crop' || mode === 'catalog') {
      const catalog = rows as Array<CatalogRow & { kind: 'catalog' }>;
      const withArchetype = catalog.filter((c) => c.archetype).length;
      const archetypes = new Set(catalog.map((c) => c.archetype).filter(Boolean));
      return [
        { label: tr('inv.list.kpi.inCatalog'), value: catalog.length },
        { label: tr('inv.list.kpi.withArchetype'), value: withArchetype },
        { label: tr('inv.list.kpi.distinctArchetypes'), value: archetypes.size },
        { label: tr('inv.list.kpi.source'), value: 'core' }
      ];
    }
    // Stock modes: pesticide / fertility / seed
    const stock = rows as Array<StockRow & { kind: 'stock' }>;
    const onHand = stock.reduce((sum, s) => sum + s.onHand, 0);
    const reorderSoon = stock.filter((s) => s.isLow).length;
    const sixtyDays = Date.now() + 60 * 24 * 60 * 60 * 1000;
    const expiring60 = stock.filter(
      (s) => s.earliestExpiry !== undefined && s.earliestExpiry <= sixtyDays
    ).length;
    return [
      { label: tr('inv.list.kpi.activeSkus'), value: stock.length },
      { label: tr('inv.list.kpi.onHandSum'), value: onHand.toFixed(1) },
      { label: tr('inv.list.kpi.reorderSoon'), value: reorderSoon },
      { label: tr('inv.list.kpi.expiring60'), value: expiring60 }
    ];
  });

  // Crop is catalog only; feed is stock only, like equipment (D0-17).
  const showCatalogToggle = $derived(type !== 'crop' && type !== 'feed');
  const addLabel = $derived(
    type === 'feed'
      ? tr('inv.list.addLabel.feed')
      : type === 'animal-health'
        ? tr('inv.list.addLabel.medicine')
        : invTypeWord(tr, type)
  );

  const rowCards = $derived(filteredRows.map((r) => inventoryRowCard(r, type, currentPrefs())));
</script>

<header class="inv-header">
  <div class="inv-header-title">
    <span class="kicker">{tr('inv.list.kicker')}</span>
    <h1 class="serif">{tr('inv.list.title')}</h1>
    <p class="lede">
      {visibleTypes.includes('feed') ? tr('inv.list.ledeWithAnimals') : tr('inv.list.ledeBase')}
      {tr('inv.list.ledeGear')}
      <a href="/equipment">{tr('inv.list.equipmentLink')}</a>.
    </p>
  </div>
  {#if type !== 'crop'}
    <a class="add-cta" href="/inventory/{type}/add">{tr('inv.list.add', { what: addLabel })}</a>
  {/if}
</header>

<InvTypeChip
  activeType={type}
  onTypeChange={switchType}
  countByType={counts}
  types={visibleTypes}
/>

{#if showCatalogToggle}
  <div class="mode-toggle" role="group" aria-label={tr('inv.list.stockVsCatalog')}>
    <button
      type="button"
      class:active={mode === 'stock'}
      aria-pressed={mode === 'stock'}
      onclick={() => switchMode('stock')}
    >
      {tr('inv.list.stock')}
    </button>
    <button
      type="button"
      class:active={mode === 'catalog'}
      aria-pressed={mode === 'catalog'}
      onclick={() => switchMode('catalog')}
    >
      {tr('inv.list.catalog')}
    </button>
  </div>
{/if}

<div class="kpi-strip" role="list" aria-label={tr('inv.list.metrics')}>
  {#each kpis as kpi (kpi.label)}
    <div class="kpi-card" role="listitem">
      <div class="kpi-value serif">{kpi.value}</div>
      <div class="kpi-label">{kpi.label}</div>
    </div>
  {/each}
</div>

{#if rows.length === 0 && type === 'animal-health' && mode === 'catalog'}
  <p class="catalog-pending" role="note" data-testid="animal-health-catalog-empty">
    {tr('inv.list.catalogPending')}
  </p>
{:else if rows.length === 0}
  <InventoryEmptyGrid activeType={type} {canAdd} types={visibleTypes} />
{:else}
  <div class="search-row">
    <input
      type="search"
      bind:value={search}
      placeholder={tr('inv.list.searchPlaceholder')}
      aria-label={tr('inv.list.searchAria')}
    />
    <span class="count mono"
      >{tr('inv.list.countOf', { shown: filteredRows.length, total: rows.length })}</span
    >
  </div>

  <div class="table-wrap">
    <table class="inv-table">
      <thead>
        <tr>
          {#if type === 'crop' || mode === 'catalog'}
            <th>{tr('inv.list.col.id')}</th>
            <th>{type === 'crop' ? tr('inv.list.col.archetype') : tr('inv.list.col.type')}</th>
            <th>{type === 'crop' ? tr('inv.list.col.family') : tr('inv.list.col.source')}</th>
            <th>{type === 'crop' ? tr('inv.list.col.dtm') : tr('inv.list.col.version')}</th>
          {:else}
            <th>{tr('inv.list.col.item')}</th>
            <th>{type === 'seed' ? tr('inv.list.col.crop') : tr('inv.list.col.kind')}</th>
            <th class="num">{tr('inv.list.col.onHand')}</th>
            <th class="num">{tr('inv.list.col.lots')}</th>
            <th>{tr('inv.list.col.expires')}</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#if filteredRows.length === 0}
          <tr>
            <td colspan="6" class="empty">{tr('inv.list.noMatch')}</td>
          </tr>
        {:else}
          {#each filteredRows as row (row.kind === 'catalog' ? row.pluginId : row.id)}
            <tr class="clickable" onclick={() => navigateTo(row)}>
              {#if row.kind === 'catalog'}
                <td class="mono">{row.pluginId}</td>
                <td>{row.archetype ?? row.pluginType}</td>
                <td class="muted">{row.cropFamily ?? '—'}</td>
                <td class="num muted">
                  {#if row.daysToMaturity}
                    {row.daysToMaturity.min}–{row.daysToMaturity.max} d
                  {:else}
                    {row.version ?? '—'}
                  {/if}
                </td>
              {:else}
                <td>{row.displayName}</td>
                <td class="muted">
                  {type === 'seed'
                    ? row.cropName
                      ? cropDisplayNameByEnglish(row.cropName, $page.data?.locale)
                      : '—'
                    : stockCategoryLabel(row.category, $page.data?.locale)}
                </td>
                <td class="num" class:low={row.isLow}>
                  {formatStockQuantity(row.onHand, row.defaultUnit, currentPrefs(), {
                    labelUnit: isLabelUnitCategory(row.category),
                    category: row.category
                  })}
                  {#if expectedQuantityText(row, currentPrefs())}
                    <span class="expected">+ {expectedQuantityText(row, currentPrefs())}</span>
                  {/if}
                </td>
                <td class="num muted">{row.lotCount}</td>
                <td class="muted">
                  {row.earliestExpiry ? fmt.day(row.earliestExpiry) : '—'}
                </td>
              {/if}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <ul class="inv-cards" data-testid="inventory-cards" aria-label={tr('inv.list.cardsAria')}>
    {#if rowCards.length === 0}
      <li class="cards-empty">{tr('inv.list.noMatch')}</li>
    {:else}
      {#each rowCards as card, i (inventoryRowId(filteredRows[i]))}
        <li>
          <CardView
            {card}
            variant="compact"
            prefs={currentPrefs()}
            factLimit={4}
            showAsOf={false}
          />
        </li>
      {/each}
    {/if}
  </ul>
{/if}

<style>
  .inv-header {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 12px;
    margin-bottom: 12px;
  }
  .catalog-pending {
    margin: 16px 0 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--pill-wheat-bg, #e8d9b5);
    color: var(--color-ink, #1c1c1c);
    line-height: 1.45;
  }
  .add-cta {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    box-sizing: border-box;
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
    padding: 8px 14px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .add-cta:hover {
    background: var(--color-forest-deep, #1f3522);
  }
  .inv-header-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .kicker {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-ink-muted, #6a6f63);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .lede {
    margin: 4px 0 0;
    font-size: 0.9rem;
    color: var(--color-ink-muted, #6a6f63);
  }
  .lede a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest, #1f5e3a);
    font-weight: 600;
  }
  .mode-toggle {
    margin-top: 10px;
    display: inline-flex;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 99px;
    overflow: hidden;
  }
  .mode-toggle button {
    background: transparent;
    border: none;
    min-height: 48px;
    padding: 6px 14px;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    color: var(--color-ink, #1c1c1c);
  }
  .mode-toggle button.active {
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
  }
  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    margin: 14px 0 12px;
  }
  .kpi-card {
    background: var(--color-paper, #fff);
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .kpi-value {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
  }
  .kpi-label {
    font-size: 0.7rem;
    color: var(--color-ink-muted, #6a6f63);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-top: 2px;
  }
  .search-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .search-row input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    font: inherit;
    background: var(--color-paper, #fff);
  }
  .search-row input:focus {
    outline: 2px solid var(--color-forest, #1f5e3a);
    outline-offset: 1px;
  }
  .count {
    font-size: 0.8rem;
    color: var(--color-ink-muted, #6a6f63);
    white-space: nowrap;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  .inv-cards {
    display: none;
    list-style: none;
    margin: 0;
    padding: 0;
    flex-direction: column;
    gap: 10px;
  }
  .cards-empty {
    text-align: center;
    color: var(--color-ink-soft, #4a4f46);
    padding: 24px 12px;
  }
  @media (max-width: 640px) {
    .table-wrap {
      display: none;
    }
    .inv-cards {
      display: flex;
    }
  }
  .table-wrap {
    overflow-x: auto;
    border-radius: 10px;
    background: var(--color-paper, #fff);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .inv-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .inv-table th,
  .inv-table td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-divider, #e5e7e0);
  }
  .inv-table th {
    background: var(--color-cream, #fff8e1);
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    position: sticky;
    top: 0;
  }
  .inv-table th.num,
  .inv-table td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .inv-table td.muted {
    color: var(--color-ink-muted, #6a6f63);
  }
  .inv-table td .expected {
    display: block;
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--color-ink-muted, #6a6f63);
  }
  .inv-table td.low {
    color: var(--color-rust, #a23a3a);
    font-weight: 600;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.clickable:hover {
    background: var(--color-forest-tint, #e8f1ea);
  }
  td.empty {
    text-align: center;
    color: var(--color-ink-muted, #6a6f63);
    padding: 24px 12px;
  }
</style>
