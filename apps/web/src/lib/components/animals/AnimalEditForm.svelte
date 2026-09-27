<script lang="ts">
  import { untrack } from 'svelte';
  import './animalForms.css';
  import {
    OFFLINE_MESSAGE,
    dateInputToMs,
    errorFromResponse,
    msToDateInput
  } from '$lib/animals/display';
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
  let saving = $state(false);
  let error = $state<string | null>(null);

  const clean = (v: string) => (v.trim() ? v.trim() : null);

  function changes(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (clean(notes) !== animal.notes) out.notes = clean(notes);
    if (notesOnly) return out;
    if (clean(name) !== animal.name) out.name = clean(name);
    if (farm && clean(tag) !== animal.tag) out.tag = clean(tag);
    if (sex !== animal.sex) out.sex = sex;
    if (farm && clean(breed) !== animal.breed) out.breed = clean(breed);
    if (farm && clean(acquiredFrom) !== animal.acquiredFrom) out.acquiredFrom = clean(acquiredFrom);
    if (layout === 'farm' && purpose !== animal.purpose) out.purpose = purpose;
    const b = birth ? dateInputToMs(birth) : null;
    if (b !== animal.birthDate) out.birthDate = b;
    if (b !== null && estimated !== animal.birthDateEstimated) out.birthDateEstimated = estimated;
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
      error = farm ? 'Keep a name or a tag.' : 'Keep a name.';
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
        error = await errorFromResponse(res);
        return;
      }
      const out = (await res.json()) as { warnings?: { message: string; animalId: string }[] };
      await onDone(out.warnings ?? []);
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      saving = false;
    }
  }
</script>

<form class="af-form" onsubmit={submit} novalidate aria-label="Edit details">
  {#if !notesOnly}
    <label class="af-label" for="{uid}-name">Name</label>
    <input id="{uid}-name" class="af-input" type="text" maxlength="80" bind:value={name} />
    {#if farm}
      <label class="af-label" for="{uid}-tag">Tag</label>
      <input id="{uid}-tag" class="af-input" type="text" maxlength="40" bind:value={tag} />
    {/if}
    <label class="af-label" for="{uid}-sex">Sex</label>
    <select id="{uid}-sex" class="af-input" bind:value={sex}>
      {#each sexOptions(animal.speciesId) as o (o.value)}
        <option value={o.value}>{o.label}</option>
      {/each}
    </select>
    <label class="af-label" for="{uid}-born">Birth date</label>
    <input id="{uid}-born" class="af-input" type="date" bind:value={birth} />
    {#if birth}
      <label class="af-check">
        <input type="checkbox" bind:checked={estimated} />
        <span>This date is a guess</span>
      </label>
    {/if}
    {#if farm}
      <div class="af-row">
        <label>
          <span>Breed</span>
          <input class="af-input" type="text" maxlength="80" bind:value={breed} />
        </label>
        <label>
          <span>Came from</span>
          <input class="af-input" type="text" maxlength="200" bind:value={acquiredFrom} />
        </label>
      </div>
    {/if}
    {#if layout === 'farm'}
      <label class="af-label" for="{uid}-purpose">Kept for</label>
      <select id="{uid}-purpose" class="af-input" bind:value={purpose}>
        <option value="production">Eggs, milk, meat or work</option>
        <option value="pet">A pet</option>
        <option value="mixed">Both</option>
      </select>
    {/if}
  {/if}
  <label class="af-label" for="{uid}-notes">Notes</label>
  <textarea id="{uid}-notes" class="af-input" maxlength="2000" bind:value={notes}></textarea>
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? 'Saving…' : 'Save details'}
  </button>
</form>
