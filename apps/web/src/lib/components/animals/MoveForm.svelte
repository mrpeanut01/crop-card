<script lang="ts">
  import './animalForms.css';
  import {
    areaKindLabel,
    localInputToMs,
    msToLocalInput,
    type AreaOption
  } from '$lib/animals/display';
  import { submitMove, type MoveOutcome } from '$lib/animals/moveClient';
  import type { AnimalMoveInput } from '$lib/animals/apiSchemas';
  import type { ToxicPlantsByArea } from '$lib/animals/toxicAdjacency';
  import ToxicPlantsCallout from './ToxicPlantsCallout.svelte';

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
    onDone
  }: Props = $props();
  const uid = $props.id();

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

  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name ?? 'the new place';

  function capacityText(c: { capacity: number; count: number; over: boolean } | null): string {
    return c?.over ? ` Over capacity (${c.count} of ${c.capacity}).` : '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    attestHref = null;
    saveToday = false;
    const movedAt = when === 'now' ? Date.now() : localInputToMs(earlier);
    if (movedAt === null) {
      error = 'Pick when they moved.';
      return;
    }
    let input: AnimalMoveInput;
    if (target === 'group') {
      if (!toGroupId) {
        error = 'Pick a group.';
        return;
      }
      input = { subjectType: 'animal', subjectId, toGroupId, movedAt };
    } else {
      if (!fieldId) {
        error = 'Pick where they went.';
        return;
      }
      input = { subjectType, subjectId, fieldId, movedAt };
      if (group && how === 'some') {
        const n = count ?? 0;
        if (!Number.isInteger(n) || n < 0) {
          error = 'Enter a whole number.';
          return;
        }
        if (n + picked.length === 0) {
          error = 'Say how many are moving.';
          return;
        }
        if (n > group.headCount) {
          error = `Only ${group.headCount} unnamed are in this ${group.noun}.`;
          return;
        }
        if (n > 0) input.count = n;
        if (picked.length > 0) input.animalIds = [...picked];
        if (newGroupName.trim()) input.newGroupName = newGroupName.trim();
      }
    }
    saving = true;
    try {
      const out = await submitMove(input);
      if (out.status === 'error') {
        error = out.message;
        attestHref = out.attestHref ?? null;
        saveToday = out.saveToday === true;
        return;
      }
      if (out.status === 'queued') {
        onDone(out, 'Saved on this phone. The move uploads when you have signal.');
        return;
      }
      const where =
        target === 'group'
          ? `into ${joinGroups.find((g) => g.id === toGroupId)?.name ?? 'the group'}`
          : `to ${areaName(fieldId)}`;
      const split = out.move.newGroup ? ` They are now the group "${out.move.newGroup.name}".` : '';
      const notes = out.warnings?.length ? ` ${out.warnings.join(' ')}` : '';
      onDone(out, `Moved ${where}.${split}${capacityText(out.move.capacity)}${notes}`);
    } catch {
      error = "We couldn't save the move. Try again.";
    } finally {
      saving = false;
    }
  }
</script>

<form class="af-form" bind:this={form} onsubmit={submit} novalidate aria-label="Move">
  {#if subjectType === 'animal' && joinGroups.length > 0}
    <div class="af-segment">
      <label class="af-tile" class:on={target === 'area'}>
        <input type="radio" name="{uid}-target" value="area" bind:group={target} />
        <span>To a place</span>
      </label>
      <label class="af-tile" class:on={target === 'group'}>
        <input type="radio" name="{uid}-target" value="group" bind:group={target} />
        <span>Into a group</span>
      </label>
    </div>
  {/if}

  {#if target === 'area'}
    <label class="af-label" for="{uid}-to">Move to</label>
    <select id="{uid}-to" class="af-input" bind:value={fieldId}>
      <option value="" disabled>Pick a place</option>
      {#each destinations as a (a.id)}
        <option value={a.id}>{a.name} ({areaKindLabel(a.kind)})</option>
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
    {#if destinations.length === 0}
      <p class="af-help">There is nowhere else to move them yet. The owner can add a place.</p>
    {/if}
    {#if inGroup}
      <p class="af-help">Moving this one on its own takes it out of {inGroup.name}.</p>
    {/if}

    {#if group && group.total > 1}
      <fieldset class="af-fieldset">
        <legend class="af-legend">How many?</legend>
        <div class="af-segment">
          <label class="af-tile" class:on={how === 'all'}>
            <input type="radio" name="{uid}-how" value="all" bind:group={how} />
            <span>All {group.total}</span>
          </label>
          <label class="af-tile" class:on={how === 'some'}>
            <input type="radio" name="{uid}-how" value="some" bind:group={how} />
            <span>Some of them</span>
          </label>
        </div>
      </fieldset>
      {#if how === 'some'}
        {#if group.headCount > 0}
          <label class="af-label" for="{uid}-count">
            How many unnamed? <span class="af-optional">(of {group.headCount})</span>
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
            <legend class="af-legend">Named ones moving</legend>
            {#each group.members as m (m.id)}
              <label class="af-check">
                <input type="checkbox" value={m.id} bind:group={picked} />
                <span>{m.label}</span>
              </label>
            {/each}
          </fieldset>
        {/if}
        <label class="af-label" for="{uid}-gname">
          Name for the ones moving <span class="af-optional">(optional)</span>
        </label>
        <input
          id="{uid}-gname"
          class="af-input"
          type="text"
          maxlength="80"
          placeholder="e.g. Broody hens"
          bind:value={newGroupName}
        />
        <p class="af-help">They become their own {group.noun} at the new place.</p>
      {/if}
    {/if}
  {:else}
    <label class="af-label" for="{uid}-join">Which group?</label>
    <select id="{uid}-join" class="af-input" bind:value={toGroupId}>
      <option value="" disabled>Pick a group</option>
      {#each joinGroups as g (g.id)}
        <option value={g.id}>{g.name}</option>
      {/each}
    </select>
    <p class="af-help">It then lives wherever that group lives.</p>
  {/if}

  <fieldset class="af-fieldset">
    <legend class="af-legend">When?</legend>
    <div class="af-segment">
      <label class="af-tile" class:on={when === 'now'}>
        <input type="radio" name="{uid}-when" value="now" bind:group={when} />
        <span>Just now</span>
      </label>
      <label class="af-tile" class:on={when === 'earlier'}>
        <input type="radio" name="{uid}-when" value="earlier" bind:group={when} />
        <span>Earlier</span>
      </label>
    </div>
    {#if when === 'earlier'}
      <label class="af-label" for="{uid}-at">Moved at</label>
      <input id="{uid}-at" class="af-input" type="datetime-local" bind:value={earlier} />
    {/if}
  </fieldset>

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  {#if attestHref}
    <a class="af-ghost attest-link" href={attestHref}>Add the grazing time from the label</a>
  {/if}
  {#if saveToday}
    <button
      class="af-ghost"
      type="button"
      disabled={saving}
      onclick={() => {
        when = 'now';
        form?.requestSubmit();
      }}>Save with today's date</button
    >
  {/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? 'Saving…' : 'Save the move'}
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
