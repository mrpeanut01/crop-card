<script lang="ts">
  import { untrack } from 'svelte';
  import { AREA_KIND_LABELS, CROP_AREA_KINDS, type CropAreaKind } from '$lib/farm/areaKinds';
  import { NEW_AREA, planSpot, saveSpot } from '$lib/setup/spot';
  import type { SetupArea, SetupSpotResult } from '$lib/setup/types';

  interface Props {
    areas: SetupArea[];
    canEdit: boolean;
    defaultKind?: CropAreaKind;
    submitLabel?: string;
    onDone: (result: SetupSpotResult) => void;
  }

  const {
    areas,
    canEdit,
    defaultKind = 'field',
    submitLabel = 'Save this spot',
    onDone
  }: Props = $props();
  const uid = $props.id();

  const KIND_HINTS: Record<CropAreaKind, string> = {
    field: 'Row crops, grain, market blocks',
    garden: 'Beds by the house',
    greenhouse: 'Greenhouse or high tunnel',
    orchard: 'Fruit trees or vines',
    pasture: 'Hay or grazing'
  };

  let name = $state('');
  let areaId = $state(NEW_AREA);
  let kind = $state<CropAreaKind>(untrack(() => defaultKind));
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const plan = planSpot({ name, areaId, kind }, areas);
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
      placeholder="Back bed, North 10, Hayfield"
      bind:value={name}
      data-autofocus
      required
    />

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
              <span class="kind-hint">{KIND_HINTS[k]}</span>
            </label>
          {/each}
        </div>
      </fieldset>
    {/if}

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
  .ask-owner {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
  }
</style>
