<script lang="ts">
  import { Image as ImageIcon, X } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    draftFromScanResult,
    type StockEntryDraft
  } from '$lib/stock/normalizeStockEntry';

  /**
   * Phase 25d (#89) — Method 4 of the 5-method add waterfall.
   *
   * Operator photographs (or uploads) a product label; client base64-
   * encodes the image and POSTs `/api/scan-label`, which calls Claude
   * Vision to extract displayName / shortName / category / active
   * ingredients / formulation / seed metadata.
   *
   * Mobile devices get the rear camera via `capture="environment"`;
   * desktop falls back to a file picker. Either way the path through
   * the pipeline is the same.
   *
   * Per the v2 provenance addendum the resulting draft carries
   * `source: 'ai'` (everything came from Claude Vision). The Provenance
   * tags on the confirm step let the operator audit each field before
   * submit — lot # always stays `manual` because the operator types
   * it on the item page after add.
   */

  interface Props {
    onSubmit: (draft: StockEntryDraft) => void | Promise<void>;
    busy?: boolean;
  }

  const { onSubmit, busy = false }: Props = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let preview = $state<string | null>(null); // data: URL for the preview card
  let extracting = $state(false);
  let extractError = $state<string | null>(null);

  /** Convert a File → base64 data URL (the shape /api/scan-label expects). */
  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error ?? new Error('file read failed'));
      r.readAsDataURL(file);
    });
  }

  async function handleFileChange(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    extractError = null;
    try {
      const dataUrl = await readAsDataUrl(file);
      preview = dataUrl;
      await runExtract(dataUrl);
    } catch (err) {
      extractError = err instanceof Error ? err.message : String(err);
    } finally {
      // Reset so the same file can be re-picked after an error.
      if (input) input.value = '';
    }
  }

  async function runExtract(dataUrl: string): Promise<void> {
    extracting = true;
    extractError = null;
    try {
      const res = await fetch('/api/scan-label', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      });
      const body = await res.json();
      if (!res.ok) {
        extractError = body.message ?? body.error ?? `HTTP ${res.status}`;
        return;
      }
      if (!body.found) {
        extractError =
          'Claude could not identify the product. Try a clearer photo, the Barcode scanner, or Manual entry.';
        return;
      }
      const draft = draftFromScanResult(body, 'ai');
      await onSubmit(draft);
    } catch (err) {
      extractError = err instanceof Error ? err.message : String(err);
    } finally {
      extracting = false;
    }
  }

  function clear(): void {
    preview = null;
    extractError = null;
  }
</script>

<div class="ocr-panel">
  <p class="lede">
    Snap the front of the package or the ingredient block. Claude Vision extracts the
    structured fields — every output gets a provenance tag so you can spot-check before save.
  </p>

  {#if !preview}
    <label class="upload-tile" class:disabled={busy || extracting}>
      <ImageIcon size={32} strokeWidth={1.5} />
      <span class="upload-label">Take or upload a photo</span>
      <span class="upload-hint">JPG / PNG / HEIC, ≤ 10 MB</span>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        onchange={handleFileChange}
        disabled={busy || extracting}
      />
    </label>
  {/if}

  {#if preview}
    <figure class="preview">
      <img src={preview} alt="Label preview" />
      <figcaption>
        <span class="prov-row">
          Image source <Provenance source="manual" compact />
          → extraction <Provenance source="ai" compact />
        </span>
        <button
          type="button"
          aria-label="Clear preview"
          onclick={clear}
          disabled={busy || extracting}
        >
          <X size={14} />
        </button>
      </figcaption>
    </figure>
  {/if}

  {#if extracting}
    <div class="status" aria-live="polite">
      Reading the label with Claude Vision… this can take 5-15 seconds.
    </div>
  {/if}

  {#if extractError}
    <p class="error" aria-live="polite">{extractError}</p>
    <button type="button" class="ghost" onclick={clear} disabled={busy || extracting}>
      Try another photo
    </button>
  {/if}
</div>

<style>
  .ocr-panel {
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
  .upload-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 36px 20px;
    border: 2px dashed var(--color-divider);
    border-radius: var(--radius-card, 8px);
    background: var(--color-cream);
    color: var(--color-ink-soft);
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .upload-tile:hover {
    border-color: var(--color-forest-deep);
    background: var(--color-paper);
  }
  .upload-tile.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .upload-tile input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
  .upload-label {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--color-ink);
    margin-top: 2px;
  }
  .upload-hint {
    font-size: 11.5px;
    color: var(--color-ink-muted);
  }
  .preview {
    margin: 0;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .preview img {
    width: 100%;
    max-height: 320px;
    object-fit: contain;
    background: #000;
    display: block;
  }
  .preview figcaption {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
    padding: 8px 12px;
    border-top: 1px solid var(--color-divider-soft);
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .prov-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .preview figcaption button {
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--color-ink-muted);
    padding: 4px;
    border-radius: 4px;
    display: grid;
    place-items: center;
  }
  .preview figcaption button:hover:not(:disabled) {
    color: var(--color-ink);
    background: var(--color-cream);
  }
  .preview figcaption button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .status {
    padding: 10px 14px;
    background: var(--color-cream);
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    color: var(--color-ink-soft);
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
  .ghost {
    align-self: flex-start;
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
</style>
