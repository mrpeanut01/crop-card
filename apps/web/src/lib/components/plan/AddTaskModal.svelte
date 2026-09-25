<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';

  export interface AddTaskPlantingOption {
    id: string;
    label: string;
  }

  interface Props {
    open: boolean;
    blockId: string | null;
    blockName: string;
    plantings?: AddTaskPlantingOption[];
    /** Preselects the planting when a planting tab is active. */
    defaultPlantingId?: string | null;
    onClose: () => void;
    onCreated: (taskId: string) => void | Promise<void>;
  }

  const {
    open,
    blockId,
    blockName,
    plantings = [],
    defaultPlantingId = null,
    onClose,
    onCreated
  }: Props = $props();

  function todayIso(): string {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  let title = $state('');
  let date = $state(todayIso());
  let plantingId = $state('');
  let notes = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open) {
      title = '';
      date = todayIso();
      plantingId = defaultPlantingId ?? '';
      notes = '';
      error = null;
    }
  });

  function close() {
    if (!submitting) onClose();
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!blockId) {
      error = 'No block selected';
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      error = 'Give the task a title';
      return;
    }
    const scheduledFor = Date.parse(`${date}T00:00:00`);
    if (!Number.isFinite(scheduledFor)) {
      error = 'Pick a date';
      return;
    }
    submitting = true;
    error = null;
    const payload: Record<string, unknown> = {
      title: trimmed,
      kind: 'primary',
      blockId,
      scheduledFor
    };
    if (plantingId) payload.cropId = plantingId;
    if (notes.trim()) payload.body = notes.trim();
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        error = body.error ?? `HTTP ${res.status}`;
        return;
      }
      await onCreated(body.task?.id ?? '');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }
</script>

<Modal {open} onClose={close} title="Add task">
  <form id="add-task-form" class="form" onsubmit={handleSubmit}>
    <p class="muted">Scheduling on <strong>{blockName}</strong></p>
    <label class="field">
      <span class="label">Task <span class="req" aria-hidden="true">*</span></span>
      <input
        type="text"
        name="title"
        bind:value={title}
        required
        maxlength="120"
        placeholder="e.g. Side-dress nitrogen"
      />
    </label>
    <label class="field">
      <span class="label">Date <span class="req" aria-hidden="true">*</span></span>
      <input type="date" name="date" bind:value={date} required />
      <span class="hint">The table shows the next 30 days; later tasks appear on /today.</span>
    </label>
    {#if plantings.length > 0}
      <label class="field">
        <span class="label">Planting</span>
        <select name="planting" bind:value={plantingId}>
          <option value="">Whole block</option>
          {#each plantings as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="field">
      <span class="label">Notes</span>
      <textarea name="notes" rows="2" maxlength="500" bind:value={notes}></textarea>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn-secondary" onclick={close} disabled={submitting}>
        Cancel
      </button>
      <button type="submit" class="btn-primary" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add task'}
      </button>
    </div>
  </form>
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .muted {
    margin: 0;
    color: var(--color-ink-muted);
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
    color: var(--color-forest-deep);
  }
  .req {
    color: var(--color-rust);
  }
  input,
  select,
  textarea {
    min-height: 48px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    font: inherit;
    background: var(--color-paper);
    color: var(--color-ink);
  }
  input:focus,
  select:focus,
  textarea:focus {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--color-ink-muted);
  }
  .error {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--pill-rust-bg);
    color: var(--pill-rust-fg);
    border: 1px solid var(--pill-rust-bd);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn-primary,
  .btn-secondary {
    min-height: 48px;
    padding: 8px 18px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary {
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .btn-primary:hover {
    background: var(--color-forest-deep);
  }
  .btn-secondary {
    background: transparent;
    color: var(--color-forest-deep);
    border-color: var(--color-divider);
  }
  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
