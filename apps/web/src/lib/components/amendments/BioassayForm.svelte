<script lang="ts">
  import '$lib/components/animals/animalForms.css';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { offlineText, responseMessage } from '$lib/amendments/responseMessage';

  interface Props {
    /** The batch or the block the test was of (M-49). */
    target: { batchId: string } | { blockId: string };
    /** Farm-local today, `YYYY-MM-DD`; the latest date allowed. */
    today: string;
    onsaved?: () => void | Promise<void>;
  }
  const { target, today, onsaved }: Props = $props();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));

  let testedOn = $state('');
  let result = $state<'no-damage' | 'damage' | ''>('');
  let note = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  const idBase = $derived('batchId' in target ? `bt-${target.batchId}` : `bk-${target.blockId}`);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const on = testedOn || today;
    if (!result) {
      error = tr('bioassay.err.pick');
      return;
    }
    saving = true;
    try {
      const res = await fetch('/api/amendments/bioassays', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...target, testedOn: on, result, note: note.trim() || undefined })
      });
      if (!res.ok) {
        error = await responseMessage(res, locale);
        return;
      }
      testedOn = '';
      result = '';
      note = '';
      await onsaved?.();
    } catch {
      error = offlineText(locale);
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="af-form bioassay-form"
  onsubmit={save}
  novalidate
  aria-label={tr('bioassay.form.title')}
>
  <h3>{tr('bioassay.form.title')}</h3>
  <label class="af-label" for="{idBase}-on">{tr('bioassay.form.day')}</label>
  <input id="{idBase}-on" class="af-input" type="date" max={today} bind:value={testedOn} />
  <fieldset class="af-fieldset">
    <legend class="af-legend">{tr('bioassay.form.saw')}</legend>
    <label class="af-check">
      <input type="radio" name="{idBase}-result" value="no-damage" bind:group={result} />
      {tr('bioassay.form.noDamage')}
    </label>
    <label class="af-check">
      <input type="radio" name="{idBase}-result" value="damage" bind:group={result} />
      {tr('bioassay.form.damage')}
    </label>
  </fieldset>
  <label class="af-label" for="{idBase}-note"
    >{tr('bioassay.form.note')}
    <span class="af-optional">{tr('bioassay.form.optional')}</span></label
  >
  <textarea id="{idBase}-note" class="af-input" maxlength="500" bind:value={note}></textarea>
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? tr('bioassay.form.saving') : tr('bioassay.form.save')}
  </button>
</form>

<style>
  .bioassay-form {
    margin-top: var(--space-3);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: 1rem;
  }
</style>
