<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';

  interface Member {
    id: string;
    name: string;
    role: string;
  }
  interface Props {
    open: boolean;
    taskId: string;
    title: string;
    currentAssigneeId: string | null;
    onClose: () => void;
    /** Called after the server saved the change. */
    onAssigned: (assigneeName: string | null) => void;
  }
  const { open, taskId, title, currentAssigneeId, onClose, onAssigned }: Props = $props();

  let members = $state<Member[] | null>(null);
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let busy = $state(false);

  const ROLE_LABEL: Record<string, string> = {
    owner: 'Owner',
    helper: 'Helper',
    'custom-operator': 'Custom operator'
  };

  async function load() {
    loadError = null;
    try {
      const res = await fetch('/api/tasks/assignees');
      const body = (await res.json().catch(() => ({}))) as {
        assignees?: Member[];
        error?: string;
      };
      if (!res.ok) {
        loadError = body.error ?? 'Could not load the farm members.';
        return;
      }
      members = body.assignees ?? [];
    } catch {
      loadError = 'Giving out jobs needs signal. Try again when you are back online.';
    }
  }

  $effect(() => {
    if (open && members === null) void load();
    if (!open) saveError = null;
  });

  async function assign(id: string | null, name: string | null) {
    busy = true;
    saveError = null;
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'assign', assigneeUserId: id })
      });
      if (!res.ok) {
        const out = (await res.json().catch(() => ({}))) as { error?: string };
        saveError = out.error ?? `That did not save. The server said ${res.status}.`;
        return;
      }
      onAssigned(name);
    } catch {
      saveError = 'Giving out jobs needs signal. Try again when you are back online.';
    } finally {
      busy = false;
    }
  }
</script>

<Modal {open} {onClose} title="Who is doing this?">
  <div class="assign" data-testid="assign-sheet">
    <p class="job">{title}</p>
    {#if loadError}
      <p class="error" role="alert">{loadError}</p>
    {:else if members === null}
      <p class="hint" role="status">Loading the farm members…</p>
    {:else}
      <ul class="people" aria-label="Farm members">
        {#each members as m (m.id)}
          <li>
            <button
              type="button"
              class="person"
              aria-pressed={currentAssigneeId === m.id}
              disabled={busy}
              onclick={() => assign(m.id, m.name)}
              ><span class="name">{m.name}</span><span class="role"
                >{ROLE_LABEL[m.role] ?? m.role}</span
              ></button
            >
          </li>
        {/each}
        <li>
          <button
            type="button"
            class="person"
            aria-pressed={currentAssigneeId === null}
            disabled={busy}
            onclick={() => assign(null, null)}
            ><span class="name">Nobody in particular</span></button
          >
        </li>
      </ul>
    {/if}
    {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
  </div>
</Modal>

<style>
  .assign {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .job,
  .hint {
    margin: 0;
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .error {
    margin: 0;
    color: var(--pill-rust-fg);
    font-weight: 600;
  }
  .people {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .person {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 48px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .person[aria-pressed='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
  }
  .person:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .person:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .role {
    color: var(--color-ink-soft);
    font-size: var(--font-size-meta);
  }
</style>
