<script lang="ts">
  import { untrack } from 'svelte';
  import { AREA_KIND_LABELS, CROP_AREA_KINDS, type CropAreaKind } from '$lib/farm/areaKinds';
  import { AREA_KIND_HINT, AREA_NAME_PLACEHOLDER } from '$lib/farm/kindStyle';
  import {
    NEW_AREA,
    SPOT_NAME_PLACEHOLDER,
    defaultSpotArea,
    planSpot,
    saveSpot
  } from '$lib/setup/spot';
  import type { SetupArea, SetupSpotResult } from '$lib/setup/types';

  interface Props {
    areas: SetupArea[];
    canEdit: boolean;
    defaultKind?: CropAreaKind;
    /** Start inside this Area, e.g. the Area the person came from. */
    initialAreaId?: string;
    submitLabel?: string;
    onDone: (result: SetupSpotResult) => void;
  }

  const {
    areas,
    canEdit,
    defaultKind = 'field',
    initialAreaId,
    submitLabel = 'Save this spot',
    onDone
  }: Props = $props();
  const uid = $props.id();

  const startArea = untrack(
    () => areas.find((a) => a.id === initialAreaId) ?? defaultSpotArea(areas, defaultKind)
  );
  let name = $state(startArea && startArea.blockCount === 0 ? startArea.name : '');
  let areaId = $state(startArea?.id ?? NEW_AREA);
  let kind = $state<CropAreaKind>(untrack(() => defaultKind));
  const pickedArea = $derived(areas.find((a) => a.id === areaId) ?? null);
  const placeholder = $derived(
    pickedArea
      ? (SPOT_NAME_PLACEHOLDER[pickedArea.kind as CropAreaKind] ?? 'e.g. Back bed')
      : AREA_NAME_PLACEHOLDER[kind]
  );
  let widthFt = $state<number | null>(null);
  let lengthFt = $state<number | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const plan = planSpot({ name, areaId, kind, widthFt, lengthFt }, areas);
    if (!plan.ok) {
      error = plan.error;
      return;
    }
    saving = true;
    try {
      const out = await saveSpot(plan);
      if (!out.ok) {
        error = out.error;
        return;
      }
      onDone(out.result);
    } catch {
      error = "We couldn't reach CropCard. Check your signal and try again.";
    } finally {
      saving = false;
    }
  }
</script>

{#if !canEdit}
  <p class="ask-owner" role="note">
    Ask the owner to add a spot. Once it's on the farm it shows up here.
  </p>
{:else}
  <form class="setup-spot" onsubmit={submit}>
    <p class="lede">A name is all it needs. You can draw it on the map later.</p>

    <label for="{uid}-name">What do you call it?</label>
    <input
      id="{uid}-name"
      type="text"
      maxlength="120"
      autocomplete="off"
      {placeholder}
      bind:value={name}
      data-autofocus
      required
    />

    {#if pickedArea && pickedArea.blockCount === 0}
      <p class="help">
        Nothing is inside {pickedArea.name} yet, so this can be the whole {pickedArea.name}. Or give
        it a smaller name, like a bed.
      </p>
    {/if}

    {#if areas.length > 0}
      <label for="{uid}-area">Where is it?</label>
      <select id="{uid}-area" bind:value={areaId}>
        <option value={NEW_AREA}>Somewhere new</option>
        {#each areas as a (a.id)}
          <option value={a.id}>Inside {a.name} ({AREA_KIND_LABELS[a.kind]})</option>
        {/each}
      </select>
    {/if}

    {#if areaId === NEW_AREA}
      <fieldset>
        <legend>What kind of place is it?</legend>
        <div class="kinds">
          {#each CROP_AREA_KINDS as k (k)}
            <label class="kind" class:on={kind === k}>
              <input type="radio" name="{uid}-kind" value={k} bind:group={kind} />
              <span class="kind-name">{AREA_KIND_LABELS[k]}</span>
              <span class="kind-hint">{AREA_KIND_HINT[k]}</span>
            </label>
          {/each}
        </div>
      </fieldset>
    {/if}

    <fieldset class="size">
      <legend>About how big? <span class="optional">(optional)</span></legend>
      <p class="help">Spray and seed totals use it. Pace it off or guess, in feet.</p>
      <div class="size-row">
        <label>
          <span>Width (ft)</span>
          <input type="number" min="1" step="1" inputmode="numeric" bind:value={widthFt} />
        </label>
        <span aria-hidden="true">×</span>
        <label>
          <span>Length (ft)</span>
          <input type="number" min="1" step="1" inputmode="numeric" bind:value={lengthFt} />
        </label>
      </div>
    </fieldset>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <button class="primary" type="submit" disabled={saving}>
      {saving ? 'Saving…' : submitLabel}
    </button>
  </form>
{/if}

<style>
  .setup-spot {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .lede {
    margin: 0 0 var(--space-2);
    color: var(--color-ink-soft);
  }
  label,
  legend {
    font-weight: 600;
    font-size: var(--font-size-body);
    color: var(--color-ink);
  }
  input[type='text'],
  select {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    color: var(--color-ink);
    margin-bottom: var(--space-2);
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0 0 var(--space-2);
  }
  legend {
    margin-bottom: var(--space-2);
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--space-2);
  }
  .kind {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 64px;
    padding: var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    cursor: pointer;
    font-weight: 500;
  }
  .kind input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .kind:focus-within {
    box-shadow: var(--focus-ring);
  }
  .kind.on {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .kind-name {
    font-weight: 600;
  }
  .kind-hint {
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
  }
  .primary {
    min-height: 48px;
    margin-top: var(--space-2);
    border: none;
    border-radius: var(--radius-input);
    background: var(--color-forest);
    color: var(--color-cream);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    margin: 0;
    color: var(--color-rust);
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
  .size-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .size-row label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-weight: 500;
    flex: 1;
  }
  .size-row input {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    width: 100%;
    box-sizing: border-box;
  }
  .help {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .ask-owner {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-wheat-bg);
    color: var(--color-ink);
  }
</style>
