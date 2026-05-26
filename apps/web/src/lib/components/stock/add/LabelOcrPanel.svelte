<script lang="ts">
  import { Camera, Image as ImageIcon, X } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import LabelCapture from '$lib/components/LabelCapture.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { draftFromScanResult, type StockEntryDraft } from '$lib/stock/normalizeStockEntry';

  /**
   * Phase 25d (#89) — Method 4 of the 5-method add waterfall.
   *
   * Operator photographs (or uploads) a product label; client base64-
   * encodes the image and POSTs `/api/scan-label`, which calls Claude
   * Vision to extract displayName / shortName / category / active
   * ingredients / formulation / seed metadata.
   *
   * #248 / CT-ST-007 — camera-first. The primary CTA mounts the
   * existing LabelCapture modal (getUserMedia + live <video>),
   * matching the Barcode tab's pattern. The file picker is now a
   * secondary "Upload from gallery" fallback for desktop + the
   * permission-denied case. When getUserMedia is unavailable at all
   * (no navigator.mediaDevices), the camera CTA self-hides and the
   * file picker is the only path. The /api/scan-label pipeline is
   * unchanged: both paths produce a data:image/jpeg base64 URL.
   *
   * #249 (Sprint 4) extends the file-picker path with multi-file
   * batch — add a queue state + per-row status. The CTA scaffold +
   * runExtract pipeline below are deliberately shaped to accept that
   * extension without restructuring.
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
    /** #250 / CT-ST-009 — Invariant 7. When the active user has no
     *  Anthropic key configured, this tab renders a pre-flight
     *  empty-state instead of letting the operator hit a dead-end
     *  after capturing a photo. Resolved via getUserAiEnabled() in
     *  the /stock/add loader. Defaults to false so legacy callers
     *  see the safer empty-state path. */
    aiEnabled?: boolean;
    /** #251 / CT-ST-010 — recovery from the no-key error path. The
     *  parent (/stock/add) handles tab switching; when the operator
     *  picks "Use Manual entry instead" the captured photo is
     *  preserved into the parent's manual draft (future enhancement)
     *  while this callback advances the tab. */
    onSwitchToManual?: () => void;
  }

  const { onSubmit, busy = false, aiEnabled = false, onSwitchToManual }: Props = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let preview = $state<string | null>(null); // data: URL for the preview card
  let extracting = $state(false);
  let extractError = $state<string | null>(null);
  // #248 — camera modal lifecycle. Mounted on demand so getUserMedia
  // only fires when the operator explicitly asks for the camera.
  let cameraOpen = $state(false);
  // Capability probe. False on desktop without a camera, in
  // browsers without mediaDevices, or when the page isn't served
  // over a secure context (getUserMedia is gated to HTTPS / localhost).
  let cameraSupported = $state(false);
  onMount(() => {
    cameraSupported =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function';
  });

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

  // #248 — handle the LabelCapture modal's onCapture. Modal yields a
  // bare base64 string (no data: prefix); wrap it so runExtract sees
  // the same shape as the file-picker path.
  async function handleCameraCapture(base64Jpeg: string): Promise<void> {
    cameraOpen = false;
    extractError = null;
    const dataUrl = `data:image/jpeg;base64,${base64Jpeg}`;
    try {
      preview = dataUrl;
      await runExtract(dataUrl);
    } catch (err) {
      extractError = err instanceof Error ? err.message : String(err);
    }
  }

  // #250 / #251 — detect the canonical no-key error string so the
  // error CTA can recover (link to settings + offer Manual) rather
  // than offer the useless "Try another photo" loop. The server
  // string lives at apps/web/src/lib/server/scanResult.ts:738.
  const isNoKeyError = $derived(
    !!extractError && /No Anthropic API key configured/i.test(extractError)
  );

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
    Snap the front of the package or the ingredient block. Claude Vision extracts the structured
    fields — every output gets a provenance tag so you can spot-check before save.
  </p>

  {#if !aiEnabled}
    <!-- #250 / CT-ST-009 — pre-flight empty-state when no Anthropic
         key is configured. Invariant 7 ("AI assists, never gates")
         requires no-key be a first-class product mode rather than a
         post-action error. We render an empty-state card with two
         recovery CTAs: configure the key (opens Settings in a new
         tab so the /stock/add state survives) or switch to Manual
         entry (no AI dependency).
         Spec: docs/design/almanac/AI_PROVENANCE_ADDENDUM.md §no-key. -->
    <div class="no-key-empty" data-empty-state="no-ai-key">
      <h3 class="no-key-empty-title">Claude key required for label extraction</h3>
      <p class="no-key-empty-lede">
        Scan Label uses Claude Vision to read product labels and pre-populate the inventory fields.
        Add an Anthropic API key on the Settings page to enable this method, or switch to Manual
        entry to type the fields in yourself.
      </p>
      <div class="no-key-empty-actions">
        <a
          class="capture-tile capture-tile-primary capture-tile-inline"
          href="/settings/ai"
          target="_blank"
          rel="noopener"
          data-action="configure-ai"
        >
          Configure AI key ↗
        </a>
        {#if onSwitchToManual}
          <button
            type="button"
            class="upload-tile upload-tile-secondary upload-tile-inline"
            onclick={onSwitchToManual}
            data-action="switch-to-manual"
          >
            Switch to Manual entry →
          </button>
        {/if}
      </div>
    </div>
  {:else if !preview}
    <!-- #248 / CT-ST-007 — camera-first. Primary CTA opens the
         LabelCapture modal (live <video> getUserMedia feed) so the
         operator never lands on the OS photo-roll first. When the
         browser can't do getUserMedia at all (desktop without
         camera / insecure context / older browser) we hide the
         camera button so the upload tile is the only path — no
         broken affordance. -->
    {#if cameraSupported}
      <button
        type="button"
        class="capture-tile capture-tile-primary"
        onclick={() => (cameraOpen = true)}
        disabled={busy || extracting}
        data-action="open-camera"
      >
        <Camera size={32} strokeWidth={1.5} aria-hidden="true" />
        <span class="capture-tile-label">Take photo</span>
        <span class="capture-tile-hint">Live camera · rear-facing</span>
      </button>
    {/if}
    <!-- File picker = fallback. Sprint 4 (#249) adds `multiple` here
         + a per-row queue UI for batch unboxing. -->
    <label
      class="upload-tile"
      class:upload-tile-secondary={cameraSupported}
      class:disabled={busy || extracting}
    >
      <ImageIcon size={cameraSupported ? 24 : 32} strokeWidth={1.5} aria-hidden="true" />
      <span class="upload-label"
        >{cameraSupported ? 'Or upload from gallery' : 'Upload a photo'}</span
      >
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

  {#if cameraOpen}
    <LabelCapture onCapture={handleCameraCapture} onClose={() => (cameraOpen = false)} />
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
    <!-- #251 / CT-ST-010 — recovery CTAs. The dead-end "Try another
         photo" loop is fine for transient extraction failures (bad
         lighting, blurry text) but useless for the no-key case
         where re-trying without a key fails identically. Branch on
         isNoKeyError so the user always has a real next step. -->
    {#if isNoKeyError}
      <div class="error-actions">
        <a
          class="capture-tile capture-tile-primary capture-tile-inline"
          href="/settings/ai"
          target="_blank"
          rel="noopener"
          data-action="configure-ai-from-error"
        >
          Add Claude key ↗
        </a>
        {#if onSwitchToManual}
          <button
            type="button"
            class="upload-tile upload-tile-secondary upload-tile-inline"
            onclick={() => {
              clear();
              onSwitchToManual?.();
            }}
            disabled={busy}
            data-action="switch-to-manual-from-error"
          >
            Use Manual entry instead →
          </button>
        {/if}
      </div>
    {:else}
      <button type="button" class="ghost" onclick={clear} disabled={busy || extracting}>
        Try another photo
      </button>
    {/if}
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
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
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
  /* #248 — when the camera CTA is the primary, demote the upload
     tile so the visual hierarchy reads "camera first, gallery
     second" without removing the affordance entirely. */
  .upload-tile.upload-tile-secondary {
    padding: 18px 20px;
    border-width: 1px;
    background: transparent;
  }
  /* #248 — primary camera CTA. Solid forest fill mirrors the
     primary-action treatment used elsewhere in the wizard so the
     "Take photo" affordance reads as the recommended path. */
  .capture-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 36px 20px;
    border: none;
    border-radius: var(--radius-card, 8px);
    background: var(--color-forest-deep);
    color: var(--color-cream);
    cursor: pointer;
    text-align: center;
    font: inherit;
    transition:
      filter 0.15s ease,
      background 0.15s ease;
    min-height: 48px;
  }
  .capture-tile:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .capture-tile:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .capture-tile-label {
    font-size: 15px;
    font-weight: 700;
    margin-top: 2px;
  }
  .capture-tile-hint {
    font-size: 11.5px;
    opacity: 0.85;
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

  /* #250 / CT-ST-009 — pre-flight no-key empty-state. Same visual
     register as the wizard-Seeds empty-state from #175 so the
     "what's missing + how to recover" pattern is consistent
     across AI-dependent surfaces. */
  .no-key-empty {
    border: 1px solid var(--color-divider, #d8dcd1);
    border-radius: 12px;
    padding: 1.25rem 1.4rem 1.4rem;
    background: var(--color-cream, #fbfaf3);
  }
  .no-key-empty-title {
    margin: 0 0 0.4rem 0;
    font-size: 1.05rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .no-key-empty-lede {
    margin: 0 0 1rem 0;
    color: #4a5a4a;
    line-height: 1.45;
  }
  .no-key-empty-actions,
  .error-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: stretch;
  }
  /* #250 / #251 — inline variant of the capture/upload tiles so the
     recovery CTAs sit side-by-side rather than stacking full-width.
     Re-uses .capture-tile and .upload-tile primitives so a future
     redesign only touches the base classes. */
  .capture-tile-inline,
  .upload-tile-inline {
    padding: 12px 18px !important;
    min-height: 44px;
    flex-direction: row !important;
    gap: 8px !important;
    text-decoration: none;
  }
</style>
