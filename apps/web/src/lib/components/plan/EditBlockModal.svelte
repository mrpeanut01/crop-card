<script lang="ts">
  import { X } from 'lucide-svelte';

  interface BlockSeed {
    id: string;
    name: string;
    blockLabel?: string;
    acres?: number;
  }

  interface Props {
    open: boolean;
    block: BlockSeed | null;
    legacyEditorHref: string;
    onClose: () => void;
    onSaved: () => void;
  }

  const { open, block, legacyEditorHref, onClose, onSaved }: Props = $props();

  let name = $state('');
  let blockLabel = $state('');
  let acres = $state<number | null>(null);
  let submitting = $state(false);
  let saveError = $state<string | null>(null);

  $effect(() => {
    if (open && block) {
      name = block.name;
      blockLabel = block.blockLabel ?? '';
      acres = block.acres ?? null;
      saveError = null;
    }
  });

  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!block) return;
    if (!name.trim()) {
      saveError = 'Block name is required';
      return;
    }
    submitting = true;
    saveError = null;
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          blockLabel: blockLabel.trim() || null,
          acres: acres != null && acres > 0 ? acres : null
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        saveError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      onSaved();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !submitting) onClose();
  }
</script>

<svelte:window on:keydown={(e) => open && onKey(e)} />

{#if open && block}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget && !submitting) onClose();
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-block-title">
      <header class="modal-header">
        <h2 id="edit-block-title" class="serif">Edit block</h2>
        <button type="button" class="close" onclick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <form onsubmit={handleSubmit} class="modal-form">
        <label class="field">
          <span class="label">Name <span class="req" aria-hidden="true">*</span></span>
          <input
            type="text"
            bind:value={name}
            placeholder="e.g. East Field"
            required
            maxlength="120"
          />
        </label>
        <label class="field">
          <span class="label">Short label</span>
          <input
            type="text"
            bind:value={blockLabel}
            placeholder="e.g. EF (used in compact UI)"
            maxlength="60"
          />
        </label>
        <label class="field">
          <span class="label">Acres</span>
          <input type="number" step="0.01" min="0" bind:value={acres} placeholder="Optional" />
          <span class="hint">
            <a href={legacyEditorHref}>Edit geometry on map →</a>
          </span>
        </label>
        {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
        <footer class="modal-footer">
          <button type="button" class="btn-secondary" onclick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" class="btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
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
    width: min(440px, 100%);
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
  input {
    padding: 10px 12px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    font: inherit;
    background: var(--color-paper);
  }
  input:focus {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--color-ink-muted);
  }
  .hint a {
    color: var(--color-forest);
    text-decoration: underline;
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
