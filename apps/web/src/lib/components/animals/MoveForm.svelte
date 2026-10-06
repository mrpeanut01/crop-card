<script lang="ts">
  import './animalForms.css';
  import { localInputToMs, msToLocalInput, type AreaOption } from '$lib/animals/display';
  import { submitMove, type MoveOutcome } from '$lib/animals/moveClient';
  import type { AnimalMoveInput } from '$lib/animals/apiSchemas';
  import type { ToxicPlantsByArea } from '$lib/animals/toxicAdjacency';
  import ToxicPlantsCallout from './ToxicPlantsCallout.svelte';
  import ForageAdvisoryCallout from './ForageAdvisoryCallout.svelte';
  import { areaKindName, groupNoun } from './labels';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Member {
    id: string;
    label: string;
  }

  interface Props {
    subjectType: 'animal' | 'group';
    subjectId: string;
    /** Housing Areas only. */
    areas: AreaOption[];
    currentFieldId: string | null;
    /** A group's unnamed count and named members, for moving part of it. */
    group?: { headCount: number; total: number; noun: string; members: Member[] } | null;
    /** Groups of the same species an individual could join. */
    joinGroups?: { id: string; name: string }[];
    /** The group an individual is in now. */
    inGroup?: { id: string; name: string } | null;
    /** Toxic-plant advisory for the destination Area. Never blocks. */
    toxic?: {
      byArea: ToxicPlantsByArea;
      speciesIds: string[];
      speciesPlural: Record<string, string>;
    } | null;
    /** The prussic acid and nitrate advisory for the destination, fetched
     *  when one is picked. Never blocks; shown for every species (M-10). */
    forage?: boolean;
    onDone: (outcome: MoveOutcome, text: string) => void;
  }

  const {
    subjectType,
    subjectId,
    areas,
    currentFieldId,
    group = null,
    joinGroups = [],
    inGroup = null,
    toxic = null,
    forage = false,
    onDone
  }: Props = $props();
  const uid = $props.id();
  const tr = $derived(createT(page.data?.locale));

  const destinations = $derived(areas.filter((a) => a.id !== currentFieldId));
  let target = $state<'area' | 'group'>('area');
  let fieldId = $state('');
  let toGroupId = $state('');
  let how = $state<'all' | 'some'>('all');
  let count = $state<number | null>(null);
  let picked = $state<string[]>([]);
  let newGroupName = $state('');
  let when = $state<'now' | 'earlier'>('now');
  let earlier = $state(msToLocalInput(Date.now()));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let attestHref = $state<string | null>(null);
  let saveToday = $state(false);
  let form = $state<HTMLFormElement | null>(null);

  const areaName = (id: string | null) =>
    areas.find((a) => a.id === id)?.name ?? tr('animals.move.newPlace');

  function capacityText(c: { capacity: number; count: number; over: boolean } | null): string {
    return c?.over
      ? ` ${tr('animals.move.overCapacity', { count: c.count, capacity: c.capacity })}`
      : '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    attestHref = null;
    saveToday = false;
    const movedAt = when === 'now' ? Date.now() : localInputToMs(earlier, Date.now());
    if (movedAt === null) {
      error = tr('animals.move.pickWhen');
      return;
    }
    let input: AnimalMoveInput;
    if (target === 'group') {
      if (!toGroupId) {
        error = tr('animals.move.pickGroup');
        return;
      }
      input = { subjectType: 'animal', subjectId, toGroupId, movedAt };
    } else {
      if (!fieldId) {
        error = tr('animals.move.pickWhere');
        return;
      }
      input = { subjectType, subjectId, fieldId, movedAt };
      if (group && how === 'some') {
        const n = count ?? 0;
        if (!Number.isInteger(n) || n < 0) {
          error = tr('animals.move.wholeNumber');
          return;
        }
        if (n + picked.length === 0) {
          error = tr('animals.move.sayHowMany');
          return;
        }
        if (n > group.headCount) {
          error = tr('animals.move.onlyUnnamed', {
            headCount: group.headCount,
            noun: groupNoun(tr, group.noun)
          });
          return;
        }
        if (n > 0) input.count = n;
        if (picked.length > 0) input.animalIds = [...picked];
        if (newGroupName.trim()) input.newGroupName = newGroupName.trim();
      }
    }
    saving = true;
    try {
      const out = await submitMove(input, undefined, undefined, page.data?.locale);
      if (out.status === 'error') {
        error = out.message;
        attestHref = out.attestHref ?? null;
        saveToday = out.saveToday === true;
        return;
      }
      if (out.status === 'queued') {
        onDone(out, tr('animals.move.queued'));
        return;
      }
      const joined = joinGroups.find((g) => g.id === toGroupId)?.name;
      const destination = areas.find((a) => a.id === fieldId)?.name;
      const head =
        target === 'group'
          ? joined
            ? tr('animals.move.movedInto', { name: joined })
            : tr('animals.move.movedIntoGroup')
          : destination
            ? tr('animals.move.movedTo', { name: destination })
            : tr('animals.move.movedToNew');
      const split = out.move.newGroup
        ? ` ${tr('animals.move.nowGroup', { name: out.move.newGroup.name })}`
        : '';
      const notes = out.warnings?.length ? ` ${out.warnings.join(' ')}` : '';
      onDone(out, `${head}${split}${capacityText(out.move.capacity)}${notes}`);
    } catch {
      error = tr('animals.move.saveFailed');
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="af-form"
  bind:this={form}
  onsubmit={submit}
  novalidate
  aria-label={tr('animals.moveAction')}
>
  {#if subjectType === 'animal' && joinGroups.length > 0}
    <div class="af-segment">
      <label class="af-tile" class:on={target === 'area'}>
        <input type="radio" name="{uid}-target" value="area" bind:group={target} />
        <span>{tr('animals.move.toPlace')}</span>
      </label>
      <label class="af-tile" class:on={target === 'group'}>
        <input type="radio" name="{uid}-target" value="group" bind:group={target} />
        <span>{tr('animals.move.intoGroup')}</span>
      </label>
    </div>
  {/if}

  {#if target === 'area'}
    <label class="af-label" for="{uid}-to">{tr('animals.move.moveTo')}</label>
    <select id="{uid}-to" class="af-input" bind:value={fieldId}>
      <option value="" disabled>{tr('animals.move.pickPlace')}</option>
      {#each destinations as a (a.id)}
        <option value={a.id}>{a.name} ({areaKindName(tr, a.kind)})</option>
      {/each}
    </select>
    {#if toxic && fieldId}
      <ToxicPlantsCallout
        crops={toxic.byArea[fieldId]}
        speciesIds={toxic.speciesIds}
        speciesPlural={toxic.speciesPlural}
        where={areaName(fieldId)}
      />
    {/if}
    {#if forage && fieldId}
      {#key fieldId}
        <ForageAdvisoryCallout {fieldId} where={areaName(fieldId)} />
      {/key}
    {/if}
    {#if destinations.length === 0}
      <p class="af-help">{tr('animals.move.nowhere')}</p>
    {/if}
    {#if inGroup}
      <p class="af-help">{tr('animals.move.takesOut', { name: inGroup.name })}</p>
    {/if}

    {#if group && group.total > 1}
      <fieldset class="af-fieldset">
        <legend class="af-legend">{tr('animals.howMany')}</legend>
        <div class="af-segment">
          <label class="af-tile" class:on={how === 'all'}>
            <input type="radio" name="{uid}-how" value="all" bind:group={how} />
            <span>{tr('animals.move.all', { total: group.total })}</span>
          </label>
          <label class="af-tile" class:on={how === 'some'}>
            <input type="radio" name="{uid}-how" value="some" bind:group={how} />
            <span>{tr('animals.move.some')}</span>
          </label>
        </div>
      </fieldset>
      {#if how === 'some'}
        {#if group.headCount > 0}
          <label class="af-label" for="{uid}-count">
            {tr('animals.move.howManyUnnamed')}
            <span class="af-optional"
              >{tr('animals.move.ofCount', { headCount: group.headCount })}</span
            >
          </label>
          <input
            id="{uid}-count"
            class="af-input"
            type="number"
            min="0"
            max={group.headCount}
            step="1"
            inputmode="numeric"
            bind:value={count}
          />
        {/if}
        {#if group.members.length > 0}
          <fieldset class="af-fieldset">
            <legend class="af-legend">{tr('animals.move.namedMoving')}</legend>
            {#each group.members as m (m.id)}
              <label class="af-check">
                <input type="checkbox" value={m.id} bind:group={picked} />
                <span>{m.label}</span>
              </label>
            {/each}
          </fieldset>
        {/if}
        <label class="af-label" for="{uid}-gname">
          {tr('animals.move.nameMoving')}
          <span class="af-optional">{tr('animals.optional')}</span>
        </label>
        <input
          id="{uid}-gname"
          class="af-input"
          type="text"
          maxlength="80"
          placeholder={tr('animals.move.phBroody')}
          bind:value={newGroupName}
        />
        <p class="af-help">
          {tr('animals.move.ownGroup', { noun: groupNoun(tr, group.noun) })}
        </p>
      {/if}
    {/if}
  {:else}
    <label class="af-label" for="{uid}-join">{tr('animals.move.whichGroup')}</label>
    <select id="{uid}-join" class="af-input" bind:value={toGroupId}>
      <option value="" disabled>{tr('animals.move.pickGroup')}</option>
      {#each joinGroups as g (g.id)}
        <option value={g.id}>{g.name}</option>
      {/each}
    </select>
    <p class="af-help">{tr('animals.move.livesWith')}</p>
  {/if}

  <fieldset class="af-fieldset">
    <legend class="af-legend">{tr('animals.when')}</legend>
    <div class="af-segment">
      <label class="af-tile" class:on={when === 'now'}>
        <input type="radio" name="{uid}-when" value="now" bind:group={when} />
        <span>{tr('animals.move.justNow')}</span>
      </label>
      <label class="af-tile" class:on={when === 'earlier'}>
        <input type="radio" name="{uid}-when" value="earlier" bind:group={when} />
        <span>{tr('animals.move.earlier')}</span>
      </label>
    </div>
    {#if when === 'earlier'}
      <label class="af-label" for="{uid}-at">{tr('animals.move.movedAt')}</label>
      <input id="{uid}-at" class="af-input" type="datetime-local" bind:value={earlier} />
    {/if}
  </fieldset>

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  {#if attestHref}
    <a class="af-ghost attest-link" href={attestHref} lang="en" data-english-only="safety"
      >Add the grazing time from the label</a
    >
  {/if}
  {#if saveToday}
    <button
      class="af-ghost"
      type="button"
      disabled={saving}
      lang="en"
      data-english-only="safety"
      onclick={() => {
        when = 'now';
        form?.requestSubmit();
      }}>Save with today's date</button
    >
  {/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? tr('animals.saving') : tr('animals.move.saveMove')}
  </button>
</form>

<style>
  .attest-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    text-decoration: none;
  }
</style>
