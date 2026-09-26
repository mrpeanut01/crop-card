<script lang="ts">
  import { tick } from 'svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { BED_STYLES, BED_STYLE_LABELS, type BedStyle } from '$lib/farm/areaKinds';
  import { familyLabel } from '$lib/garden/rotation';
  import { bedOccupancyOn, shortDate } from '$lib/garden/occupancy';
  import { plantingInGround, plantingStatusText } from '$lib/garden/inGround';
  import { successionIntervalDays } from '$lib/schedule/succession';
  import { MAX_SUCCESSIONS } from '$lib/garden/succession';
  import type { FillResponse } from '$lib/garden/api';
  import type {
    BedLayout,
    PlacedPlanting,
    ProposedPlanting,
    RecipeApplication,
    SpacingPattern,
    SuccessionProposal
  } from '$lib/garden/types';
  import { cardHref, cardKey } from '$lib/cards/model';
  import { getDesigner } from './designerState.svelte';
  import { PATTERN_LABELS, ft, parseYmd, plural, sizeLabel, ymd } from './format';

  interface Props {
    bed: BedLayout;
    idPrefix?: string;
  }

  const { bed, idPrefix = 'sheet' }: Props = $props();
  const d = getDesigner();

  type Tab = 'details' | 'plantings' | 'history';
  let tab = $state<Tab>('details');
  let nameInput = $state<HTMLInputElement | null>(null);
  let widthInput = $state<HTMLInputElement | null>(null);

  let name = $state('');
  let widthFt = $state(0);
  let lengthFt = $state(0);
  let xFt = $state(0);
  let yFt = $state(0);
  let syncedFor = '';

  $effect(() => {
    const key = `${bed.blockId}|${bed.name}|${bed.widthFt}|${bed.lengthFt}|${bed.rect.x}|${bed.rect.y}`;
    if (key === syncedFor) return;
    syncedFor = key;
    name = bed.name;
    widthFt = bed.widthFt;
    lengthFt = bed.lengthFt;
    xFt = bed.rect.x;
    yFt = bed.rect.y;
  });

  let lastRename = d.renameRequest;
  let lastSize = d.sizeRequest;
  $effect(() => {
    if (d.renameRequest !== lastRename) {
      lastRename = d.renameRequest;
      tab = 'details';
      void tick().then(() => {
        nameInput?.focus();
        nameInput?.select();
      });
    }
  });
  $effect(() => {
    if (d.sizeRequest !== lastSize) {
      lastSize = d.sizeRequest;
      tab = 'details';
      void tick().then(() => widthInput?.focus());
    }
  });
  $effect(() => {
    if (d.selectedCropId && d.plantingsIn(bed.blockId).some((p) => p.cropId === d.selectedCropId)) {
      tab = 'plantings';
    }
  });

  const plantings = $derived(
    d
      .plantingsIn(bed.blockId)
      .slice()
      .sort((a, b) => (a.plantingDateMs ?? Infinity) - (b.plantingDateMs ?? Infinity))
  );
  const history = $derived(d.historyFor(bed.blockId));
  const historyYears = $derived([...new Set(history.map((h) => h.seasonYear))]);
  const bedHints = $derived(
    d.hints.filter((h) => h.a.blockId === bed.blockId || h.b.blockId === bed.blockId)
  );
  const plannedHere = $derived(plantings.filter((p) => !plantingInGround(p, d.nowMs)));
  const otherBeds = $derived(
    d.beds
      .filter((b) => b.blockId !== bed.blockId)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  );
  const moveTarget = $state<Record<string, string>>({});

  async function saveSize(): Promise<void> {
    if (!(await d.resizeBed(bed.blockId, widthFt, lengthFt))) {
      widthFt = bed.widthFt;
      lengthFt = bed.lengthFt;
    }
  }

  async function savePosition(): Promise<void> {
    if (!(await d.moveBedTo(bed.blockId, xFt, yFt))) {
      xFt = bed.rect.x;
      yFt = bed.rect.y;
    }
  }

  async function saveName(): Promise<void> {
    await d.renameBed(bed.blockId, name);
  }

  function step(field: 'w' | 'l', delta: number): void {
    if (field === 'w') widthFt = Math.max(1, Math.round((widthFt + delta) * 2) / 2);
    else lengthFt = Math.max(1, Math.round((lengthFt + delta) * 2) / 2);
    void saveSize();
  }

  function cropName(pluginId: string, fallback: string): string {
    return d.crop(pluginId)?.displayName ?? fallback;
  }

  function hintText(h: (typeof bedHints)[number]): string {
    const a = d.design.plantings.find((p) => p.cropId === h.a.cropId);
    const b = d.design.plantings.find((p) => p.cropId === h.b.cropId);
    const an = `${a?.varietyDisplayName ?? h.a.cropPluginId} (${d.bed(h.a.blockId)?.name ?? ''})`;
    const bn = `${b?.varietyDisplayName ?? h.b.cropPluginId} (${d.bed(h.b.blockId)?.name ?? ''})`;
    if (h.relation === 'keep-apart') return `Keep apart: ${an} and ${bn}.`;
    return `Good neighbours: ${an} and ${bn}.${h.benefit ? ` ${h.benefit}` : ''}`;
  }

  function countDetail(p: PlacedPlanting): string | undefined {
    if (p.plantCountProvenance === 'fallback') {
      return `No spacing on this crop, used ${Math.round(p.spacing.inRowIn)} in rows`;
    }
    if (p.plantCountProvenance === 'data') return 'from its spacing';
    return undefined;
  }

  function commitDate(p: PlacedPlanting, el: unknown): void {
    if (!(el instanceof HTMLInputElement)) return;
    const ms = parseYmd(el.value);
    if (ms == null || ms === p.plantingDateMs) return;
    void d.setPlantingDate(p.cropId, ms);
  }

  function spotText(fp: { x_in: number; y_in: number; w_in: number }): string {
    const across =
      fp.x_in <= 0
        ? 'left side'
        : fp.x_in + fp.w_in >= bed.widthFt * 12 - 1e-6
          ? 'right side'
          : `${ft(fp.x_in / 12)} ft from the left`;
    return fp.y_in > 0 ? `${across}, ${ft(fp.y_in / 12)} ft in` : `${across}, at the top`;
  }

  function nextOpenAfter(dateMs: number): number | null {
    return bedOccupancyOn(bed, d.intervals, dateMs, d.range).nextOpenMs;
  }

  // Succession sheet
  let successionFor = $state<string | null>(null);
  let succCount = $state(3);
  let succInterval = $state<number | null>(null);
  let succProposal = $state<SuccessionProposal | null>(null);
  let succBusy = $state(false);
  const succOk = $derived(
    succProposal ? succProposal.sowings.filter((s) => !s.conflict).length : 0
  );

  function openSuccession(p: PlacedPlanting): void {
    successionFor = p.cropId;
    succCount = 3;
    succInterval = null;
    refreshSuccession();
  }

  function refreshSuccession(): void {
    if (!successionFor) return;
    succProposal = d.previewSuccession(successionFor, succCount, succInterval ?? undefined);
  }

  function closeSuccession(): void {
    successionFor = null;
    succProposal = null;
    d.ghosts = [];
  }

  async function commitSuccession(): Promise<void> {
    if (!successionFor) return;
    succBusy = true;
    const ok = await d.commitSuccession(successionFor, succCount, succInterval ?? undefined);
    succBusy = false;
    if (ok) closeSuccession();
  }

  // Fill this bed
  let fill = $state<FillResponse | null>(null);
  let fillBusy = $state(false);
  let accepted = $state<Record<string, boolean>>({});
  const acceptedCount = $derived(fill ? fill.proposals.filter((p) => accepted[p.key]).length : 0);

  async function requestFill(): Promise<void> {
    fillBusy = true;
    fill = await d.requestFill(bed.blockId);
    accepted = Object.fromEntries((fill?.proposals ?? []).map((p) => [p.key, true]));
    fillBusy = false;
  }

  async function addAccepted(): Promise<void> {
    if (!fill) return;
    const chosen: ProposedPlanting[] = fill.proposals.filter((p) => accepted[p.key]);
    if (await d.acceptProposals(chosen)) fill = null;
  }

  // Bed recipes
  let recipesOpen = $state(false);
  let recipePreview = $state<RecipeApplication | null>(null);
  let skipped = $state<Record<string, boolean>>({});
  const keptCount = $derived(
    recipePreview ? recipePreview.plantings.filter((p) => !skipped[p.key]).length : 0
  );

  function chooseRecipe(id: string): void {
    recipePreview = d.previewRecipe(bed.blockId, id);
    skipped = {};
  }

  function closeRecipes(): void {
    recipesOpen = false;
    recipePreview = null;
    d.ghosts = [];
  }

  async function addRecipe(): Promise<void> {
    if (!recipePreview) return;
    const kept = recipePreview.plantings.filter((p) => !skipped[p.key]);
    if (await d.commitRecipe(bed.blockId, recipePreview.recipePluginId, kept)) closeRecipes();
  }

  // Planting row editing
  const editSize = $state<Record<string, { w: number; l: number }>>({});
  function sizeOf(p: PlacedPlanting): { w: number; l: number } {
    return (
      editSize[p.cropId] ?? { w: (p.footprint?.w_in ?? 0) / 12, l: (p.footprint?.l_in ?? 0) / 12 }
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'details', label: 'Details' },
    { id: 'plantings', label: 'Plantings' },
    { id: 'history', label: 'History' }
  ];
