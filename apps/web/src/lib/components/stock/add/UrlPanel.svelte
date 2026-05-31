<script lang="ts">
  import { Globe } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { draftFromScanResult, type StockEntryDraft } from '$lib/stock/normalizeStockEntry';
  import { STOCK_CATEGORY_TO_INVENTORY_TYPE, type InventoryType } from '$lib/inventory/types';

  /**
   * #296 — Method 5 of the add waterfall (web/URL paste).
   *
   * Operator pastes a product-page URL; client POSTs `/api/scan-url`,
   * which fetches the page + asks Claude to read it into a `ScanResult`.
   * Mirrors BarcodePanel's loading / not-found / existing-SKU shape.
   * AI-gated — the parent only mounts this when `aiEnabled`.
   */

  interface Props {
    onSubmit: (draft: StockEntryDraft) => void | Promise<void>;
    busy?: boolean;
    /** Fallback inventory type for the existing-item link when the
     *  resolved product carries no category. */
    type?: InventoryType;
  }

  const { onSubmit, busy = false, type }: Props = $props();

  let url = $state('');
  let lookingUp = $state(false);
  let lookupError = $state<string | null>(null);
  let existingItemId = $state<string | null>(null);
  let existingType = $state<InventoryType | null>(null);

  async function runLookup(): Promise<void> {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      lookupError = 'Enter a full http(s) product-page URL.';
      return;
    }
    lookingUp = true;
    lookupError = null;
    existingItemId = null;
    try {
      const res = await fetch('/api/scan-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: u })
      });
      const body = await res.json();
      if (!res.ok) {
        lookupError = body.message ?? body.error ?? `HTTP ${res.status}`;
        return;
      }
      if (body.existingStockItemId) {
        existingItemId = body.existingStockItemId;
        existingType =
          (body.category && STOCK_CATEGORY_TO_INVENTORY_TYPE[body.category]) ?? type ?? null;
        return;
      }
      if (!body.found) {
        lookupError =
          'Could not read a product from that page. Try the label scanner, or use Manual entry.';
        return;
      }
      await onSubmit(draftFromScanResult(body, 'ai'));
    } catch (e) {
      lookupError = e instanceof Error ? e.message : String(e);
    } finally {
      lookingUp = false;
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runLookup();
    }
  }
</script>

<div class="url-panel">
  <p class="lede">
    Paste a link to the product page (a retailer, the manufacturer, a seed catalog). Claude reads
    the page into a draft you can review.
  </p>

  <div class="url-row">
    <span class="url-icon" aria-hidden="true"><Globe size={18} strokeWidth={1.75} /></span>
    <label class="visually-hidden" for="url-input">Product page URL</label>
    <input
      id="url-input"
      type="url"
      bind:value={url}
      onkeydown={onKeydown}
      placeholder="https://…"
      disabled={busy || lookingUp}
    />
    <button type="button" onclick={runLookup} disabled={busy || lookingUp}>
      {lookingUp ? 'Reading…' : 'Read page'}
    </button>
  </div>

  {#if existingItemId}
    <div class="existing">
      <p>
        That product is already in your inventory.
        <Provenance source="data" compact />
      </p>
      {#if existingType}
        <a class="primary" href="/inventory/{existingType}/{existingItemId}">Open that item →</a>
      {/if}
    </div>
  {/if}

  {#if lookupError}
    <p class="error" aria-live="polite">{lookupError}</p>
  {/if}
</div>

<style>
  .url-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lede {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .url-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    padding: 4px 4px 4px 10px;
  }
  .url-row input {
    flex: 1 1 auto;
    border: 0;
    background: transparent;
    font-family: inherit;
    font-size: 14px;
    padding: 9px 6px;
    min-height: 36px;
    color: var(--color-ink);
  }
  .url-row input:focus {
    outline: none;
  }
  .url-icon {
    display: grid;
    place-items: center;
    color: var(--color-ink-muted);
  }
  .url-row button {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 8px 14px;
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    min-height: 36px;
  }
  .url-row button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
  .existing {
    background: rgba(141, 174, 138, 0.14);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-card, 8px);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .existing p {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    color: var(--color-ink);
  }
  .primary {
    align-self: flex-start;
    background: var(--color-forest-deep);
    color: var(--color-paper);
    padding: 9px 18px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-size: 13.5px;
    font-weight: 600;
    min-height: 38px;
    display: inline-flex;
    align-items: center;
  }
  .error {
    margin: 0;
    color: var(--color-rust, #ba4b38);
    font-size: 13px;
    padding: 10px 14px;
    background: rgba(186, 75, 56, 0.08);
    border-left: 3px solid var(--color-rust, #ba4b38);
    border-radius: 4px;
  }
</style>
