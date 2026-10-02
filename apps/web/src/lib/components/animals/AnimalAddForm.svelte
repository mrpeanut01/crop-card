<script lang="ts">
  import { untrack } from 'svelte';
  import './animalForms.css';
  import SpeciesIcon from './SpeciesIcon.svelte';
  import FoodChip from './FoodChip.svelte';
  import SetupAnimalHousing from '$lib/components/setup/SetupAnimalHousing.svelte';
  import {
    birthFromAgeYears,
    dateInputToMs,
    housingOptions,
    type AddedAnimals,
    type AreaOption,
    type HousingPick,
    type SpeciesOption
  } from '$lib/animals/display';
  import { showsFarmFields, type AnimalsLayout } from '$lib/animals/profile';
  import { ANIMAL_PURPOSES, type AnimalPurpose } from '$lib/animals/model';
  import { sexOptions, type AnimalSex } from '$lib/plugins/species';
  import { areaKindName, errorText, groupNoun } from './labels';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

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
  const tr = $derived(createT(page.data?.locale));

  const PURPOSE_LABEL = $derived<Record<AnimalPurpose, string>>({
    production: tr('animals.purpose.forProduction'),
    pet: tr('animals.purpose.forPet'),
    mixed: tr('animals.purpose.mixed')
  });

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
  const groupWord = $derived(groupNoun(tr, chosen?.groupNoun ?? 'group'));
  const unnamedSuffix = $derived(
    unnamedLeft !== null ? tr('animals.add.unnamedSuffix', { count: unnamedLeft }) : ''
  );

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
      error = tr('animals.add.pickKind');
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
        error = tr('animals.add.howManyError');
        return;
      }
      if (namedMembers.length > headCount) {
        error = tr('animals.add.tooManyNamed');
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
        error = await errorText(res, tr);
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
          label: out.animal.name ?? tr('animals.tagLabel', { tag: String(out.animal.tag) }),
          warnings: out.warnings ?? []
        });
      }
    } catch {
      error = tr('animals.offline');
    } finally {
      saving = false;
    }
  }
</script>

