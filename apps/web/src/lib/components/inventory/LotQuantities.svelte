<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import InvKVP from './InvKVP.svelte';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';
  import { qtyStatusLabel } from './typeLabel';
  import { formatStockQuantity, stockUnitLabel, type StockUnit } from '$lib/stock/units';
  import {
    lotAvailable,
    lotQuantityTotals,
    type LotQuantityLike,
    type QuantityStatus
  } from '$lib/stock/quantityStatus';

  type Lot = LotQuantityLike & {
    id: string;
    lotNumber?: string;
    expiresAt?: number;
  };

  interface Props {
    itemId: string;
    unit: string;
    /** Stock category, so seed counted as `count` reads as Seeds. */
    category?: string | null;
    lots: Lot[];
    /** Overrides the role read from the page; used by component tests. */
    canEdit?: boolean;
  }

  const { itemId, unit, category = null, lots, canEdit }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const owner = $derived(canEdit ?? page.data?.user?.role === 'owner');
  const totals = $derived(lotQuantityTotals(lots));
  const qty = (v: number) => formatStockQuantity(v, unit, currentPrefs(), { digits: 2, category });
  const unitLabel = $derived(stockUnitLabel(unit as StockUnit, category, page.data?.locale));

  let addOpen = $state(false);
  let addQty = $state<number | null>(null);
  let addStatus = $state<QuantityStatus>('existing');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function send(url: string, method: string, body: unknown): Promise<boolean> {
    busy = true;
    error = null;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        error = b?.error ?? tr('inv.lots.saveFailed', { status: res.status });
        return false;
      }
      await invalidateAll();
      return true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      busy = false;
    }
  }

  async function addLot(e: SubmitEvent) {
    e.preventDefault();
    if (!addQty || addQty <= 0) {
      error = tr('inv.lots.qtyPositive');
      return;
    }
    const ok = await send(`/api/stock/${itemId}/lots`, 'POST', {
      receivedQuantity: addQty,
      unit,
      quantityStatus: addStatus
    });
    if (ok) {
      addOpen = false;
      addQty = null;
      addStatus = 'existing';
    }
  }

  function markReceived(lotId: string) {
    return send(`/api/stock/${itemId}/lots/${lotId}`, 'PATCH', { quantityStatus: 'existing' });
  }
</script>

<div class="lot-quantities" data-testid="lot-quantities">
  <InvKVP label={tr('inv.qty.existing')} value={qty(totals.existing)} />
  <InvKVP label={tr('inv.qty.ordered')} value={qty(totals.ordered)} />
  <InvKVP label={tr('inv.qty.planned')} value={qty(totals.planned)} />

  {#if lots.length === 0}
    <p class="empty">
      {tr('inv.lots.empty')}
    </p>
  {:else}
    <ul class="lot-list">
      {#each lots as lot (lot.id)}
        <li data-status={lot.quantityStatus}>
          <span class="status status-{lot.quantityStatus}">
            {qtyStatusLabel(tr, lot.quantityStatus)}
          </span>
          <span class="amount">
            {qty(lotAvailable(lot))}
          </span>
          {#if lot.lotNumber}<span class="mono muted">{lot.lotNumber}</span>{/if}
          {#if lot.expiresAt}<span class="muted small"
              >{tr('inv.lots.exp', { date: fmt.day(lot.expiresAt) })}</span
            >{/if}
          {#if owner && lot.quantityStatus !== 'existing'}
            <button
              type="button"
              class="btn-small"
              disabled={busy}
              onclick={() => markReceived(lot.id)}
            >
              {tr('inv.lots.markReceived')}
            </button>
          {/if}
          {#if owner && lot.quantityStatus === 'existing'}
            <a
              class="btn-small ghost expense-link"
              href="/finance/new?kind=expense&stockLotId={encodeURIComponent(lot.id)}"
            >
              {tr('inv.lots.recordExpense')}
            </a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if owner}
    {#if addOpen}
      <form class="add-lot" onsubmit={addLot}>
        <label>
          <span>{tr('inv.lots.quantity', { unit: unitLabel })}</span>
          <input type="number" min="0" step="any" bind:value={addQty} required />
        </label>
        <label>
          <span>{tr('inv.lots.status')}</span>
          <select bind:value={addStatus}>
            <option value="existing">{qtyStatusLabel(tr, 'existing')}</option>
            <option value="ordered">{qtyStatusLabel(tr, 'ordered')}</option>
            <option value="planned">{qtyStatusLabel(tr, 'planned')}</option>
          </select>
        </label>
        <div class="actions">
          <button type="button" class="btn-small ghost" onclick={() => (addOpen = false)}>
            {tr('inv.cancel')}
          </button>
          <button type="submit" class="btn-small" disabled={busy}
            >{tr('inv.lots.saveQuantity')}</button
          >
        </div>
      </form>
    {:else}
      <button type="button" class="btn-small ghost" onclick={() => (addOpen = true)}>
        {tr('inv.lots.addQuantity')}
      </button>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .lot-quantities {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .empty {
    color: var(--color-ink-muted, #6a6f63);
    font-style: italic;
    margin: 0;
    font-size: 0.9rem;
  }
  .lot-list {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lot-list li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: 0.85rem;
  }
  .status {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--color-sage-tint, #e7efe8);
    color: var(--color-forest-deep, #1f3522);
  }
  .status-ordered {
    background: var(--color-honey-tint, #fff4d6);
    color: var(--color-honey-deep, #6a4f00);
  }
  .status-planned {
    background: #eef0f3;
    color: #3f4a56;
  }
  .amount {
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .muted {
    color: var(--color-ink-muted, #6a6f63);
  }
  .small {
    font-size: 0.8rem;
  }
  .btn-small {
    min-height: 48px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid var(--color-forest, #1f5e3a);
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-small.ghost {
    background: transparent;
    color: var(--color-forest-deep, #1f3522);
    align-self: flex-start;
  }
  .expense-link {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
    box-sizing: border-box;
  }
  .btn-small:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .add-lot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-end;
  }
  .add-lot label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.8rem;
    flex: 1 1 120px;
    min-width: 0;
  }
  .add-lot input,
  .add-lot select {
    min-height: 48px;
    padding: 8px 10px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    font: inherit;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .error {
    color: var(--color-rust, #a23a3a);
    margin: 0;
    font-size: 0.85rem;
  }
</style>
