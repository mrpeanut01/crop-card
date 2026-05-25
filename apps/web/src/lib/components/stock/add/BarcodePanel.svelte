<script lang="ts">
  import { ScanBarcode } from 'lucide-svelte';
  import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { draftFromScanResult, type StockEntryDraft } from '$lib/stock/normalizeStockEntry';

  /**
   * Phase 25d (#89) — Method 3 of the 5-method add waterfall.
   *
   * Camera-driven barcode lookup. Reuses the existing
   * `lib/components/BarcodeScanner.svelte` (native BarcodeDetector with
   * @zxing/library fallback) for the capture pipeline, then POSTs the
   * raw barcode to `/api/scan-barcode` which already runs the
   * OpenFoodFacts → Claude-text-lookup waterfall server-side.
   *
   * The endpoint returns a `ScanResult` shape which we project into a
   * `StockEntryDraft` via the shared `draftFromScanResult()` bridge.
   * If the barcode resolves to an existing SKU, we hint the operator
   * to add a lot/quantity to that item instead of creating a duplicate.
   */

  interface Props {
    onSubmit: (draft: StockEntryDraft) => void | Promise<void>;
    busy?: boolean;
  }

  const { onSubmit, busy = false }: Props = $props();

  let scannerOpen = $state(false);
  let lookingUp = $state(false);
  let lookupError = $state<string | null>(null);
  let lastBarcode = $state<string | null>(null);
  let existingItemId = $state<string | null>(null);

  async function handleDetected(rawValue: string, _format: string): Promise<void> {
    scannerOpen = false;
    lastBarcode = rawValue;
    existingItemId = null;
    lookupError = null;
    lookingUp = true;
    try {
      const res = await fetch('/api/scan-barcode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ barcode: rawValue })
      });
      const body = await res.json();
      if (!res.ok) {
        lookupError = body.message ?? body.error ?? `HTTP ${res.status}`;
        return;
      }
      if (body.existingStockItemId) {
        existingItemId = body.existingStockItemId;
        return;
      }
      if (!body.found) {
        lookupError =
          'Barcode not in OpenFoodFacts or Claude could not identify it. Try the Label scan tab next, or use Manual.';
        return;
      }
      // Bridge ScanResult → StockEntryDraft. The barcode tier carries
      // ai source for everything Claude inferred + plugin source for
      // a high-confidence crop-plugin match (handled by the bridge).
      const draft = draftFromScanResult(body, body.source === 'openfoodfacts' ? 'data' : 'ai');
      draft.barcode = rawValue;
      await onSubmit(draft);
    } catch (e) {
      lookupError = e instanceof Error ? e.message : String(e);
    } finally {
      lookingUp = false;
    }
  }

  function startOver(): void {
    lastBarcode = null;
    existingItemId = null;
    lookupError = null;
    scannerOpen = true;
  }
</script>

<div class="barcode-panel">
  <p class="lede">
    Point your camera at the package barcode (UPC / EAN). The lookup uses OpenFoodFacts first (free,
    deterministic) and falls back to Claude when the product isn't in their database.
  </p>

  {#if !scannerOpen && !lookingUp && !lastBarcode}
    <button type="button" class="open-cam" onclick={() => (scannerOpen = true)} disabled={busy}>
      <ScanBarcode size={20} strokeWidth={1.75} />
      Open camera
    </button>
  {/if}

  {#if scannerOpen}
    <div class="scanner-frame">
      <BarcodeScanner onDetected={handleDetected} onClose={() => (scannerOpen = false)} />
    </div>
  {/if}

  {#if lookingUp && lastBarcode}
    <div class="status looking" aria-live="polite">
      Looking up <span class="mono">{lastBarcode}</span>…
    </div>
  {/if}

  {#if existingItemId}
    <div class="existing">
      <p>
        This barcode is already in your inventory.
        <Provenance source="data" compact />
      </p>
      <div class="existing-actions">
        <a class="primary" href="/stock/{existingItemId}?added-lot=1"> Add a lot to that item → </a>
        <button type="button" class="ghost" onclick={startOver}>Scan another</button>
      </div>
    </div>
  {/if}

  {#if lookupError}
    <p class="error" aria-live="polite">{lookupError}</p>
    {#if !scannerOpen}
      <button type="button" class="ghost" onclick={startOver}>Try again</button>
    {/if}
  {/if}
</div>

<style>
  .barcode-panel {
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
  .open-cam {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 12px 22px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }
  .open-cam:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .open-cam:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .scanner-frame {
    background: #000;
    border-radius: var(--radius-card, 8px);
    overflow: hidden;
    aspect-ratio: 4 / 3;
    display: grid;
    place-items: stretch;
  }
  .status {
    padding: 10px 14px;
    background: var(--color-cream);
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    color: var(--color-ink);
  }
  .status .mono {
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
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
  .existing-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .primary {
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
  .ghost {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 8px 16px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    min-height: 38px;
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
