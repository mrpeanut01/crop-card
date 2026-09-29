<script lang="ts">
  import { untrack } from 'svelte';
  import './animalForms.css';
  import SpeciesIcon from './SpeciesIcon.svelte';
  import FoodChip from './FoodChip.svelte';
  import SetupAnimalHousing from '$lib/components/setup/SetupAnimalHousing.svelte';
  import {
    OFFLINE_MESSAGE,
    areaKindLabel,
    birthFromAgeYears,
    dateInputToMs,
    errorFromResponse,
    housingOptions,
    type AddedAnimals,
    type AreaOption,
    type HousingPick,
    type SpeciesOption
  } from '$lib/animals/display';
  import { showsFarmFields, type AnimalsLayout } from '$lib/animals/profile';
  import { ANIMAL_PURPOSES, type AnimalPurpose } from '$lib/animals/model';
  import { sexOptions, type AnimalSex } from '$lib/plugins/species';

  interface GroupOption {
    id: string;
    name: string;
    speciesId: string;
  }

  interface Props {
    species: SpeciesOption[];
    areas: AreaOption[];
    groups?: GroupOption[];
    layout: AnimalsLayout;
    /** The full page shows sex, breed, age and the rest; the setup sheet
     *  keeps to species, a name or tag, and where they live. */
    full?: boolean;
    canEdit: boolean;
    initialSpecies?: string | null;
    initialMode?: 'one' | 'group' | null;
    initialAreaId?: string | null;
    submitLabel?: string;
    onCreated: (result: AddedAnimals) => void;
  }

  const {
    species,
    areas,
    groups = [],
    layout,
    full = false,
    canEdit,
    initialSpecies = null,
    initialMode = null,
    initialAreaId = null,
    submitLabel,
    onCreated
  }: Props = $props();
  const uid = $props.id();

  const PURPOSE_LABEL: Record<AnimalPurpose, string> = {
    production: 'For eggs, milk, meat or work',
    pet: 'As a pet',
    mixed: 'Both'
  };

  function defaultMode(s: SpeciesOption | undefined): 'one' | 'group' {
    if (!s) return 'one';
    if (s.products.includes('eggs')) return 'group';
    return layout === 'farm' && s.foodProducingDefault ? 'group' : 'one';
  }

  let speciesId = $state<string | null>(
    untrack(() =>
      initialSpecies && species.some((s) => s.id === initialSpecies) ? initialSpecies : null
    )
  );
  const chosen = $derived(species.find((s) => s.id === speciesId));
  let modeTouched = $state(untrack(() => initialMode !== null));
  let mode = $state<'one' | 'group'>(
    untrack(() => initialMode ?? defaultMode(species.find((s) => s.id === initialSpecies)))
  );
  const farmFields = $derived(showsFarmFields(layout, chosen?.foodProducingDefault ? null : 'pet'));

  let name = $state('');
  let tag = $state('');
  let sex = $state<AnimalSex>('unknown');
  let breed = $state('');
  let ageMode = $state<'none' | 'date' | 'age'>('none');
  let birthDate = $state('');
  let ageYears = $state<number | null>(null);
  let acquiredFrom = $state('');
  let acquiredDate = $state('');
  let purpose = $state<AnimalPurpose | ''>('');
  let groupId = $state('');
  let notes = $state('');
  let feedingNote = $state('');
  let microchipId = $state('');

  let groupName = $state('');
  let headCount = $state<number | null>(null);
  let nameSome = $state(false);
  let members = $state<{ name: string; tag: string }[]>([]);

  let extraAreas = $state<AreaOption[]>([]);
  const allAreas = $derived(housingOptions([...areas, ...extraAreas]));
  let housingFieldId = $state(
    untrack(() =>
      initialAreaId && housingOptions(areas).some((a) => a.id === initialAreaId)
        ? initialAreaId
        : ''
    )
  );
  let addingPlace = $state(false);

  let saving = $state(false);
  let error = $state<string | null>(null);
  let needsIdentifier = $state(false);

  const sameSpeciesGroups = $derived(groups.filter((g) => g.speciesId === speciesId));
  const namedMembers = $derived(members.filter((m) => m.name.trim() || m.tag.trim()));
  const unnamedLeft = $derived(
    headCount === null ? null : Math.max(0, headCount - namedMembers.length)
  );
  const groupWord = $derived(chosen?.groupNoun ?? 'group');

  function pickSpecies(id: string) {
    speciesId = id;
    sex = 'unknown';
    groupId = '';
    if (!modeTouched) mode = defaultMode(species.find((s) => s.id === id));
  }

  function setMode(m: 'one' | 'group') {
    mode = m;
    modeTouched = true;
    needsIdentifier = false;
    error = null;
  }

  function placeAdded(pick: HousingPick) {
    if (pick.created)
      extraAreas = [...extraAreas, { id: pick.areaId, name: pick.areaName, kind: pick.kind }];
    housingFieldId = pick.areaId;
    addingPlace = false;
  }

  function addMemberRow() {
    members = [...members, { name: '', tag: '' }];
  }

  function trimmed(v: string): string | null {
    const t = v.trim();
    return t ? t : null;
  }

  function birthPayload(): { birthDate?: number | null; birthDateEstimated?: boolean } {
    if (ageMode === 'date') {
      const ms = dateInputToMs(birthDate);
      return ms === null ? {} : { birthDate: ms, birthDateEstimated: false };
    }
    if (ageMode === 'age' && ageYears !== null) {
      const ms = birthFromAgeYears(ageYears);
      return ms === null ? {} : { birthDate: ms, birthDateEstimated: true };
    }
    return {};
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    needsIdentifier = false;
    if (!chosen) {
      error = 'Pick what kind of animal first.';
      return;
    }
    let url: string;
    let body: Record<string, unknown>;
    if (mode === 'one') {
      const n = trimmed(name);
      const t = farmFields ? trimmed(tag) : null;
      if (!n && !t) {
        needsIdentifier = true;
        return;
      }
      url = '/api/animals';
      body = {
        speciesId: chosen.id,
        name: n,
        tag: t,
        ...(sex !== 'unknown' ? { sex } : {}),
        ...(full ? birthPayload() : {})
      };
      if (full) {
        if (farmFields && trimmed(breed)) body.breed = trimmed(breed);
        if (farmFields && trimmed(acquiredFrom)) body.acquiredFrom = trimmed(acquiredFrom);
        const acq = dateInputToMs(acquiredDate);
        if (acq !== null) body.acquiredDate = acq;
        if (purpose) body.purpose = purpose;
        if (trimmed(notes)) body.notes = trimmed(notes);
        if (trimmed(feedingNote)) body.feedingNote = trimmed(feedingNote);
        if (trimmed(microchipId)) body.microchipId = trimmed(microchipId);
      }
      if (groupId) body.groupId = groupId;
      else if (housingFieldId) body.housingFieldId = housingFieldId;
    } else {
      const gName = trimmed(groupName) ?? chosen.label;
      if (headCount === null || !Number.isInteger(headCount) || headCount < 1) {
        error = 'How many are there? Enter a whole number.';
        return;
      }
      if (namedMembers.length > headCount) {
        error = 'More named animals than the count. Raise the count or remove a name.';
        return;
      }
      url = '/api/animal-groups';
      body = {
        name: gName,
        speciesId: chosen.id,
        headCount,
        ...(namedMembers.length > 0
          ? {
              members: namedMembers.map((m) => ({
                name: trimmed(m.name),
                tag: farmFields ? trimmed(m.tag) : null
              }))
            }
          : {}),
        ...(housingFieldId ? { housingFieldId } : {}),
        ...(full && purpose ? { purpose } : {}),
        ...(full && trimmed(notes) ? { notes: trimmed(notes) } : {})
      };
    }
    saving = true;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      const out = (await res.json()) as {
        animal?: { id: string; name: string | null; tag: string | null };
        group?: { id: string; name: string };
        warnings?: { message: string; animalId: string }[];
      };
      if (out.group) {
        onCreated({
          kind: 'group',
          id: out.group.id,
          label: out.group.name,
          warnings: out.warnings ?? []
        });
      } else if (out.animal) {
        onCreated({
          kind: 'animal',
          id: out.animal.id,
          label: out.animal.name ?? `Tag ${out.animal.tag}`,
          warnings: out.warnings ?? []
        });
      }
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      saving = false;
    }
  }
