<script lang="ts">
  /**
   * Sprint 7 / Phase 27B (#257) — unified inventory list.
   *
   * One canonical list chrome for all 5 inventory types per CLAUDE.md
   * Invariant 8. Per-type columns + KPIs swap; the chrome (search row,
   * 5-chip type-swap, Stock/Catalog toggle, table shell) does not.
   * Old shells stay live until Sprint 9 cutover.
   *
   * Server loader: `apps/web/src/routes/inventory/+page.server.ts`.
   * Detail dispatch: `apps/web/src/routes/inventory/[type]/[id]/`.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import InvTypeChip from './InvTypeChip.svelte';
  import type { InventoryType } from '$lib/inventory/types';
  import type {
    CatalogRow,
    InventoryRow,
    SprayerRow,
    StockRow
  } from '../../../routes/inventory/+page.server';

  interface Props {
    type: InventoryType;
    mode: 'stock' | 'catalog';
    counts: Record<InventoryType, number>;
    rows: InventoryRow[];
  }

  const { type, mode, counts, rows }: Props = $props();

  let search = $state('');

  const filteredRows: InventoryRow[] = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.kind === 'stock') return r.displayName.toLowerCase().includes(q);
      if (r.kind === 'catalog')
        return r.displayName.toLowerCase().includes(q) || r.pluginId.toLowerCase().includes(q);
      return r.label.toLowerCase().includes(q);
    });
  });

  function switchType(next: InventoryType): void {
    const url = new URL($page.url);
    url.searchParams.set('type', next);
    // Reset mode when switching: pesticide/fertility/seed default to stock,
    // crop forces catalog, sprayer forces stock (sole mode).
    url.searchParams.delete('mode');
    goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
  }

  function switchMode(next: 'stock' | 'catalog'): void {
    const url = new URL($page.url);
    url.searchParams.set('mode', next);
    goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
  }

  function navigateTo(row: InventoryRow): void {
    const id = row.kind === 'stock' ? row.id : row.kind === 'catalog' ? row.pluginId : row.id;
    goto(`/inventory/${type}/${encodeURIComponent(id)}`);
  }

  // Per-type KPI shape. Returns 4 cards; types swap based on `mode`.
  const kpis: Array<{ label: string; value: string | number }> = $derived.by(() => {
    if (type === 'sprayer') {
      const sprayers = rows as Array<SprayerRow & { kind: 'sprayer' }>;
      const calibrated = sprayers.filter((s) => s.lastCalibratedAt).length;
      const deconNeeded = sprayers.filter((s) => s.deconRequired).length;
      const lastCal = sprayers
        .map((s) => s.lastCalibratedAt)
        .filter((n): n is number => !!n)
        .sort((a, b) => b - a)[0];
      return [
        { label: 'Total', value: sprayers.length },
        { label: 'Calibrated', value: calibrated },
        { label: 'Decon needed', value: deconNeeded },
        {
          label: 'Most recent cal',
          value: lastCal ? new Date(lastCal).toLocaleDateString() : '—'
        }
      ];
    }
    if (type === 'crop' || mode === 'catalog') {
      const catalog = rows as Array<CatalogRow & { kind: 'catalog' }>;
      const withArchetype = catalog.filter((c) => c.archetype).length;
      const archetypes = new Set(catalog.map((c) => c.archetype).filter(Boolean));
      return [
        { label: 'Plugins loaded', value: catalog.length },
        { label: 'With archetype', value: withArchetype },
        { label: 'Distinct archetypes', value: archetypes.size },
        { label: 'Source', value: 'core' }
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
      { label: 'Active SKUs', value: stock.length },
      { label: 'On hand (Σ)', value: onHand.toFixed(1) },
      { label: 'Reorder soon', value: reorderSoon },
      { label: 'Expiring 60d', value: expiring60 }
    ];
  });

  const showCatalogToggle = $derived(type !== 'crop' && type !== 'sprayer');
</script>

<header class="inv-header">
  <div class="inv-header-title">
    <span class="kicker">Inventory</span>
    <h1 class="serif">All inventory</h1>
    <p class="lede">
      Pesticides, fertility, seeds, crop plugins, and sprayers — one surface, per-type fields.
    </p>
  </div>
  {#if type !== 'crop'}
    <a class="add-cta" href="/inventory/{type}/add">+ Add {type}</a>
  {/if}
</header>

<InvTypeChip activeType={type} onTypeChange={switchType} countByType={counts} />

{#if showCatalogToggle}
  <div class="mode-toggle" role="group" aria-label="Stock vs catalog">
    <button
      type="button"
      class:active={mode === 'stock'}
      aria-pressed={mode === 'stock'}
      onclick={() => switchMode('stock')}
    >
      Stock
    </button>
    <button
      type="button"
      class:active={mode === 'catalog'}
      aria-pressed={mode === 'catalog'}
      onclick={() => switchMode('catalog')}
    >
      Catalog
    </button>
  </div>
{/if}

<div class="kpi-strip" role="list" aria-label="At-a-glance metrics">
  {#each kpis as kpi (kpi.label)}
    <div class="kpi-card" role="listitem">
      <div class="kpi-value serif">{kpi.value}</div>
      <div class="kpi-label">{kpi.label}</div>
    </div>
  {/each}
</div>

<div class="search-row">
  <input
    type="search"
    bind:value={search}
    placeholder="Search by name…"
    aria-label="Search inventory"
  />
  <span class="count mono">{filteredRows.length} of {rows.length}</span>
</div>

<div class="table-wrap">
  <table class="inv-table">
    <thead>
      <tr>
        {#if type === 'sprayer'}
          <th>Sprayer</th>
          <th>Nozzle</th>
          <th>Tank</th>
          <th>Last cal</th>
          <th>GPA</th>
          <th>Status</th>
        {:else if type === 'crop' || mode === 'catalog'}
          <th>Plugin id</th>
          <th>{type === 'crop' ? 'Archetype' : 'Type'}</th>
          <th>{type === 'crop' ? 'Family' : 'Source'}</th>
          <th>{type === 'crop' ? 'DTM' : 'Version'}</th>
        {:else}
          <th>Item</th>
          <th>Category</th>
          <th class="num">On hand</th>
          <th class="num">Lots</th>
          <th>Expires</th>
        {/if}
      </tr>
    </thead>
    <tbody>
      {#if filteredRows.length === 0}
        <tr>
          <td colspan="6" class="empty">No rows.</td>
        </tr>
      {:else}
        {#each filteredRows as row (row.kind === 'catalog' ? row.pluginId : row.kind === 'stock' ? row.id : row.id)}
          <tr class="clickable" onclick={() => navigateTo(row)}>
            {#if row.kind === 'sprayer'}
              <td>{row.label}</td>
              <td class="muted">{row.nozzleType ?? '—'}</td>
              <td class="num muted">{row.tankGal != null ? `${row.tankGal} gal` : '—'}</td>
              <td class="muted">
                {row.lastCalibratedAt ? new Date(row.lastCalibratedAt).toLocaleDateString() : '—'}
              </td>
              <td class="num">{row.measuredGpa != null ? row.measuredGpa.toFixed(1) : '—'}</td>
              <td>
                {#if row.deconRequired}
                  <span class="pill pill-warn">Decon</span>
                {:else if row.lastCalibratedAt}
                  <span class="pill pill-ok">OK</span>
                {:else}
                  <span class="pill pill-muted">New</span>
                {/if}
              </td>
            {:else if row.kind === 'catalog'}
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
              <td class="muted">{row.category}</td>
              <td class="num" class:low={row.isLow}>
                {row.onHand.toFixed(1)}
                {row.defaultUnit}
              </td>
              <td class="num muted">{row.lotCount}</td>
              <td class="muted">
                {row.earliestExpiry ? new Date(row.earliestExpiry).toLocaleDateString() : '—'}
              </td>
            {/if}
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .inv-header {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 12px;
    margin-bottom: 12px;
  }
  .add-cta {
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
  .pill {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 8px;
    border-radius: 99px;
    text-transform: uppercase;
  }
  .pill-ok {
    background: var(--color-forest-tint, #e8f1ea);
    color: var(--color-forest-deep, #1f3522);
  }
  .pill-warn {
    background: var(--color-rust-tint, #fce8e8);
    color: var(--color-rust, #a23a3a);
  }
  .pill-muted {
    background: var(--color-divider, #e5e7e0);
    color: var(--color-ink-muted, #6a6f63);
  }
</style>
