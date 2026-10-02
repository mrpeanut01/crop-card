<script lang="ts">
  import '$lib/components/animals/animalForms.css';
  import { OFFLINE_TEXT, responseMessage } from '$lib/amendments/responseMessage';

  interface Props {
    /** The batch or the block the test was of (M-49). */
    target: { batchId: string } | { blockId: string };
    /** Farm-local today, `YYYY-MM-DD`; the latest date allowed. */
    today: string;
    onsaved?: () => void | Promise<void>;
  }
  const { target, today, onsaved }: Props = $props();

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
      error = 'Pick what you saw: no damage, or damage.';
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
        error = await responseMessage(res);
        return;
      }
      testedOn = '';
      result = '';
      note = '';
      await onsaved?.();
    } catch {
      error = OFFLINE_TEXT;
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="af-form bioassay-form"
  onsubmit={save}
  novalidate
  aria-label="Record a pea or bean test"
>
  <h3>Record a pea or bean test</h3>
  <label class="af-label" for="{idBase}-on">Day you checked the plants</label>
  <input id="{idBase}-on" class="af-input" type="date" max={today} bind:value={testedOn} />
  <fieldset class="af-fieldset">
    <legend class="af-legend">What you saw</legend>
    <label class="af-check">
      <input type="radio" name="{idBase}-result" value="no-damage" bind:group={result} />
      No damage compared with the control pots
    </label>
    <label class="af-check">
      <input type="radio" name="{idBase}-result" value="damage" bind:group={result} />
      Cupped, twisted or distorted new leaves
    </label>
  </fieldset>
  <label class="af-label" for="{idBase}-note"
    >Note <span class="af-optional">(optional)</span></label
  >
  <textarea id="{idBase}-note" class="af-input" maxlength="500" bind:value={note}></textarea>
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? 'Saving…' : 'Save the test'}
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