</script>

{#if !canEdit}
  <p class="af-note" role="note">
    Ask the owner to add animals. Once they are on the farm you can move them and record changes.
  </p>
{:else}
  <form class="af-form add-form" onsubmit={submit} novalidate>
    <fieldset class="af-fieldset">
      <legend class="af-legend">What kind of animal?</legend>
      <div class="af-tiles">
        {#each species as s (s.id)}
          <label class="af-tile" class:on={speciesId === s.id}>
            <input
              type="radio"
              name="{uid}-species"
              value={s.id}
              checked={speciesId === s.id}
              onchange={() => pickSpecies(s.id)}
            />
            <SpeciesIcon icon={s.icon} size={22} />
            <span>{s.label}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    {#if chosen}
      <FoodChip foodProducing={chosen.foodProducingDefault} explanation={chosen.explanation} />

      <fieldset class="af-fieldset">
        <legend class="af-legend">One animal or a {groupWord}?</legend>
        <div class="af-segment">
          <label class="af-tile" class:on={mode === 'one'}>
            <input
              type="radio"
              name="{uid}-mode"
              value="one"
              checked={mode === 'one'}
              onchange={() => setMode('one')}
            />
            <span>One animal</span>
          </label>
          <label class="af-tile" class:on={mode === 'group'}>
            <input
              type="radio"
              name="{uid}-mode"
              value="group"
              checked={mode === 'group'}
              onchange={() => setMode('group')}
            />
            <span>A {groupWord} with a count</span>
          </label>
        </div>
      </fieldset>

      {#if mode === 'one'}
        <label class="af-label" for="{uid}-name">Name</label>
        <input
          id="{uid}-name"
          class="af-input"
          type="text"
          maxlength="80"
          autocomplete="off"
          placeholder={farmFields ? 'e.g. Daisy' : 'e.g. Biscuit'}
          bind:value={name}
        />
        {#if farmFields}
          <label class="af-label" for="{uid}-tag">Tag</label>
          <input
            id="{uid}-tag"
            class="af-input"
            type="text"
            maxlength="40"
            autocomplete="off"
            placeholder="e.g. 14"
            bind:value={tag}
          />
          <p class="af-help">A name or a tag is enough. Put an ear tag number here, not in Name.</p>
        {/if}
        {#if needsIdentifier}
          <div class="af-note" role="alert">
            <p class="needs">
              Give {farmFields ? 'a name or a tag' : 'a name'}, or add them as a {groupWord} with a count.
            </p>
            <button type="button" class="af-ghost" onclick={() => setMode('group')}>
              Add as a {groupWord} with a count
            </button>
          </div>
        {/if}
        <label class="af-label" for="{uid}-sex"
          >Sex <span class="af-optional">(optional)</span></label
        >
        <select id="{uid}-sex" class="af-input" bind:value={sex}>
          {#each sexOptions(chosen.id) as o (o.value)}
            <option value={o.value}>{o.label}</option>
          {/each}
        </select>
      {:else}
        <label class="af-label" for="{uid}-count">How many?</label>
        <input
          id="{uid}-count"
          class="af-input"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          bind:value={headCount}
        />
        <label class="af-label" for="{uid}-gname">
          What do you call this {groupWord}? <span class="af-optional">(optional)</span>
        </label>
        <input
          id="{uid}-gname"
          class="af-input"
          type="text"
          maxlength="80"
          autocomplete="off"
          placeholder={chosen.label}
          bind:value={groupName}
        />
        {#if !nameSome}
          <button
            type="button"
            class="af-ghost"
            onclick={() => {
              nameSome = true;
              if (members.length === 0) addMemberRow();
            }}
          >
            Name some of them
          </button>
        {:else}
          <fieldset class="af-fieldset">
            <legend class="af-legend">Named ones <span class="af-optional">(optional)</span></legend
            >
            <p class="af-help">
              Named animals get their own page. The rest stay in the count{unnamedLeft !== null
                ? ` (${unnamedLeft} unnamed)`
                : ''}.
            </p>
            {#each members as m, i (i)}
              <div class="af-row">
                <label>
                  <span>Name {i + 1}</span>
                  <input class="af-input" type="text" maxlength="80" bind:value={m.name} />
                </label>
                {#if farmFields}
                  <label>
                    <span>Tag {i + 1}</span>
                    <input class="af-input" type="text" maxlength="40" bind:value={m.tag} />
                  </label>
                {/if}
              </div>
            {/each}
            <button type="button" class="af-ghost" onclick={addMemberRow}>Add another name</button>
          </fieldset>
        {/if}
      {/if}

      {#if mode === 'one' && full && sameSpeciesGroups.length > 0}
        <label class="af-label" for="{uid}-group">
          Part of a {groupWord}? <span class="af-optional">(optional)</span>
        </label>
        <select id="{uid}-group" class="af-input" bind:value={groupId}>
          <option value="">No, on its own</option>
          {#each sameSpeciesGroups as g (g.id)}
            <option value={g.id}>{g.name}</option>
          {/each}
        </select>
      {/if}

      {#if !(mode === 'one' && groupId)}
        <label class="af-label" for="{uid}-home">
          Where {mode === 'one' ? 'does it' : 'do they'} live?
          <span class="af-optional">(optional)</span>
        </label>
        <select id="{uid}-home" class="af-input" bind:value={housingFieldId}>
          <option value="">Not set</option>
          {#each allAreas as a (a.id)}
            <option value={a.id}>{a.name} ({areaKindLabel(a.kind)})</option>
          {/each}
        </select>
        {#if addingPlace}
          <div class="place-panel">
            <SetupAnimalHousing
              areas={[]}
              canEdit={true}
              defaultKind={chosen.products.includes('eggs')
                ? 'coop_pen'
                : chosen.foodProducingDefault
                  ? 'barn'
                  : 'residence'}
              speciesId={chosen.id}
              speciesName={chosen.displayName.toLowerCase()}
              submitLabel="Add this place"
              embedded
              onDone={placeAdded}
            />
            <button type="button" class="af-ghost" onclick={() => (addingPlace = false)}>
              Cancel
            </button>
          </div>
        {:else}
          <button type="button" class="af-ghost" onclick={() => (addingPlace = true)}>
            Add a new place
          </button>
        {/if}
      {/if}

      {#if full}
        {#if mode === 'one'}
          <fieldset class="af-fieldset">
            <legend class="af-legend">Age <span class="af-optional">(optional)</span></legend>
            <div class="af-segment three">
              <label class="af-tile" class:on={ageMode === 'none'}>
                <input type="radio" name="{uid}-age" value="none" bind:group={ageMode} />
                <span>Skip</span>
              </label>
              <label class="af-tile" class:on={ageMode === 'age'}>
                <input type="radio" name="{uid}-age" value="age" bind:group={ageMode} />
                <span>About how old</span>
              </label>
              <label class="af-tile" class:on={ageMode === 'date'}>
                <input type="radio" name="{uid}-age" value="date" bind:group={ageMode} />
                <span>Birth date</span>
              </label>
            </div>
            {#if ageMode === 'age'}
              <label class="af-label" for="{uid}-years">Years old</label>
              <input
                id="{uid}-years"
                class="af-input"
                type="number"
                min="0"
                max="60"
                step="0.5"
                inputmode="decimal"
                bind:value={ageYears}
              />
            {:else if ageMode === 'date'}
              <label class="af-label" for="{uid}-born">Born on</label>
              <input id="{uid}-born" class="af-input" type="date" bind:value={birthDate} />
            {/if}
          </fieldset>
          {#if farmFields}
            <div class="af-row">
              <label>
                <span>Breed <span class="af-optional">(optional)</span></span>
                <input class="af-input" type="text" maxlength="80" bind:value={breed} />
              </label>
              <label>
                <span>Came from <span class="af-optional">(optional)</span></span>
                <input class="af-input" type="text" maxlength="200" bind:value={acquiredFrom} />
              </label>
              <label>
                <span>Arrived on <span class="af-optional">(optional)</span></span>
                <input class="af-input" type="date" bind:value={acquiredDate} />
              </label>
            </div>
          {/if}
          <label class="af-label" for="{uid}-feeding"
            >How much food <span class="af-optional">(optional)</span></label
          >
          <input
            id="{uid}-feeding"
            class="af-input"
            type="text"
            maxlength="200"
            placeholder="1 cup twice a day"
            bind:value={feedingNote}
          />
          <label class="af-label" for="{uid}-chip"
            >Microchip ID <span class="af-optional">(optional)</span></label
          >
          <input
            id="{uid}-chip"
            class="af-input"
            type="text"
            maxlength="40"
            autocomplete="off"
            bind:value={microchipId}
          />
        {/if}
        {#if layout === 'farm'}
          <label class="af-label" for="{uid}-purpose">
            Kept for <span class="af-optional">(optional)</span>
          </label>
          <select id="{uid}-purpose" class="af-input" bind:value={purpose}>
            <option value="">Usual for this kind</option>
            {#each ANIMAL_PURPOSES as p (p)}
              <option value={p}>{PURPOSE_LABEL[p]}</option>
            {/each}
          </select>
        {/if}
        <label class="af-label" for="{uid}-notes"
          >Notes <span class="af-optional">(optional)</span></label
        >
        <textarea id="{uid}-notes" class="af-input" maxlength="2000" bind:value={notes}></textarea>
      {/if}
    {/if}

    {#if error}<p class="af-error" role="alert">{error}</p>{/if}

    <button class="af-primary" type="submit" disabled={saving || !chosen}>
      {saving
        ? 'Saving…'
        : (submitLabel ?? (mode === 'group' ? `Add this ${groupWord}` : 'Add this animal'))}
    </button>
  </form>
{/if}

<style>
  .add-form {
    gap: var(--space-3);
  }
  .needs {
    margin: 0 0 var(--space-2);
  }
  .place-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px dashed var(--color-divider);
    border-radius: var(--radius-card);
  }
  .three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
</style>