</script>

<section
  class="sheet"
  aria-label="{bed.name} details"
  data-testid="bed-sheet"
  data-bed-name={bed.name}
>
  <header class="head">
    <h2>{bed.name}</h2>
    <span class="sub"
      >{sizeLabel(bed.widthFt, bed.lengthFt)} · {bed.kind === 'container'
        ? 'Container'
        : bed.bedStyle
          ? BED_STYLE_LABELS[bed.bedStyle]
          : 'Bed'}</span
    >
  </header>

  <div class="tabs" role="tablist" aria-label="{bed.name} sections">
    {#each tabs as t (t.id)}
      <button
        type="button"
        role="tab"
        id="{idPrefix}-{bed.blockId}-tab-{t.id}"
        aria-selected={tab === t.id}
        aria-controls="{idPrefix}-{bed.blockId}-panel-{t.id}"
        class="tab"
        onclick={() => (tab = t.id)}>{t.id === 'history' ? 'History' : t.label}</button
      >
    {/each}
  </div>

  {#if tab === 'details'}
    <div
      class="panel"
      role="tabpanel"
      id="{idPrefix}-{bed.blockId}-panel-details"
      aria-labelledby="{idPrefix}-{bed.blockId}-tab-details"
    >
      <form
        class="fieldrow"
        onsubmit={(e) => {
          e.preventDefault();
          void saveName();
        }}
      >
        <label for="{idPrefix}-{bed.blockId}-name">Name</label>
        <input
          id="{idPrefix}-{bed.blockId}-name"
          bind:this={nameInput}
          bind:value={name}
          maxlength="120"
          disabled={!d.canEdit}
        />
        {#if d.canEdit}<button
            type="submit"
            class="btn"
            disabled={name.trim() === bed.name || !name.trim()}>Rename</button
          >{/if}
      </form>

      {#if bed.kind !== 'container'}
        <div class="fieldrow">
          <label for="{idPrefix}-{bed.blockId}-style">Style</label>
          <select
            id="{idPrefix}-{bed.blockId}-style"
            value={bed.bedStyle ?? 'raised'}
            disabled={!d.canEdit}
            onchange={(e) =>
              d.setBedStyle(bed.blockId, (e.currentTarget as HTMLSelectElement).value as BedStyle)}
          >
            {#each BED_STYLES as s (s)}
              <option value={s}>{BED_STYLE_LABELS[s]}</option>
            {/each}
          </select>
        </div>
      {/if}

      <fieldset class="size">
        <legend>Size (feet)</legend>
        <div class="pair">
          <label for="{idPrefix}-{bed.blockId}-w">Width</label>
          {#if d.canEdit}<button
              type="button"
              class="step"
              aria-label="Width 6 inches less"
              onclick={() => step('w', -0.5)}>−</button
            >{/if}
          <input
            id="{idPrefix}-{bed.blockId}-w"
            bind:this={widthInput}
            type="number"
            min="1"
            step="0.5"
            inputmode="decimal"
            bind:value={widthFt}
            disabled={!d.canEdit}
            onchange={saveSize}
          />
          {#if d.canEdit}<button
              type="button"
              class="step"
              aria-label="Width 6 inches more"
              onclick={() => step('w', 0.5)}>+</button
            >{/if}
        </div>
        <div class="pair">
          <label for="{idPrefix}-{bed.blockId}-l">Length</label>
          {#if d.canEdit}<button
              type="button"
              class="step"
              aria-label="Length 6 inches less"
              onclick={() => step('l', -0.5)}>−</button
            >{/if}
          <input
            id="{idPrefix}-{bed.blockId}-l"
            type="number"
            min="1"
            step="0.5"
            inputmode="decimal"
            bind:value={lengthFt}
            disabled={!d.canEdit}
            onchange={saveSize}
          />
          {#if d.canEdit}<button
              type="button"
              class="step"
              aria-label="Length 6 inches more"
              onclick={() => step('l', 0.5)}>+</button
            >{/if}
        </div>
      </fieldset>

      <fieldset class="size">
        <legend>Position (feet)</legend>
        <div class="pair">
          <label for="{idPrefix}-{bed.blockId}-x">From west</label>
          <input
            id="{idPrefix}-{bed.blockId}-x"
            type="number"
            min="0"
            step="0.5"
            inputmode="decimal"
            bind:value={xFt}
            disabled={!d.canEdit}
            onchange={savePosition}
          />
        </div>
        <div class="pair">
          <label for="{idPrefix}-{bed.blockId}-y">From north</label>
          <input
            id="{idPrefix}-{bed.blockId}-y"
            type="number"
            min="0"
            step="0.5"
            inputmode="decimal"
            bind:value={yFt}
            disabled={!d.canEdit}
            onchange={savePosition}
          />
        </div>
        {#if d.canEdit}
          <div class="nudge" role="group" aria-label="Nudge {bed.name} 6 inches">
            <button
              type="button"
              class="step"
              aria-label="Nudge west"
              onclick={() => d.nudgeBed(bed.blockId, -0.5, 0)}>←</button
            >
            <button
              type="button"
              class="step"
              aria-label="Nudge north"
              onclick={() => d.nudgeBed(bed.blockId, 0, -0.5)}>↑</button
            >
            <button
              type="button"
              class="step"
              aria-label="Nudge south"
              onclick={() => d.nudgeBed(bed.blockId, 0, 0.5)}>↓</button
            >
            <button
              type="button"
              class="step"
              aria-label="Nudge east"
              onclick={() => d.nudgeBed(bed.blockId, 0.5, 0)}>→</button
            >
          </div>
        {/if}
      </fieldset>

      {#if d.canEdit}
        <div class="actions">
          <button type="button" class="btn" onclick={() => d.turnBed(bed.blockId)}>Turn</button>
          <button type="button" class="btn" onclick={() => d.duplicateBed(bed.blockId)}
            >Duplicate</button
          >
          <button type="button" class="btn" onclick={() => d.openCropPanel(bed.blockId)}
            >Add crop</button
          >
          <button type="button" class="btn danger" onclick={() => d.askDelete(bed.blockId)}
            >Delete</button
          >
        </div>
      {/if}
      {#if d.confirmDeleteBedId === bed.blockId}
        <div class="confirm" role="alertdialog" aria-labelledby="{idPrefix}-{bed.blockId}-del">
          <p id="{idPrefix}-{bed.blockId}-del">
            Delete {bed.name}?{plannedHere.length
              ? ` These planned plantings go with it: ${plannedHere.map((p) => p.varietyDisplayName).join(', ')}.`
              : ''}
          </p>
          <button type="button" class="btn danger" onclick={() => d.deleteBed(bed.blockId)}
            >Delete {bed.name}</button
          >
          <button type="button" class="btn" onclick={() => (d.confirmDeleteBedId = null)}
            >Keep it</button
          >
        </div>
      {/if}
      <a class="link" href={cardHref('area', cardKey('area', d.canvas.areaId))}>Area Card</a>
    </div>
  {:else if tab === 'plantings'}
    <div
      class="panel"
      role="tabpanel"
      id="{idPrefix}-{bed.blockId}-panel-plantings"
      aria-labelledby="{idPrefix}-{bed.blockId}-tab-plantings"
    >
      {#if plantings.length === 0}
        <p class="empty">Nothing planned here this season yet.</p>
      {/if}
      <ul class="plist">
        {#each plantings as p (p.cropId)}
          {@const sz = sizeOf(p)}
          {@const rot = d.rotationFor(bed.blockId, p.cropFamily, p.cropId, p.plantingDateMs)}
          {@const shares = d.sharesSpaceText(p)}
          {@const early = d.windowWarning(p)}
          {@const open = d.selectedCropId === p.cropId}
          {@const series = d.seriesOf(p)}
          {@const place = series.findIndex((q) => q.cropId === p.cropId)}
          {@const first = series[0]}
          {@const when = p.plantingDateMs != null ? d.dateText(p.plantingDateMs) : 'No date'}
          {@const who = `${p.varietyDisplayName}, ${when}`}
          {@const thisYear = d.inSeasonYear(p)}
          <li
            class="prow"
            class:selected={open}
            data-testid="planting-row"
            data-crop-name={p.varietyDisplayName}
          >
            <div class="ptitle">
              <button
                type="button"
                class="linkish"
                aria-expanded={open}
                data-planting-row-id={p.cropId}
                onclick={() => (open ? (d.selectedCropId = null) : d.selectPlanting(p.cropId))}
                >{p.varietyDisplayName}</button
              >
              {#if p.sourceProvenance}<span class="prov-inline"
                  ><Provenance
                    source={p.sourceProvenance}
                    detail={p.sourceProvenance === 'plugin' ? 'bed recipe' : undefined}
                    compact
                  /></span
                >{/if}
              <span class="pmeta">
                {when} · {plantingStatusText(
                  p,
                  d.nowMs,
                  d.stageOf(p.cropId)
                )}{#if series.length > 1 && place >= 0}
                  · sowing {place + 1} of {series.length}{/if}
              </span>
            </div>
            {#if p.footprint}
              <div class="count" data-testid="plant-count">
                <span>{p.plantCount != null ? plural(p.plantCount, 'plant') : 'Count not set'}</span
                >
                {#if p.plantCountProvenance}<span class="prov-inline"
                    ><Provenance
                      source={p.plantCountProvenance}
                      detail={countDetail(p)}
                      compact={p.plantCountProvenance !== 'fallback'}
                    /></span
                  >{/if}
                <span class="pmeta"
                  >{sizeLabel(p.footprint.w_in / 12, p.footprint.l_in / 12)} · {PATTERN_LABELS[
                    p.spacing.pattern
                  ]}</span
                >
              </div>
            {:else}
              <p class="pmeta">Not placed in the bed yet.</p>
            {/if}
            {#if early}<p class="chip warn">{early}</p>{/if}
            {#each rot as w (w.family)}
              <p class="chip {w.severity}">{w.message}</p>
            {/each}
            {#if shares}<p class="chip warn">{shares}</p>{/if}

            {#if d.canEdit && open}
              {#if p.footprint}
                <div class="edit">
                  <label>
                    W ft
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={ft(sz.w)}
                      aria-label="{p.varietyDisplayName} width in feet"
                      onchange={(e) =>
                        (editSize[p.cropId] = {
                          ...sz,
                          w: Number((e.currentTarget as HTMLInputElement).value)
                        })}
                    />
                  </label>
                  <label>
                    L ft
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={ft(sz.l)}
                      aria-label="{p.varietyDisplayName} length in feet"
                      onchange={(e) =>
                        (editSize[p.cropId] = {
                          ...sz,
                          l: Number((e.currentTarget as HTMLInputElement).value)
                        })}
                    />
                  </label>
                  <button
                    type="button"
                    class="btn"
                    onclick={async () => {
                      const s = sizeOf(p);
                      await d.setPlantingSize(p.cropId, s.w, s.l);
                      delete editSize[p.cropId];
                    }}>Set size</button
                  >
                  <label>
                    Pattern
                    <select
                      value={p.spacing.pattern}
                      aria-label="{p.varietyDisplayName} spacing pattern"
                      onchange={(e) =>
                        d.setPlantingPattern(
                          p.cropId,
                          (e.currentTarget as HTMLSelectElement).value as SpacingPattern
                        )}
                    >
                      {#each Object.entries(PATTERN_LABELS) as [value, label] (value)}
                        <option {value}>{label}</option>
                      {/each}
                    </select>
                  </label>
                  <label>
                    Plants
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={p.plantCount ?? ''}
                      aria-label="{p.varietyDisplayName} plant count"
                      onchange={(e) => {
                        const n = Math.round(Number((e.currentTarget as HTMLInputElement).value));
                        if (n >= 1) void d.setPlantCount(p.cropId, n);
                      }}
                    />
                  </label>
                  {#if p.plantCountProvenance === 'manual'}
                    <button
                      type="button"
                      class="btn"
                      onclick={() => d.setPlantCount(p.cropId, null)}>Recount from spacing</button
                    >
                  {/if}
                </div>
              {/if}
              <form
                class="edit"
                onsubmit={(e) => {
                  e.preventDefault();
                  commitDate(p, (e.currentTarget as HTMLFormElement).elements.namedItem('date'));
                }}
              >
                <label>
                  Date
                  <input
                    type="date"
                    name="date"
                    value={p.plantingDateMs != null ? ymd(p.plantingDateMs) : ''}
                    aria-label="{p.varietyDisplayName} planting date"
                    onblur={(e) => commitDate(p, e.currentTarget)}
                  />
                </label>
                <button type="submit" class="btn">Change date</button>
              </form>
              <div class="actions">
                {#if p.footprint}
                  <button
                    type="button"
                    class="btn"
                    aria-label="Move {who}"
                    onclick={() => d.startMovePlanting(p.cropId)}>Move</button
                  >
                  {#if series.length > 1 && place > 0 && first}
                    <p class="pmeta series">
                      Part of a succession of {series.length} sowings.
                    </p>
                    <button
                      type="button"
                      class="btn"
                      aria-label="Go to the first sowing, {d.dateText(first.plantingDateMs ?? 0)}"
                      onclick={() => d.selectPlanting(first.cropId)}>First sowing</button
                    >
                  {:else}
                    <button
                      type="button"
                      class="btn"
                      aria-label="{series.length > 1 ? 'Add more sowings' : 'Add succession'} {who}"
                      onclick={() => openSuccession(p)}
                      >{series.length > 1 ? 'Add more sowings' : 'Add succession'}</button
                    >
                  {/if}
                  <button
                    type="button"
                    class="btn"
                    aria-label="Remove {who} from bed"
                    onclick={() => d.removeFromBed(p.cropId)}>Remove from bed</button
                  >
                {:else if thisYear}
                  <button
                    type="button"
                    class="btn"
                    aria-label="Place {who} in {bed.name}"
                    onclick={() =>
                      d.placeCrop(
                        { source: 'planting', cropId: p.cropId, label: p.varietyDisplayName },
                        bed.blockId
                      )}>Place in {bed.name}</button
                  >
                {/if}
              </div>
              {#if p.footprint && otherBeds.length && !plantingInGround(p, d.nowMs)}
                <form
                  class="edit"
                  data-testid="move-to-bed"
                  onsubmit={(e) => {
                    e.preventDefault();
                    const to = moveTarget[p.cropId] ?? otherBeds[0].blockId;
                    void d.movePlantingToBed(p.cropId, to);
                  }}
                >
                  <label>
                    Move to
                    <select
                      aria-label="Bed to move {who} to"
                      value={moveTarget[p.cropId] ?? otherBeds[0].blockId}
                      onchange={(e) =>
                        (moveTarget[p.cropId] = (e.currentTarget as HTMLSelectElement).value)}
                    >
                      {#each otherBeds as b (b.blockId)}
                        <option value={b.blockId}>{b.name}</option>
                      {/each}
                    </select>
                  </label>
                  <button type="submit" class="btn">Move to bed</button>
                  {#if series.length > 1}
                    <p class="pmeta">It stays linked with its other sowings.</p>
                  {/if}
                </form>
              {/if}
            {/if}

            {#if successionFor === p.cropId}
              {@const familyDays = successionIntervalDays(p.cropFamily)}
              <div class="succ" data-testid="succession-sheet">
                {#if familyDays === 0 && succInterval == null}
                  <p>
                    {cropName(p.cropPluginId, p.varietyDisplayName)} doesn't usually succession-sow here.
                    Plant once.
                  </p>
                  <button type="button" class="btn" onclick={closeSuccession}>Close</button>
                {:else}
                  <label>
                    Sow again every
                    <input
                      type="number"
                      min="1"
                      max="90"
                      value={succInterval ?? familyDays}
                      aria-label="Days between sowings"
                      onchange={(e) => {
                        succInterval = Math.max(
                          1,
                          Math.round(Number((e.currentTarget as HTMLInputElement).value))
                        );
                        refreshSuccession();
                      }}
                    />
                    days
                    <Provenance source={succInterval == null ? 'plugin' : 'manual'} compact />
                  </label>
                  <label>
                    How many more?
                    <select
                      class="count-select"
                      value={succCount}
                      aria-label="How many more sowings"
                      onchange={(e) => {
                        succCount = Number((e.currentTarget as HTMLSelectElement).value);
                        refreshSuccession();
                      }}
                    >
                      {#each Array.from({ length: MAX_SUCCESSIONS - 1 }, (_, i) => i + 1) as n (n)}
                        <option value={n}>{n}</option>
                      {/each}
                    </select>
                  </label>
                  {#if succProposal}
                    <ul class="sowings">
                      {#each succProposal.sowings as s (s.index)}
                        {@const opens = s.conflict ? nextOpenAfter(s.plantingDateMs) : null}
                        <li class:conflict={!!s.conflict}>
                          {shortDate(s.plantingDateMs)}{s.plantCount
                            ? ` · ${plural(s.plantCount, 'plant')}`
                            : ''}{s.conflict ? ` · ${s.conflict}` : ''}{opens
                            ? ` ${bed.name} opens ${shortDate(opens)}, so a longer gap between sowings may fit.`
                            : ''}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  <div class="actions">
                    <button
                      type="button"
                      class="btn primary"
                      disabled={succBusy || succOk === 0}
                      onclick={commitSuccession}
                    >
                      Add {plural(succOk, 'sowing')}
                    </button>
                    <button type="button" class="btn" onclick={closeSuccession}>Cancel</button>
                  </div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#each bedHints as h, i (i)}
        <p class="chip {h.relation === 'keep-apart' ? 'warn' : 'good'}">{hintText(h)}</p>
      {/each}

      {#if d.canEdit}
        <div class="actions">
          <button type="button" class="btn" onclick={() => d.openCropPanel(bed.blockId)}
            >Add crop</button
          >
          {#if d.recipes.length}
            <button
              type="button"
              class="btn"
              aria-expanded={recipesOpen}
              onclick={() => (recipesOpen ? closeRecipes() : (recipesOpen = true))}
            >
              Use a bed recipe
            </button>
          {/if}
          <button type="button" class="btn" disabled={fillBusy} onclick={requestFill}
            >Fill this bed</button
          >
        </div>
      {/if}
      {#if recipesOpen}
        <div class="fill" data-testid="recipe-sheet">
          {#if !recipePreview}
            <ul class="plist">
              {#each d.recipeChoices() as { recipe, fit } (recipe.pluginId)}
                <li>
                  <button
                    type="button"
                    class="row-btn"
                    class:muted={!fit.fits}
                    onclick={() => chooseRecipe(recipe.pluginId)}
                  >
                    <strong>{recipe.displayName}</strong>
                    <span class="pmeta">
                      {fit.fits ? 'Fits your season' : fit.reason} · made for {sizeLabel(
                        recipe.bedSize.widthFt,
                        recipe.bedSize.lengthFt
                      )}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
            <button type="button" class="btn" onclick={closeRecipes}>Close</button>
          {:else}
            <ul class="plist">
              {#each recipePreview.plantings as prop (prop.key)}
                <li class="prow">
                  <span>
                    {prop.varietyDisplayName} · {shortDate(prop.plantingDateMs)} · {sizeLabel(
                      prop.footprint.w_in / 12,
                      prop.footprint.l_in / 12
                    )} · {plural(prop.plantCount, 'plant')}
                  </span>
                  <span class="prov-inline"><Provenance source={prop.provenance} compact /></span>
                  <label class="accept">
                    <input
                      type="checkbox"
                      checked={!skipped[prop.key]}
                      onchange={(e) =>
                        (skipped[prop.key] = !(e.currentTarget as HTMLInputElement).checked)}
                    />
                    Keep
                  </label>
                </li>
              {/each}
            </ul>
            {#each recipePreview.skipped as s (s.stepIndex)}
              <p class="chip suggest">Step {s.stepIndex + 1} left out: {s.reason}</p>
            {/each}
            {#each recipePreview.warnings as w, i (i)}
              <p class="chip warn">{w}</p>
            {/each}
            <div class="actions">
              <button
                type="button"
                class="btn primary"
                disabled={keptCount === 0}
                onclick={addRecipe}
              >
                Add {plural(keptCount, 'planting')}
              </button>
              <button
                type="button"
                class="btn"
                onclick={() => {
                  recipePreview = null;
                  d.ghosts = [];
                }}>Back</button
              >
            </div>
          {/if}
        </div>
      {/if}
      {#if fill}
        <div class="fill" data-testid="fill-results">
          {#if fill.message}<p class="banner">{fill.message}</p>{/if}
          {#if fill.proposals.length === 0}
            <p class="empty">Nothing fits the open space on this date.</p>
          {/if}
          <ul class="plist">
            {#each fill.proposals as prop (prop.key)}
              <li class="prow">
                <span
                  >{prop.varietyDisplayName} · {shortDate(prop.plantingDateMs)} · {sizeLabel(
                    prop.footprint.w_in / 12,
                    prop.footprint.l_in / 12
                  )} · {plural(prop.plantCount, 'plant')}</span
                >
                <span class="pmeta">{prop.note ?? spotText(prop.footprint)}</span>
                <span class="prov-inline"><Provenance source={prop.provenance} compact /></span>
                <label class="accept">
                  <input type="checkbox" bind:checked={accepted[prop.key]} />
                  Keep
                </label>
              </li>
            {/each}
          </ul>
          <div class="actions">
            <button
              type="button"
              class="btn primary"
              disabled={acceptedCount === 0}
              onclick={addAccepted}>Add {plural(acceptedCount, 'planting')}</button
            >
            <button
              type="button"
              class="btn"
              onclick={() => {
                fill = null;
                d.ghosts = [];
              }}>Close</button
            >
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div
      class="panel"
      role="tabpanel"
      id="{idPrefix}-{bed.blockId}-panel-history"
      aria-labelledby="{idPrefix}-{bed.blockId}-tab-history"
    >
      <h3>Bed history</h3>
      {#if history.length === 0}
        <p class="empty">Nothing has grown in {bed.name} yet.</p>
      {/if}
      {#each historyYears as year (year)}
        <h4>{year}</h4>
        <ul class="hist">
          {#each history.filter((h) => h.seasonYear === year) as h (h.cropId)}
            <li>
              {h.varietyDisplayName}
              <span class="pmeta"
                >· {familyLabel(h.cropFamily)}{h.plantingDateMs != null
                  ? ` · ${d.dateText(h.plantingDateMs)}`
                  : ''} · {plantingStatusText(h, d.nowMs)}</span
              >
            </li>
          {/each}
        </ul>
      {/each}
    </div>
  {/if}
</section>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-body-lg);
    color: var(--color-forest-deep);
  }
  h3,
  h4 {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }
  .sub,
  .pmeta {
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
  .tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: 1px solid var(--color-divider);
  }
  .tab {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: var(--color-ink-soft);
    font-weight: 600;
  }
  .tab[aria-selected='true'] {
    color: var(--color-forest-deep);
    border-bottom-color: var(--color-forest);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .fieldrow,
  .pair {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  label {
    font-weight: 600;
    color: var(--color-ink);
  }
  input,
  select {
    min-height: 48px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    font-size: var(--font-size-body);
    background: var(--color-paper);
    color: var(--color-ink);
    min-width: 0;
  }
  input[type='number'] {
    width: 6em;
  }
  input[type='checkbox'] {
    min-height: 0;
    width: 22px;
    height: 22px;
  }
  fieldset {
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input);
    padding: var(--space-2);
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  legend {
    font-weight: 700;
    color: var(--color-ink-soft);
    font-size: var(--font-size-meta);
  }
  .btn,
  .step {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
  }
  .btn.primary {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: #fff;
  }
  .btn.danger {
    color: var(--color-rust);
  }
  .btn:disabled {
    opacity: 0.55;
  }
  .row-btn {
    width: 100%;
    min-height: 48px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    text-align: left;
  }
  .row-btn.muted {
    opacity: 0.7;
  }
  .row-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .linkish {
    min-height: 48px;
    background: none;
    border: 0;
    padding: 0;
    font-weight: 700;
    color: var(--color-forest-deep);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .btn:focus-visible,
  .step:focus-visible,
  .tab:focus-visible,
  .linkish:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .nudge,
  .actions,
  .edit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .edit label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: 500;
  }
  .confirm,
  .succ,
  .fill {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-input);
    border: 1px solid var(--pill-wheat-bd);
    background: var(--pill-wheat-bg);
  }
  .confirm p,
  .succ p {
    margin: 0;
  }
  .plist,
  .hist,
  .sowings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .prow {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input);
  }
  .prow.selected {
    border-color: var(--color-rust);
  }
  .ptitle,
  .count {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .chip {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-input);
    font-size: var(--font-size-caption);
  }
  .chip.warn {
    background: var(--pill-wheat-bg);
    border: 1px solid var(--pill-wheat-bd);
    color: var(--pill-wheat-fg);
  }
  .chip.suggest {
    background: var(--pill-neutral-bg);
    border: 1px solid var(--pill-neutral-bd);
    color: var(--pill-neutral-fg);
  }
  .chip.good {
    background: var(--pill-forest-bg);
    border: 1px solid var(--pill-forest-bd);
    color: var(--pill-forest-fg);
  }
  .sowings li.conflict {
    color: var(--pill-wheat-fg);
    font-weight: 600;
  }
  .banner {
    margin: 0;
    font-weight: 600;
  }
  .prov-inline {
    display: inline-flex;
    align-self: flex-start;
    flex: 0 0 auto;
  }
  .series {
    flex-basis: 100%;
    margin: 0;
  }
  .count-select {
    min-width: 64px;
  }
  .accept {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 48px;
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
  }
</style>
