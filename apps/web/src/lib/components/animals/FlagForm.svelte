<script lang="ts">
  import './animalForms.css';
  import { OFFLINE_MESSAGE, errorFromResponse } from '$lib/animals/display';

  interface Props {
    subjectType: 'animal' | 'group';
    subjectId: string;
    flag: 'foodProducing' | 'notForSlaughter';
    current: boolean;
    onDone: (text: string) => void | Promise<void>;
  }

  const { subjectType, subjectId, flag, current, onDone }: Props = $props();
  const uid = $props.id();

  let open = $state(false);
  let reason = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  const next = $derived(!current);
  const title = $derived(
    flag === 'foodProducing'
      ? next
        ? 'Mark as a food animal'
        : 'Mark as not a food animal'
      : next
        ? 'Mark not for slaughter'
        : 'Remove the not-for-slaughter mark'
  );
  const warning = $derived(
    flag === 'foodProducing'
      ? next
        ? 'Medicine withdrawal times will apply to it from now on.'
        : 'Only do this if no one will eat its eggs, milk or meat, ever. Medicine withdrawal times will no longer be checked for it, and this change is recorded with your reason.'
      : 'This is a record for your own files. It does not change whether it counts as a food animal, and a banned medicine still blocks its meat.'
  );
  const strong = $derived(flag === 'foodProducing' && !next);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (!reason.trim()) {
      error = 'Say why, so the record shows it.';
      return;
    }
    saving = true;
    try {
      const url =
        subjectType === 'group' ? `/api/animal-groups/${subjectId}` : `/api/animals/${subjectId}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [flag]: next, flagReason: reason.trim() })
      });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      open = false;
      reason = '';
      await onDone('Saved. The change is in the history.');
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      saving = false;
    }
  }
</script>

{#if !open}
  <button type="button" class="af-ghost" onclick={() => (open = true)}>{title}</button>
{:else}
  <form class="af-form flag-form" onsubmit={submit} novalidate aria-label={title}>
    <p class={strong ? 'strong' : 'af-note'} role={strong ? 'alert' : 'note'}>{warning}</p>
    <label class="af-label" for="{uid}-reason">Why?</label>
    <input
      id="{uid}-reason"
      class="af-input"
      type="text"
      maxlength="500"
      bind:value={reason}
      data-autofocus
    />
    {#if error}<p class="af-error" role="alert">{error}</p>{/if}
    <div class="buttons">
      <button class="af-primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : title}
      </button>
      <button type="button" class="af-ghost" onclick={() => (open = false)}>Cancel</button>
    </div>
  </form>
{/if}

<style>
  .flag-form {
    padding: var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
  }
  .strong {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-rust-bg);
    color: var(--pill-rust-fg);
    border: 1px solid var(--pill-rust-bd);
    font-weight: 600;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
