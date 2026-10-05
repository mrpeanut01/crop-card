<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

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
    /** Owners pick who does it (F1-2); the list loads when the form opens. */
    canAssign?: boolean;
    onClose: () => void;
    onCreated: (taskId: string) => void | Promise<void>;
  }

  const {
    open,
    blockId,
    blockName,
    plantings = [],
    defaultPlantingId = null,
    canAssign = false,
    onClose,
    onCreated
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  function todayIso(): string {
    return fmt.today();
  }

  let title = $state('');
  let date = $state(todayIso());
  let plantingId = $state('');
  let notes = $state('');
  let assigneeId = $state('');
  let members = $state<{ id: string; name: string }[] | null>(null);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  // Reset only when the form opens: the assignee list arriving (or a parent
  // re-render) must not wipe what the owner has already typed.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      title = '';
      date = todayIso();
      plantingId = defaultPlantingId ?? '';
      notes = '';
      assigneeId = '';
      error = null;
      if (canAssign && members === null) void loadMembers();
    });
  });

  async function loadMembers() {
    try {
      const res = await fetch('/api/tasks/assignees');
      if (!res.ok) return;
      const body = (await res.json()) as { assignees?: { id: string; name: string }[] };
      members = body.assignees ?? [];
    } catch {
      members = null;
    }
  }

  function close() {
    if (!submitting) onClose();
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!blockId) {
      error = tr('planui.task.noBlock');
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      error = tr('planui.task.needTitle');
      return;
    }
    const scheduledFor = Date.parse(date);
    if (!Number.isFinite(scheduledFor)) {
      error = tr('planui.task.needDate');
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
    if (canAssign && assigneeId) payload.assigneeUserId = assigneeId;
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

<Modal {open} onClose={close} title={tr('planui.task.modalTitle')}>
  <form id="add-task-form" class="form" onsubmit={handleSubmit}>
    <p class="muted">{tr('planui.task.scheduling')} <strong>{blockName}</strong></p>
    <label class="field">
      <span class="label"
        >{tr('planui.task.task')} <span class="req" aria-hidden="true">*</span></span
      >
      <input
        type="text"
        name="title"
        bind:value={title}
        required
        maxlength="120"
        placeholder={tr('planui.task.placeholder')}
      />
    </label>
    <label class="field">
      <span class="label"
        >{tr('planui.task.date')} <span class="req" aria-hidden="true">*</span></span
      >
      <input type="date" name="date" bind:value={date} required />
      <span class="hint">{tr('planui.task.dateHint')}</span>
    </label>
    {#if plantings.length > 0}
      <label class="field">
        <span class="label">{tr('planui.task.planting')}</span>
        <select name="planting" bind:value={plantingId}>
          <option value="">{tr('planui.task.wholeBlock')}</option>
          {#each plantings as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if canAssign && members && members.length > 0}
      <label class="field">
        <span class="label">{tr('planui.task.who')}</span>
        <select name="assignee" bind:value={assigneeId}>
          <option value="">{tr('planui.task.nobody')}</option>
          {#each members as m (m.id)}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="field">
      <span class="label">{tr('planui.task.notes')}</span>
      <textarea name="notes" rows="2" maxlength="500" bind:value={notes}></textarea>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn-secondary" onclick={close} disabled={submitting}>
        {tr('planui.task.cancel')}
      </button>
      <button type="submit" class="btn-primary" disabled={submitting}>
        {submitting ? tr('planui.task.adding') : tr('planui.task.add')}
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
