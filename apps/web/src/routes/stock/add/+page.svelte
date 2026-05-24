<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import MethodTabs from '$lib/components/stock/add/MethodTabs.svelte';
  import ManualForm from '$lib/components/stock/add/ManualForm.svelte';
  import SearchPanel from '$lib/components/stock/add/SearchPanel.svelte';
  import { normalizeStockEntry, type StockEntryDraft } from '$lib/stock/normalizeStockEntry';
  import { METHOD_META, type StockAddMethod } from '$lib/stock/addMethods';

  /**
   * Phase 25d (#89) — Stock 5-method add waterfall surface.
   *
   * Single tabbed surface that swaps between Manual / Search / Barcode /
   * Label OCR. Each method populates a `StockEntryDraft`; on submit the
   * shared normalize seam projects to the canonical POST /api/stock
   * body. The new route lives alongside (not replacing) the
   * InventoryView modal — the modal stays as the back-compat fallback
   * until this surface is proven.
   */

  let { data } = $props();

  // First-method default is captured on mount; subsequent loader runs
  // shouldn't yank the operator out of a non-default tab they picked.
  let active = $state<StockAddMethod>(untrack(() => data.methods[0] ?? 'manual'));
  let submitBusy = $state(false);
  let createdItemId = $state<string | null>(null);
  let topError = $state<string | null>(null);

  async function submitDraft(draft: StockEntryDraft) {
    topError = null;
    if (!data.canEdit) {
      topError = 'Inspector role is read-only — ask the owner to add this item.';
      return;
    }
    const normalized = normalizeStockEntry(draft);
    if (!normalized.ok) {
      topError = normalized.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
      return;
    }
    submitBusy = true;
    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(normalized.request)
      });
      const body = await res.json();
      if (!res.ok) {
        topError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      createdItemId = body.item?.id ?? null;
      // Navigate to the item detail page so the operator can immediately
      // add a lot # / opening balance.
      if (createdItemId) {
        await goto(`/stock/${createdItemId}?added=1`);
      } else {
        await goto('/stock?added=1');
      }
    } finally {
      submitBusy = false;
    }
  }

  const activeMeta = $derived(METHOD_META[active]);
</script>

<svelte:head>
  <title>Add stock · CropCard</title>
</svelte:head>

<header class="add-head">
  <div>
    <p class="kicker">Inventory</p>
    <h1>Add stock</h1>
  </div>
  <a class="back" href="/stock">← Back to inventory</a>
</header>

<MethodTabs methods={data.methods} {active} onSelect={(m) => (active = m)} />

<section class="method-meta">
  <h2>{activeMeta.label}</h2>
  <p>{activeMeta.description}</p>
</section>

{#if topError}
  <p class="top-err" aria-live="polite">{topError}</p>
{/if}

<section class="method-body">
  {#if active === 'manual'}
    <ManualForm onSubmit={submitDraft} busy={submitBusy} />
  {:else if active === 'search'}
    <SearchPanel onSubmit={submitDraft} busy={submitBusy} />
  {:else if active === 'barcode'}
    <p class="placeholder">
      Barcode scanner — coming after Search. For now, use the existing inventory modal's
      barcode flow.
    </p>
  {:else if active === 'label'}
    <p class="placeholder">
      Label OCR — coming after Barcode. For now, use the existing inventory modal's label
      scan.
    </p>
  {:else if active === 'photo'}
    <p class="placeholder">Photo extract — deferred to Phase 26 per the #89 plan.</p>
  {/if}
</section>

<style>
  .add-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .kicker {
    margin: 0 0 2px;
    font-size: 10.5px;
    color: var(--color-ink-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 700;
  }
  h1 {
    margin: 0;
    font-family: var(--font-serif, serif);
    font-size: 28px;
    color: var(--color-forest-deep);
    letter-spacing: var(--letter-tight, -0.01em);
  }
  .back {
    font-size: 13px;
    color: var(--color-forest-deep);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .back:hover {
    border-bottom-color: currentColor;
  }
  .method-meta {
    margin: 14px 0 18px;
    padding: 12px 14px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-card, 8px);
  }
  .method-meta h2 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .method-meta p {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
  .top-err {
    margin: 0 0 14px;
    padding: 10px 14px;
    background: rgba(186, 75, 56, 0.08);
    border-left: 3px solid var(--color-rust, #ba4b38);
    color: var(--color-rust, #ba4b38);
    font-size: 13px;
    border-radius: 4px;
  }
  .method-body {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 20px;
  }
  .placeholder {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13.5px;
    line-height: 1.5;
    font-style: italic;
  }
</style>
