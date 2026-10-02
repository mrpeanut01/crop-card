<script lang="ts">
  import { untrack } from 'svelte';
  import './animalForms.css';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { errorText, groupNoun } from './labels';

  interface Props {
    group: { id: string; name: string; notes: string | null; headCount: number };
    noun: string;
    onDone: () => void | Promise<void>;
  }

  const { group, noun, onDone }: Props = $props();
  const uid = $props.id();
  const tr = $derived(createT(page.data?.locale));
  const start = untrack(() => group);

  let name = $state(start.name);
  let notes = $state(start.notes ?? '');
  let headCount = $state<number | null>(start.headCount);
  let countReason = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const body: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== group.name) body.name = name.trim();
    const n = notes.trim() ? notes.trim() : null;
    if (n !== group.notes) body.notes = n;
    if (headCount !== null && headCount !== group.headCount) {
      if (!Number.isInteger(headCount) || headCount < 0) {
        error = tr('animals.group.countWhole');
        return;
      }
      if (headCount < group.headCount) {
        error = tr('animals.group.lowerCount');
        return;
      }
      body.headCount = headCount;
      if (countReason.trim()) body.countReason = countReason.trim();
    }
    if (Object.keys(body).length === 0) {
      await onDone();
      return;
    }
    saving = true;
    try {
      const res = await fetch(`/api/animal-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        error = await errorText(res, tr);
        return;
      }
      await onDone();
    } catch {
      error = tr('animals.offline');
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="af-form"
  onsubmit={submit}
  novalidate
  aria-label={tr('animals.group.editAria', { noun: groupNoun(tr, noun) })}
>
  <label class="af-label" for="{uid}-name">{tr('animals.name')}</label>
  <input id="{uid}-name" class="af-input" type="text" maxlength="80" bind:value={name} />
  <label class="af-label" for="{uid}-count">{tr('animals.group.unnamedCount')}</label>
  <input
    id="{uid}-count"
    class="af-input"
    type="number"
    min={group.headCount}
    step="1"
    inputmode="numeric"
    bind:value={headCount}
  />
  <p class="af-help">
    {tr('animals.group.countHelp')}
  </p>
  {#if headCount !== group.headCount}
    <label class="af-label" for="{uid}-why"
      >{tr('animals.group.whyCount')}
      <span class="af-optional">{tr('animals.optional')}</span></label
    >
    <input id="{uid}-why" class="af-input" type="text" maxlength="500" bind:value={countReason} />
  {/if}
  <label class="af-label" for="{uid}-notes">{tr('animals.notes')}</label>
  <textarea id="{uid}-notes" class="af-input" maxlength="2000" bind:value={notes}></textarea>
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? tr('animals.saving') : tr('animals.save')}
  </button>
</form>
