<script lang="ts">
  /**
   * Sprint 3 (#186 / FP-002) — inline "+ Add planting" modal.
   *
   * In-place planting create form for the Plan v2 shell. Replaces the
   * legacy `<details>` editor redirect on the `+ Add planting` CTA.
   * Posts to `POST /api/blocks/[blockId]/plantings`. Sister to
   * NewBlockModal — same visual register so the two CTAs read as
   * consistent inline gestures rather than two different escape
   * hatches.
   */
  import { X } from 'lucide-svelte';

  type CropCatalogEntry = { pluginId: string; displayName: string; cropFamily?: string };

  interface Props {
    open: boolean;
    blockId: string | null;
    blockName: string;
    cropCatalog: CropCatalogEntry[];
    onClose: () => void;
    onCreated: (plantingId: string) => void;
  }

  const { open, blockId, blockName, cropCatalog, onClose, onCreated }: Props = $props();

  let cropPluginId = $state('');
  let varietyDisplayName = $state('');
  let plantingDate = $state<string>(''); // ISO yyyy-mm-dd or empty
  let quantityPlanted = $state<number | null>(null);
  let quantityUnit = $state<string>('seeds');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const selectedPlugin = $derived(cropCatalog.find((c) => c.pluginId === cropPluginId));

  $effect(() => {
    if (selectedPlugin && !varietyDisplayName) {
      varietyDisplayName = selectedPlugin.displayName;
    }
  });

  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!cropPluginId) {
      error = 'Pick a crop plugin first';
      return;
    }
    if (!blockId) {
      error = 'No block selected';
      return;
    }
    submitting = true;
    error = null;
    const payload: Record<string, unknown> = {
      cropPluginId,
      varietyDisplayName: varietyDisplayName.trim() || undefined
    };
    if (plantingDate) {
      const ms = Date.parse(`${plantingDate}T00:00:00`);
      if (Number.isFinite(ms)) payload.plantingDate = ms;
    }
    if (quantityPlanted != null && quantityPlanted > 0) {
      payload.quantityPlanted = quantityPlanted;
      payload.quantityUnit = quantityUnit;
    }
    try {
      const res = await fetch(`/api/blocks/${blockId}/plantings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        error = body.error ?? `HTTP ${res.status}`;
        return;
      }
      const body = (await res.json()) as { planting: { id: string } };
      cropPluginId = '';
      varietyDisplayName = '';
      plantingDate = '';
      quantityPlanted = null;
      onCreated(body.planting.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !submitting) onClose();
  }
</script>

<svelte:window on:keydown={(e) => open && onKey(e)} />

{#if open}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget && !submitting) onClose();
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="new-planting-title">
      <header class="modal-header">
        <h2 id="new-planting-title" class="serif">Add planting</h2>
        <button type="button" class="close" onclick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <form onsubmit={handleSubmit} class="modal-form">
        <p class="muted">Adding to <strong>{blockName}</strong></p>
        <label class="field">
          <span class="label">Crop <span class="req" aria-hidden="true">*</span></span>
          <select bind:value={cropPluginId} required>
            <option value="">— pick a crop —</option>
            {#each cropCatalog as c (c.pluginId)}
              <option value={c.pluginId}>
                {c.displayName}{c.cropFamily ? ` (${c.cropFamily})` : ''}
              </option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span class="label">Variety display name</span>
          <input
            type="text"
            bind:value={varietyDisplayName}
            placeholder="Falls back to the plugin's display name"
            maxlength="160"
          />
        </label>
        <label class="field">
          <span class="label">Planting date</span>
          <input type="date" bind:value={plantingDate} />
          <span class="hint">Leave empty to plan as undated.</span>
        </label>
        <div class="quantity-row">
          <label class="field flex-2">
            <span class="label">Quantity</span>
            <input
              type="number"
              step="0.01"
              min="0"
              bind:value={quantityPlanted}
              placeholder="Optional"
            />
          </label>
          <label class="field flex-1">
            <span class="label">Unit</span>
            <select bind:value={quantityUnit}>
              <option value="seeds">seeds</option>
              <option value="count">count</option>
              <option value="packets">packets</option>
              <option value="lb">lb</option>
              <option value="oz">oz</option>
            </select>
          </label>
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <footer class="modal-footer">
          <button type="button" class="btn-secondary" onclick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" class="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Add planting'}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(31, 53, 34, 0.45);
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .modal {
    background: var(--color-paper);
    border-radius: 12px;
    width: min(480px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 22px 12px;
    border-bottom: 1px solid var(--color-divider);
  }
  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .close {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 6px;
    border-radius: 999px;
    color: var(--color-ink-muted);
  }
  .close:hover {
    background: var(--color-divider-soft, var(--color-divider));
    color: var(--color-forest-deep, #1f3522);
  }
  .modal-form {
    padding: 18px 22px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .muted {
    color: var(--color-ink-muted);
    margin: 0 0 4px;
    font-size: 0.9rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
  }
  .req {
    color: var(--color-rust, #a23a3a);
  }
  input,
  select {
    padding: 10px 12px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    font: inherit;
    background: var(--color-paper);
  }
  input:focus,
  select:focus {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--color-ink-muted);
  }
  .quantity-row {
    display: flex;
    gap: 10px;
  }
  .flex-1 {
    flex: 1;
  }
  .flex-2 {
    flex: 2;
  }
  .error {
    color: var(--color-rust, #a23a3a);
    background: #fdecea;
    border: 1px solid #f1c0bb;
    padding: 8px 10px;
    border-radius: 6px;
    margin: 0;
    font-size: 0.85rem;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 6px;
  }
  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary {
    background: var(--color-forest);
    color: var(--color-cream, #fff8e1);
  }
  .btn-primary:hover {
    background: var(--color-forest-deep, #1f3522);
  }
  .btn-secondary {
    background: transparent;
    color: var(--color-forest-deep, #1f3522);
    border-color: var(--color-divider);
  }
  .btn-secondary:hover {
    border-color: var(--color-forest-deep, #1f3522);
  }
  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
