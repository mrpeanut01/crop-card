<script lang="ts">
  import { untrack } from 'svelte';
  import '$lib/components/animals/animalForms.css';
  import {
    OFFLINE_MESSAGE,
    areaKindLabel,
    errorFromResponse,
    housingOptions,
    newHousingKinds,
    type AreaOption,
    type HousingPick
  } from '$lib/animals/display';

  interface Props {
    /** Every Area on the farm; the ones animals cannot live on are left out. */
    areas: AreaOption[];
    canEdit: boolean;
    /** Kind picked first when making a new place. */
    defaultKind?: string;
    submitLabel?: string;
    /** Rendered inside another form (the add-animal form): no nested
     *  <form>, so saving the place never submits the outer one. */
    embedded?: boolean;
    /** The species being added; a new coop or pen is saved for it, so the
     *  Area's details can suggest how many it holds once it has a size. */
    speciesId?: string;
    speciesName?: string;
    onDone: (result: HousingPick) => void;
  }

  const {
    areas,
    canEdit,
    defaultKind,
    submitLabel = 'Use this place',
    embedded = false,
    speciesId,
    speciesName,
    onDone
  }: Props = $props();
  const uid = $props.id();
  const NEW = '__new__';

  const options = $derived(housingOptions(areas));
  const kinds = newHousingKinds();
  let picked = $state(untrack(() => housingOptions(areas)[0]?.id ?? NEW));
  let kind = $state(
    untrack(() =>
      defaultKind && kinds.some((k) => k.kind === defaultKind) ? defaultKind : kinds[0].kind
    )
  );
  let name = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  const placeholder = $derived(
    kind === 'pasture'
      ? 'e.g. Back pasture'
      : kind === 'barn'
        ? 'e.g. Red barn'
        : kind === 'residence'
          ? 'e.g. The house'
          : 'e.g. Hen house'
  );

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void save();
  }

  function enterSaves(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    e.stopPropagation();
    void save();
  }

  async function save() {
    if (saving) return;
    error = null;
    if (picked !== NEW) {
      const area = options.find((a) => a.id === picked);
      if (area) onDone({ areaId: area.id, areaName: area.name, kind: area.kind, created: false });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      error = 'Give the place a name.';
      return;
    }
    saving = true;
    try {
      const res = await fetch('/api/fields', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          kind === 'coop_pen' && speciesId
            ? { name: trimmed, kind, details: { speciesId } }
            : { name: trimmed, kind }
        )
      });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      const { field } = (await res.json()) as { field: { id: string; name: string } };
      onDone({ areaId: field.id, areaName: field.name, kind, created: true });
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      saving = false;
    }
  }
</script>

{#if !canEdit}
  <p class="af-note" role="note">
    Ask the owner to add a place for animals. Once it is on the farm it shows up here.
  </p>
{:else}
  <svelte:element
    this={embedded ? 'div' : 'form'}
    class="af-form"
    role={embedded ? 'group' : undefined}
    aria-label={embedded ? 'New place' : undefined}
    onsubmit={embedded ? undefined : submit}
    onkeydown={embedded ? enterSaves : undefined}
  >
    {#if options.length > 0}
      <fieldset class="af-fieldset">
        <legend class="af-legend">Where do they live?</legend>
        <div class="af-tiles">
          {#each options as a (a.id)}
            <label class="af-tile" class:on={picked === a.id}>
              <input type="radio" name="{uid}-place" value={a.id} bind:group={picked} />
              <span>{a.name}</span>
              <span class="af-tile-hint">{areaKindLabel(a.kind)}</span>
            </label>
          {/each}
          <label class="af-tile" class:on={picked === NEW}>
            <input type="radio" name="{uid}-place" value={NEW} bind:group={picked} />
            <span>Somewhere new</span>
          </label>
        </div>
      </fieldset>
    {/if}

    {#if picked === NEW}
      <fieldset class="af-fieldset">
        <legend class="af-legend">What kind of place?</legend>
        <div class="af-tiles">
          {#each kinds as k (k.kind)}
            <label class="af-tile" class:on={kind === k.kind}>
              <input type="radio" name="{uid}-kind" value={k.kind} bind:group={kind} />
              <span>{k.label}</span>
              <span class="af-tile-hint">{k.hint}</span>
            </label>
          {/each}
        </div>
      </fieldset>
      <label class="af-label" for="{uid}-name">What do you call it?</label>
      <input
        id="{uid}-name"
        class="af-input"
        type="text"
        maxlength="120"
        autocomplete="off"
        {placeholder}
        bind:value={name}
        data-autofocus
      />
      <p class="af-help">
        A name is enough. You can draw it on the <a href="/plan/farm">farm map</a> later.
      </p>
      {#if kind === 'coop_pen' && speciesId}
        <p class="af-help" data-testid="coop-species-note">
          Saved as a {speciesName ?? 'animal'} coop or pen. Add its size in the place's details on the
          farm map to get a suggested number of animals it holds.
        </p>
      {/if}
    {/if}

    {#if error}<p class="af-error" role="alert">{error}</p>{/if}

    <button
      class="af-primary"
      type={embedded ? 'button' : 'submit'}
      disabled={saving}
      onclick={embedded ? () => void save() : undefined}
    >
      {saving ? 'Saving…' : submitLabel}
    </button>
  </svelte:element>
{/if}
