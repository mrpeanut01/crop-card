<script lang="ts">
  import {
    NEW_SPOT,
    WHOLE_AREA_PREFIX,
    emptyAreas,
    saveSpot,
    wholeAreaPlan
  } from '$lib/setup/spot';
  import type { SetupArea, SetupSpotResult } from '$lib/setup/types';

  interface Props {
    id: string;
    blocks: Array<{ id: string; label: string }>;
    areas: SetupArea[];
    canEdit: boolean;
    value: string;
    /** Called after an empty Area was turned into one spot. */
    onSpotAdded: (result: SetupSpotResult) => void | Promise<void>;
    /** Called when the person picks "+ New spot…". */
    onNewSpot: () => void;
  }

  let { id, blocks, areas, canEdit, value = $bindable(), onSpotAdded, onNewSpot }: Props = $props();

  const wholeAreas = $derived(canEdit ? emptyAreas(areas) : []);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function onChange(e: Event & { currentTarget: HTMLSelectElement }) {
    const next = e.currentTarget.value;
    error = null;
    if (next === NEW_SPOT) {
      e.currentTarget.value = value;
      onNewSpot();
      return;
    }
    if (next.startsWith(WHOLE_AREA_PREFIX)) {
      const area = areas.find((a) => a.id === next.slice(WHOLE_AREA_PREFIX.length));
      e.currentTarget.value = value;
      if (!area) return;
      saving = true;
      try {
        const out = await saveSpot(wholeAreaPlan(area));
        if (!out.ok) {
          error = out.error;
          return;
        }
        await onSpotAdded(out.result);
        value = out.result.blockId;
      } catch {
        error = "We couldn't reach CropCard. Check your signal and try again.";
      } finally {
        saving = false;
      }
      return;
    }
    value = next;
  }
</script>

<select {id} {value} onchange={onChange} disabled={saving} aria-busy={saving}>
  {#if !value}
    <option value="" disabled>Pick a spot</option>
  {/if}
  {#each blocks as b (b.id)}
    <option value={b.id}>{b.label}</option>
  {/each}
  {#if wholeAreas.length > 0}
    <optgroup label="Areas with nothing in them yet">
      {#each wholeAreas as a (a.id)}
        <option value="{WHOLE_AREA_PREFIX}{a.id}">{a.name} (the whole area)</option>
      {/each}
    </optgroup>
  {/if}
  {#if canEdit}
    <option value={NEW_SPOT}>+ New spot…</option>
  {/if}
</select>
{#if saving}<p class="status" role="status">Adding it…</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  select {
    min-height: 48px;
    width: 100%;
    box-sizing: border-box;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    color: var(--color-ink);
  }
  .status {
    margin: var(--space-1) 0 0;
    color: var(--color-ink-soft);
  }
  .error {
    margin: var(--space-1) 0 0;
    color: var(--color-rust);
  }
</style>
