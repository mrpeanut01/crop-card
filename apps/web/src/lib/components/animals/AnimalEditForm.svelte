<script lang="ts">
  import { untrack } from 'svelte';
  import './animalForms.css';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { dateInputToMs, msToDateInput } from '$lib/animals/display';
  import { errorText } from './labels';
  import { showsFarmFields, type AnimalsLayout } from '$lib/animals/profile';
  import type { AnimalPurpose } from '$lib/animals/model';
  import { sexOptions, type AnimalSex } from '$lib/plugins/species';

  interface EditableAnimal {
    id: string;
    speciesId: string;
    name: string | null;
    tag: string | null;
    sex: AnimalSex;
    breed: string | null;
    birthDate: number | null;
    birthDateEstimated: boolean;
    acquiredFrom: string | null;
    purpose: AnimalPurpose;
    notes: string | null;
    microchipId: string | null;
    feedingNote: string | null;
  }

  interface Props {
    animal: EditableAnimal;
    layout: AnimalsLayout;
    /** No longer here: only notes can change. */
    notesOnly: boolean;
    onDone: (warnings: { message: string; animalId: string }[]) => void | Promise<void>;
  }

  const { animal, layout, notesOnly, onDone }: Props = $props();
  const uid = $props.id();
  const tr = $derived(createT(page.data?.locale));
  const start = untrack(() => animal);
  const farm = $derived(showsFarmFields(layout, animal.purpose));

  let name = $state(start.name ?? '');
  let tag = $state(start.tag ?? '');
  let sex = $state<AnimalSex>(start.sex);
  let breed = $state(start.breed ?? '');
  let birth = $state(msToDateInput(start.birthDate));
  let estimated = $state(start.birthDateEstimated);
  let acquiredFrom = $state(start.acquiredFrom ?? '');
  let purpose = $state<AnimalPurpose>(start.purpose);
  let notes = $state(start.notes ?? '');
  let microchip = $state(start.microchipId ?? '');
  let feeding = $state(start.feedingNote ?? '');
  let saving = $state(false);
  let error = $state<string | null>(null);
  /** Set when the server asks why a sex change ends the milk reading (C-10). */
  let needsReason = $state(false);
  let sexReason = $state('');

  const clean = (v: string) => (v.trim() ? v.trim() : null);

  function changes(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (clean(notes) !== animal.notes) out.notes = clean(notes);
    if (notesOnly) return out;
    if (clean(name) !== animal.name) out.name = clean(name);
    if (farm && clean(tag) !== animal.tag) out.tag = clean(tag);
    if (sex !== animal.sex) {
      out.sex = sex;
      if (needsReason && sexReason.trim()) out.flagReason = sexReason.trim();
    }
    if (farm && clean(breed) !== animal.breed) out.breed = clean(breed);
    if (farm && clean(acquiredFrom) !== animal.acquiredFrom) out.acquiredFrom = clean(acquiredFrom);
    if (layout === 'farm' && purpose !== animal.purpose) out.purpose = purpose;
    const b = birth ? dateInputToMs(birth) : null;
    if (b !== animal.birthDate) out.birthDate = b;
    if (b !== null && estimated !== animal.birthDateEstimated) out.birthDateEstimated = estimated;
    if (clean(microchip) !== animal.microchipId) out.microchipId = clean(microchip);
    if (clean(feeding) !== animal.feedingNote) out.feedingNote = clean(feeding);
    return out;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const body = changes();
    if (Object.keys(body).length === 0) {
      await onDone([]);
      return;
    }
    if (!notesOnly && !clean(name) && !(farm ? clean(tag) : animal.tag)) {
      error = farm ? tr('animals.edit.keepNameOrTag') : tr('animals.edit.keepName');
      return;
    }
    saving = true;
    try {
      const res = await fetch(`/api/animals/${animal.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const code =
          res.status === 400
            ? await res
                .clone()
                .json()
                .catch(() => null)
            : null;
        if (code?.code === 'REASON_REQUIRED') needsReason = true;
        error = await errorText(res, tr);
        return;
      }
      const out = (await res.json()) as { warnings?: { message: string; animalId: string }[] };
      await onDone(out.warnings ?? []);
    } catch {
      error = tr('animals.offline');
    } finally {
      saving = false;
    }
  }
</script>

<form class="af-form" onsubmit={submit} novalidate aria-label={tr('animals.edit.details')}>
  {#if !notesOnly}
    <label class="af-label" for="{uid}-name">{tr('animals.name')}</label>
    <input id="{uid}-name" class="af-input" type="text" maxlength="80" bind:value={name} />
    {#if farm}
      <label class="af-label" for="{uid}-tag">{tr('animals.tag')}</label>
      <input id="{uid}-tag" class="af-input" type="text" maxlength="40" bind:value={tag} />
    {/if}
    <label class="af-label" for="{uid}-sex">{tr('animals.sex')}</label>
    <select id="{uid}-sex" class="af-input" bind:value={sex}>
      {#each sexOptions(animal.speciesId, page.data?.locale) as o (o.value)}
        <option value={o.value}>{o.label}</option>
      {/each}
    </select>
    {#if needsReason && sex !== animal.sex}
      <label class="af-label" for="{uid}-sex-reason">{tr('animals.edit.whySex')}</label>
      <input
        id="{uid}-sex-reason"
        class="af-input"
        type="text"
        maxlength="500"
        required
        bind:value={sexReason}
      />
    {/if}
    <label class="af-label" for="{uid}-born">{tr('animals.birthDate')}</label>
    <input id="{uid}-born" class="af-input" type="date" bind:value={birth} />
    {#if birth}
      <label class="af-check">
        <input type="checkbox" bind:checked={estimated} />
        <span>{tr('animals.edit.dateGuess')}</span>
      </label>
    {/if}
    {#if farm}
      <div class="af-row">
        <label>
          <span>{tr('animals.breed')}</span>
          <input class="af-input" type="text" maxlength="80" bind:value={breed} />
        </label>
        <label>
          <span>{tr('animals.cameFrom')}</span>
          <input class="af-input" type="text" maxlength="200" bind:value={acquiredFrom} />
        </label>
      </div>
    {/if}
    {#if layout === 'farm'}
      <label class="af-label" for="{uid}-purpose">{tr('animals.keptFor')}</label>
      <select id="{uid}-purpose" class="af-input" bind:value={purpose}>
        <option value="production">{tr('animals.purpose.production')}</option>
        <option value="pet">{tr('animals.purpose.pet')}</option>
        <option value="mixed">{tr('animals.purpose.mixed')}</option>
      </select>
    {/if}
    <label class="af-label" for="{uid}-feeding">{tr('animals.howMuchFood')}</label>
    <input
      id="{uid}-feeding"
      class="af-input"
      type="text"
      maxlength="200"
      placeholder={tr('animals.feedingPlaceholder')}
      bind:value={feeding}
    />
    <label class="af-label" for="{uid}-chip">{tr('animals.microchip')}</label>
    <input
      id="{uid}-chip"
      class="af-input"
      type="text"
      maxlength="40"
      autocomplete="off"
      bind:value={microchip}
    />
  {/if}
  <label class="af-label" for="{uid}-notes">{tr('animals.notes')}</label>
  <textarea id="{uid}-notes" class="af-input" maxlength="2000" bind:value={notes}></textarea>
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? tr('animals.saving') : tr('animals.edit.saveDetails')}
  </button>
</form>
