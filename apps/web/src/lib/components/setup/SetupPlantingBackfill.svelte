<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import SetupSpot from './SetupSpot.svelte';
  import SpotSelect from './SpotSelect.svelte';
  import { emptyAreas } from '$lib/setup/spot';
  import {
    OLDER_OPTION,
    dateForMonth,
    plantingDateMs,
    recentMonths,
    ymd
  } from '$lib/setup/plantedAround';
  import { savePlanting, searchCrops, type CropOption } from '$lib/setup/planting';
  import type {
    SetupArea,
    SetupBlock,
    SetupPlantingResult,
    SetupSpotResult
  } from '$lib/setup/types';

  interface Props {
    blocks: SetupBlock[];
    areas: SetupArea[];
    canEdit: boolean;
    initialBlockId?: string;
    submitLabel?: string;
    onDone: (result: SetupPlantingResult) => void;
    /** Test seam; the sheet loads the crop list from `/api/plugins`. */
    catalog?: CropOption[];
    now?: Date;
  }

  const {
    blocks,
    areas,
    canEdit,
    initialBlockId,
    submitLabel = 'Save planting',
    onDone,
    catalog: catalogProp,
    now: nowProp
  }: Props = $props();
  const uid = $props.id();
  const now = untrack(() => nowProp ?? new Date());
  const months = [...recentMonths(now, 12), OLDER_OPTION];

  let catalog = $state<CropOption[]>(untrack(() => catalogProp ?? []));
  let catalogError = $state<string | null>(null);
  let query = $state('');
  let crop = $state<CropOption | null>(null);
  let variety = $state('');
  let extraBlocks = $state<SetupBlock[]>([]);
  const allBlocks = $derived([...blocks, ...extraBlocks]);
  let blockId = $state(untrack(() => initialBlockId ?? blocks[0]?.id ?? ''));
  let addingSpot = $state(untrack(() => blocks.length === 0 && emptyAreas(areas).length === 0));
  let filledAreaIds = $state<string[]>([]);
  const pickerAreas = $derived(
    areas.map((a) =>
      filledAreaIds.includes(a.id) ? { ...a, blockCount: (a.blockCount ?? 0) + 1 } : a
    )
  );
  const spotOptions = $derived(
    allBlocks.map((b) => ({
      id: b.id,
      label: b.areaName && b.areaName !== b.name ? `${b.name} · ${b.areaName}` : b.name
    }))
  );
  let month = $state(months[0].key);
  let date = $state(untrack(() => dateForMonth(months[0].key, now) ?? ymd(now)));
  let saving = $state(false);
  let error = $state<string | null>(null);

  const matches = $derived(crop ? [] : searchCrops(catalog, query));

  onMount(async () => {
    if (catalogProp || !canEdit) return;
    try {
      const res = await fetch('/api/plugins');
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { crops: CropOption[] };
      catalog = body.crops.map((c) => ({
        pluginId: c.pluginId,
        displayName: c.displayName,
        cropFamily: c.cropFamily
      }));
    } catch {
      catalogError = "We couldn't load the crop list. Check your signal and try again.";
    }
  });

  function pickMonth(key: string) {
    month = key;
    date = dateForMonth(key, now) ?? date;
  }

  function pickCrop(c: CropOption) {
    crop = c;
    query = c.displayName;
  }

  function clearCrop() {
    crop = null;
    query = '';
  }

  function onSpotAdded(r: SetupSpotResult) {
    const area = areas.find((a) => a.id === r.areaId);
    filledAreaIds = [...filledAreaIds, r.areaId];
    extraBlocks = [
      ...extraBlocks,
      { id: r.blockId, name: r.blockName, areaName: area?.name ?? null }
    ];
    blockId = r.blockId;
    addingSpot = false;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (!crop) {
      error = 'Pick a crop from the list first.';
      return;
    }
    if (!blockId) {
      error = 'Pick where it is growing.';
      return;
    }
    const ms = plantingDateMs(date, now);
    if (ms === null) {
      error = 'Pick a planting date on or before today.';
      return;
    }
    saving = true;
    try {
      const out = await savePlanting({
        blockId,
        cropPluginId: crop.pluginId,
        variety,
        plantingDateMs: ms
      });
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
    Ask the owner to add what's growing. Once it's on the farm it shows up here.
  </p>
{:else if addingSpot}
  <div class="spot-step">
    <p class="step-kicker">First, where is it growing?</p>
    <SetupSpot {areas} canEdit submitLabel="Save and continue" onDone={onSpotAdded} />
    {#if allBlocks.length > 0}
      <button type="button" class="ghost" onclick={() => (addingSpot = false)}>
        Pick an existing spot instead
      </button>
    {/if}
  </div>
{:else}
  <form class="backfill" onsubmit={submit}>
    <label for="{uid}-crop">What is it?</label>
    <div class="crop-row">
      <input
        id="{uid}-crop"
        type="search"
        autocomplete="off"
        placeholder="Tomato, sweet corn, alfalfa"
        bind:value={query}
        oninput={() => (crop = null)}
        readonly={!!crop}
        aria-describedby="{uid}-crop-help"
        data-autofocus
      />
      {#if crop}
        <button type="button" class="ghost small" onclick={clearCrop}>Change</button>
      {/if}
    </div>
    <p id="{uid}-crop-help" class="help">
      {#if catalogError}
        {catalogError}
      {:else if crop}
        {crop.displayName}{crop.cropFamily ? ` · ${crop.cropFamily}` : ''}
      {:else}
        Start typing and pick a match.
      {/if}
    </p>
    {#if matches.length > 0}
      <ul class="matches" aria-label="Matching crops">
        {#each matches as m (m.pluginId)}
          <li>
            <button type="button" class="match" onclick={() => pickCrop(m)}>
              <span>{m.displayName}</span>
              {#if m.cropFamily}<small>{m.cropFamily}</small>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else if query.trim() && !crop && catalog.length > 0}
      <p class="help">No crop by that name yet. Try a shorter word.</p>
    {/if}

    <label for="{uid}-variety">Variety <span class="optional">(optional)</span></label>
    <input id="{uid}-variety" type="text" maxlength="160" bind:value={variety} />

    <label for="{uid}-block">Where is it growing?</label>
    <SpotSelect
      id="{uid}-block"
      blocks={spotOptions}
      areas={pickerAreas}
      {canEdit}
      bind:value={blockId}
      {onSpotAdded}
      onNewSpot={() => (addingSpot = true)}
    />

    <label for="{uid}-month">Planted around</label>
    <select id="{uid}-month" value={month} onchange={(e) => pickMonth(e.currentTarget.value)}>
      {#each months as m (m.key)}
        <option value={m.key}>{m.label}</option>
      {/each}
    </select>
    <div class="date-row">
      <label for="{uid}-date">Planting date</label>
      <Provenance source="manual" detail="your pick" />
    </div>
    <input id="{uid}-date" type="date" max={ymd(now)} bind:value={date} />
    <p class="help">
      A best guess is fine. It sets the harvest window, and you can change it later.
    </p>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <button class="primary" type="submit" disabled={saving || !crop}>
      {saving ? 'Saving…' : submitLabel}
    </button>
  </form>
{/if}

<style>
  .backfill,
  .spot-step {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .step-kicker {
    margin: 0;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  label {
    font-weight: 600;
    font-size: var(--font-size-body);
    color: var(--color-ink);
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
  input[type='search'],
  input[type='text'],
  input[type='date'],
  select {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    color: var(--color-ink);
    width: 100%;
    box-sizing: border-box;
  }
  .crop-row {
    display: flex;
    gap: var(--space-2);
  }
  .crop-row input {
    flex: 1;
  }
  .help {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
  }
  .matches {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .match {
    width: 100%;
    min-height: 48px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .match:hover {
    background: var(--color-divider-soft);
  }
  .match small {
    color: var(--color-ink-muted);
  }
  .date-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .primary,
  .ghost {
    min-height: 48px;
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    padding: 0 var(--space-4);
  }
  .primary {
    margin-top: var(--space-2);
    border: none;
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .ghost {
    align-self: flex-start;
    border: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-forest-deep);
    margin-bottom: var(--space-2);
  }
  .ghost.small {
    margin-bottom: 0;
    align-self: auto;
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
    color: var(--color-ink);
  }
</style>