{#if !canEdit}
  <p class="af-note" role="note">{tr('animals.add.askOwner')}</p>
{:else}
  <form class="af-form add-form" onsubmit={submit} novalidate>
    <fieldset class="af-fieldset">
      <legend class="af-legend">{tr('animals.add.whatKind')}</legend>
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
        <legend class="af-legend">{tr('animals.add.oneOrGroup', { groupWord })}</legend>
        <div class="af-segment">
          <label class="af-tile" class:on={mode === 'one'}>
            <input
              type="radio"
              name="{uid}-mode"
              value="one"
              checked={mode === 'one'}
              onchange={() => setMode('one')}
            />
            <span>{tr('animals.add.oneAnimal')}</span>
          </label>
          <label class="af-tile" class:on={mode === 'group'}>
            <input
              type="radio"
              name="{uid}-mode"
              value="group"
              checked={mode === 'group'}
              onchange={() => setMode('group')}
            />
            <span>{tr('animals.add.groupWithCount', { groupWord })}</span>
          </label>
        </div>
      </fieldset>

      {#if mode === 'one'}
        <label class="af-label" for="{uid}-name">{tr('animals.name')}</label>
        <input
          id="{uid}-name"
          class="af-input"
          type="text"
          maxlength="80"
          autocomplete="off"
          placeholder={farmFields ? tr('animals.add.phDaisy') : tr('animals.add.phBiscuit')}
          bind:value={name}
        />
        {#if farmFields}
          <label class="af-label" for="{uid}-tag">{tr('animals.tag')}</label>
          <input
            id="{uid}-tag"
            class="af-input"
            type="text"
            maxlength="40"
            autocomplete="off"
            placeholder={tr('animals.add.phTag')}
            bind:value={tag}
          />
          <p class="af-help">{tr('animals.add.nameOrTagHelp')}</p>
        {/if}
        {#if needsIdentifier}
          <div class="af-note" role="alert">
            <p class="needs">
              {farmFields
                ? tr('animals.add.needIdFarm', { groupWord })
                : tr('animals.add.needIdPet', { groupWord })}
            </p>
            <button type="button" class="af-ghost" onclick={() => setMode('group')}>
              {tr('animals.add.addAsGroup', { groupWord })}
            </button>
          </div>
        {/if}
        <label class="af-label" for="{uid}-sex"
          >{tr('animals.sex')} <span class="af-optional">{tr('animals.optional')}</span></label
        >
        <select id="{uid}-sex" class="af-input" bind:value={sex}>
          {#each sexOptions(chosen.id) as o (o.value)}
            <option value={o.value}>{o.label}</option>
          {/each}
        </select>
      {:else}
        <label class="af-label" for="{uid}-count">{tr('animals.howMany')}</label>
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
          {tr('animals.add.groupName', { groupWord })}
          <span class="af-optional">{tr('animals.optional')}</span>
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
            {tr('animals.add.nameSome')}
          </button>
        {:else}
          <fieldset class="af-fieldset">
            <legend class="af-legend"
              >{tr('animals.add.namedOnes')}
              <span class="af-optional">{tr('animals.optional')}</span></legend
            >
            <p class="af-help">
              {tr('animals.add.namedHelp', { suffix: unnamedSuffix })}
            </p>
            {#each members as m, i (i)}
              <div class="af-row">
                <label>
                  <span>{tr('animals.add.nameN', { n: i + 1 })}</span>
                  <input class="af-input" type="text" maxlength="80" bind:value={m.name} />
                </label>
                {#if farmFields}
                  <label>
                    <span>{tr('animals.add.tagN', { n: i + 1 })}</span>
                    <input class="af-input" type="text" maxlength="40" bind:value={m.tag} />
                  </label>
                {/if}
              </div>
            {/each}
            <button type="button" class="af-ghost" onclick={addMemberRow}
              >{tr('animals.add.addAnotherName')}</button
            >
          </fieldset>
        {/if}
      {/if}

      {#if mode === 'one' && full && sameSpeciesGroups.length > 0}
        <label class="af-label" for="{uid}-group">
          {tr('animals.add.partOfGroup', { groupWord })}
          <span class="af-optional">{tr('animals.optional')}</span>
        </label>
        <select id="{uid}-group" class="af-input" bind:value={groupId}>
          <option value="">{tr('animals.add.onItsOwn')}</option>
          {#each sameSpeciesGroups as g (g.id)}
            <option value={g.id}>{g.name}</option>
          {/each}
        </select>
      {/if}

      {#if !(mode === 'one' && groupId)}
        <label class="af-label" for="{uid}-home">
          {mode === 'one' ? tr('animals.add.whereLivesOne') : tr('animals.add.whereLivesMany')}
          <span class="af-optional">{tr('animals.optional')}</span>
        </label>
        <select id="{uid}-home" class="af-input" bind:value={housingFieldId}>
          <option value="">{tr('animals.add.notSet')}</option>
          {#each allAreas as a (a.id)}
            <option value={a.id}>{a.name} ({areaKindName(tr, a.kind)})</option>
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
              submitLabel={tr('animals.add.addThisPlace')}
              embedded
              onDone={placeAdded}
            />
            <button type="button" class="af-ghost" onclick={() => (addingPlace = false)}>
              {tr('animals.cancel')}
            </button>
          </div>
        {:else}
          <button type="button" class="af-ghost" onclick={() => (addingPlace = true)}>
            {tr('animals.add.addNewPlace')}
          </button>
        {/if}
      {/if}

      {#if full}
        {#if mode === 'one'}
          <fieldset class="af-fieldset">
            <legend class="af-legend"
              >{tr('animals.add.age')}
              <span class="af-optional">{tr('animals.optional')}</span></legend
            >
            <div class="af-segment three">
              <label class="af-tile" class:on={ageMode === 'none'}>
                <input type="radio" name="{uid}-age" value="none" bind:group={ageMode} />
                <span>{tr('animals.add.skip')}</span>
              </label>
              <label class="af-tile" class:on={ageMode === 'age'}>
                <input type="radio" name="{uid}-age" value="age" bind:group={ageMode} />
                <span>{tr('animals.add.aboutHowOld')}</span>
              </label>
              <label class="af-tile" class:on={ageMode === 'date'}>
                <input type="radio" name="{uid}-age" value="date" bind:group={ageMode} />
                <span>{tr('animals.birthDate')}</span>
              </label>
            </div>
            {#if ageMode === 'age'}
              <label class="af-label" for="{uid}-years">{tr('animals.add.yearsOld')}</label>
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
              <label class="af-label" for="{uid}-born">{tr('animals.add.bornOn')}</label>
              <input id="{uid}-born" class="af-input" type="date" bind:value={birthDate} />
            {/if}
          </fieldset>
          {#if farmFields}
            <div class="af-row">
              <label>
                <span
                  >{tr('animals.breed')}
                  <span class="af-optional">{tr('animals.optional')}</span></span
                >
                <input class="af-input" type="text" maxlength="80" bind:value={breed} />
              </label>
              <label>
                <span
                  >{tr('animals.cameFrom')}
                  <span class="af-optional">{tr('animals.optional')}</span></span
                >
                <input class="af-input" type="text" maxlength="200" bind:value={acquiredFrom} />
              </label>
              <label>
                <span
                  >{tr('animals.add.arrivedOn')}
                  <span class="af-optional">{tr('animals.optional')}</span></span
                >
                <input class="af-input" type="date" bind:value={acquiredDate} />
              </label>
            </div>
          {/if}
          <label class="af-label" for="{uid}-feeding"
            >{tr('animals.howMuchFood')}
            <span class="af-optional">{tr('animals.optional')}</span></label
          >
          <input
            id="{uid}-feeding"
            class="af-input"
            type="text"
            maxlength="200"
            placeholder={tr('animals.feedingPlaceholder')}
            bind:value={feedingNote}
          />
          <label class="af-label" for="{uid}-chip"
            >{tr('animals.microchip')}
            <span class="af-optional">{tr('animals.optional')}</span></label
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
            {tr('animals.keptFor')} <span class="af-optional">{tr('animals.optional')}</span>
          </label>
          <select id="{uid}-purpose" class="af-input" bind:value={purpose}>
            <option value="">{tr('animals.add.usualForKind')}</option>
            {#each ANIMAL_PURPOSES as p (p)}
              <option value={p}>{PURPOSE_LABEL[p]}</option>
            {/each}
          </select>
        {/if}
        <label class="af-label" for="{uid}-notes"
          >{tr('animals.notes')} <span class="af-optional">{tr('animals.optional')}</span></label
        >
        <textarea id="{uid}-notes" class="af-input" maxlength="2000" bind:value={notes}></textarea>
      {/if}
    {/if}

    {#if error}<p class="af-error" role="alert">{error}</p>{/if}

    <button class="af-primary" type="submit" disabled={saving || !chosen}>
      {saving
        ? tr('animals.saving')
        : (submitLabel ??
          (mode === 'group'
            ? tr('animals.add.addThisGroup', { groupWord })
            : tr('animals.add.addThisAnimal')))}
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
