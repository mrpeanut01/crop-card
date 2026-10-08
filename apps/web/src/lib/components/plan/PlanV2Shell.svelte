<script lang="ts">
  import { goto } from '$app/navigation';
  import OrchardPanel from '$lib/components/orchard/OrchardPanel.svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import { Sparkle } from 'lucide-svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import type { CalendarEvent } from '$lib/calendar/engine';
  import type { Task } from '$lib/db/tasks';

  import PlanLeftRail from './PlanLeftRail.svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import type { FarmSnapshot } from '$lib/cards/snapshot';
  import { withHousing, type HousingByArea } from '$lib/farm/housedAnimals';
  import { withGrazing, withGrazingTimeLink, type GrazingByArea } from '$lib/farm/areaGrazing';
  import { ForageAdvisoryCache } from '$lib/client/forageAdvisory.svelte';
  import { snapshotFromMapData } from '$lib/farm/mapSnapshot';
  import { snapshotCarryoverLines, withSnapshotCarryover } from '$lib/cards/build/area';
  import { carryoverSectionTitles, withCarryover } from '$lib/farm/areaCarryover';
  import { isSensitiveFamily } from '$lib/amendments/spreadPrompt';
  import { DESIGNABLE_AREA_KINDS, isCropBearing, type AreaKind } from '$lib/farm/areaKinds';
  import { splitGroupBlocks, splitNoun } from '$lib/plan/splitGroup';
  import {
    NO_AREA,
    planAreaCard,
    planBlockCard,
    planRailCards,
    planSelectHref,
    plantingColor,
    type PlanAreaEntry
  } from '$lib/plan/planCards';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import PlanBlockHeader from './PlanBlockHeader.svelte';
  import PlantingsTabStrip from './PlantingsTabStrip.svelte';
  import PlantingCard from './PlantingCard.svelte';
  import SeasonTimelineCard from './SeasonTimelineCard.svelte';
  import ScheduledTasksCard, { type ScheduledRow } from './ScheduledTasksCard.svelte';
  import { taskSourceLabel } from '$lib/tasks/source';
  import MapOverlay from './MapOverlay.svelte';
  import type { OverlayFieldInput } from '$lib/plan/mapOverlayLayout';
  import {
    blockCompanions,
    blockHarvestWindowLabel,
    blocksOnView,
    blockStatus,
    blockStatusLabel,
    blockStatusTone,
    currentStageLabel,
    plantingRoleLabel,
    plantingHarvestLabel,
    plantingStatus,
    scheduledTaskTiming
  } from '$lib/plan/planV2Derive';

  interface Props {
    blocks: BlockWithPlantings[];
    /** Open primary tasks across the active tenant. Filtered by selected
     *  block + planting for the ScheduledTasksCard. */
    tasks: Task[];
    /** Calendar-engine events for every planting (loader-derived). */
    events?: CalendarEvent[];
    /** Active farm name; appears in the MapOverlay title. */
    farmLabel?: string;
    /** Field outlines / dimensions drawn behind blocks in the MapOverlay. */
    fields?: OverlayFieldInput[];
    /** Plugin index used to derive crop name + DTM for plantings. */
    cropMeta: Record<
      string,
      {
        displayName: string;
        daysToMaturity?: number;
        cropFamily?: string;
        archetype?: string;
        /** #623: a perennial still stands after it is marked harvested. */
        perennial?: boolean;
      }
    >;
    /** When the user clicks "Add planting" / "Refine with AI" / etc. */
    onOpenWizard?: () => void;
    /** Optional: wire to /plan's existing block-edit modal. */
    onEditBlock?: (blockId: string) => void;
    /** Optional: wire to /plan's existing add-block flow. */
    onAddBlock?: () => void;
    /** Optional: wire to /plan's existing add-planting flow. */
    onAddPlanting?: (blockId: string) => void;
    /** Opens the add-task form for the selected block (+ active planting). */
    onAddTask?: (blockId: string, plantingId: string | null) => void;
    /** Farm-map editor link for the "No map geometry" pill (owner only). */
    geometryEditHref?: string;
    /** Areas, blocks and plantings for the Area and Block cards. Built
     *  from `fields` + `blocks` when the loader doesn't send one. */
    areaSnapshot?: FarmSnapshot | null;
    /** Animals housed on each Area (Phase 32B). */
    areaHousing?: HousingByArea;
    /** Grazing and hay holds on each Area (Phase 32C). */
    areaGrazing?: GrazingByArea;
    petsLayout?: boolean;
    /** False for helpers: block and map edits are the owner's. */
    canEdit?: boolean;
    /** Phase 35: crops the farm keeps in one bed (owner only). */
    keepInOneBedCrops?: string[];
    /** The plan's season year, for the season timeline axis. */
    seasonYear?: number;
  }
  const {
    blocks: allBlocks,
    tasks,
    events = [],
    farmLabel,
    fields = [],
    cropMeta,
    onOpenWizard,
    onEditBlock,
    onAddBlock,
    onAddPlanting,
    onAddTask,
    geometryEditHref,
    areaSnapshot = null,
    areaHousing = {},
    areaGrazing = {},
    petsLayout = false,
    canEdit = true,
    keepInOneBedCrops = [],
    seasonYear
  }: Props = $props();

  const onView = $derived(blocksOnView(allBlocks, (id) => cropMeta[id]?.perennial ?? false));
  const blocks = $derived(onView.blocks);
  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale);
  const cropName = (p: { cropPluginId: string; varietyDisplayName: string }) =>
    cropDisplayName(p.cropPluginId, p.varietyDisplayName, locale);
  const prefs = $derived(currentPrefs());
  const areas = $derived<PlanAreaEntry[]>(
    fields.map((f) => ({ id: f.id, name: f.name, kind: (f.kind ?? 'field') as AreaKind }))
  );
  const snapshot = $derived<FarmSnapshot>(
    areaSnapshot ?? snapshotFromMapData({ ownerId: 'plan', fields, blocks })
  );
  function areaIdOf(b: BlockWithPlantings): string {
    return b.fieldId && areas.some((a) => a.id === b.fieldId) ? b.fieldId : NO_AREA;
  }

  // Phase 35 (R-16, R-22): parts of one seed lot in several blocks, read
  // from the plantings this page already loaded.
  const splitGroups = $derived(splitGroupBlocks(blocks));
  const bedAreaIds = $derived(
    new Set(
      areas
        .filter((a) => (DESIGNABLE_AREA_KINDS as readonly string[]).includes(a.kind))
        .map((a) => a.id)
    )
  );
  let keepOverride = $state<string[] | null>(null);
  const keepSet = $derived(new Set(keepOverride ?? keepInOneBedCrops));
  /** The crop whose keep-in-one-bed choice is saving, and the one planting
   *  card whose tap failed, so the error shows once, on the card tapped. */
  let keepBusyCrop = $state<string | null>(null);
  let keepError = $state<{ plantingId: string; message: string } | null>(null);

  function splitFor(p: { splitGroupId?: string | null; blockId: string }) {
    const parts = p.splitGroupId ? splitGroups.get(p.splitGroupId) : undefined;
    if (!parts) return undefined;
    const bedIds = parts.filter((x) => x.areaId && bedAreaIds.has(x.areaId)).map((x) => x.blockId);
    return {
      n: parts.length,
      noun: splitNoun(
        parts.map((x) => x.blockId),
        bedIds
      ),
      others: parts
        .filter((x) => x.blockId !== p.blockId)
        .map((x) => ({
          blockId: x.blockId,
          name: x.blockName,
          href: planSelectHref(
            page.url.searchParams,
            x.areaId && areas.some((a) => a.id === x.areaId) ? x.areaId : NO_AREA,
            x.blockId
          )
        }))
    };
  }

  async function toggleKeep(cropPluginId: string, plantingId: string) {
    keepBusyCrop = cropPluginId;
    keepError = null;
    try {
      const res = await fetch('/api/plan/keep-in-one-bed', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cropPluginId, keep: !keepSet.has(cropPluginId) })
      });
      const body = (await res.json().catch(() => ({}))) as { cropPluginIds?: string[] };
      if (!res.ok || !body.cropPluginIds) {
        keepError = { plantingId, message: tr('plan.split.saveFailed') };
        return;
      }
      keepOverride = body.cropPluginIds;
    } catch {
      keepError = { plantingId, message: tr('plan.split.saveFailed') };
    } finally {
      keepBusyCrop = null;
    }
  }

  const fieldParam = $derived(page.url.searchParams.get('field'));
  const blockParam = $derived(page.url.searchParams.get('block'));
  const selectedAreaId = $derived.by(() => {
    if (fieldParam === NO_AREA && blocks.some((b) => areaIdOf(b) === NO_AREA)) return NO_AREA;
    if (fieldParam && areas.some((a) => a.id === fieldParam)) return fieldParam;
    const fromBlock = blocks.find((b) => b.id === blockParam);
    if (fromBlock) return areaIdOf(fromBlock);
    if (blocks[0]) return areaIdOf(blocks[0]);
    return areas[0]?.id;
  });
  const selectedArea = $derived(areas.find((a) => a.id === selectedAreaId));
  const areaBlocks = $derived(blocks.filter((b) => areaIdOf(b) === selectedAreaId));
  const selectedBlockId = $derived.by(() => {
    if (blockParam && areaBlocks.some((b) => b.id === blockParam)) return blockParam;
    return areaBlocks[0]?.id;
  });
  const plantingIdxParam = $derived.by(() => {
    const raw = page.url.searchParams.get('planting');
    if (raw === null) return null;
    if (raw === 'all') return -1;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  });
  const mapOpen = $derived(page.url.searchParams.get('map') === 'open');

  const selectedBlock = $derived(blocks.find((b) => b.id === selectedBlockId));
  const railCards = $derived(planRailCards(snapshot, areas, blocks, page.url.searchParams, prefs));
  const areaCard = $derived.by(() => {
    if (!selectedArea) return null;
    const card = planAreaCard(snapshot, selectedArea, prefs);
    if (!card) return null;
    const housed = withHousing(card, areaHousing[selectedArea.id], {
      petsLayout,
      locale
    });
    const g = areaGrazing[selectedArea.id];
    const held = withGrazingTimeLink(
      withGrazing(housed, g, prefs.timeZone),
      g,
      selectedArea.id,
      canEdit
    );
    return forage.decorate(
      withSnapshotCarryover(snapshot, selectedArea.id, held, { link: true, locale }),
      selectedArea.id,
      locale
    );
  });
  const forage = new ForageAdvisoryCache();
  $effect(() => {
    if (selectedArea && isCropBearing(selectedArea.kind))
      void forage.load({ fieldId: selectedArea.id });
  });
  const cropDays = $derived.by<Record<string, number | undefined>>(() => {
    const out: Record<string, number | undefined> = {};
    for (const k of Object.keys(cropMeta)) out[k] = cropMeta[k].daysToMaturity;
    return out;
  });
  const blockCards = $derived(
    selectedAreaId
      ? areaBlocks.map((b) =>
          withCarryover(
            planBlockCard(b, page.url.searchParams, selectedAreaId, cropDays, prefs),
            snapshotCarryoverLines(snapshot, [b.id]),
            { locale }
          )
        )
      : []
  );
  const plantings = $derived(selectedBlock?.plantings ?? []);
  const blockCarryover = $derived(
    selectedBlock ? snapshotCarryoverLines(snapshot, [selectedBlock.id]) : []
  );
  function plantingCarryover(cropPluginId: string) {
    return isSensitiveFamily(cropMeta[cropPluginId]?.cropFamily) ? blockCarryover : [];
  }
  const multi = $derived(plantings.length > 1);
  const endedHere = $derived(selectedBlock ? (onView.endedCount.get(selectedBlock.id) ?? 0) : 0);

  /** Active planting tab index; defaults to -1 (all) for poly, 0 otherwise. */
  const activePlantingIdx = $derived.by(() => {
    if (plantings.length === 0) return -1;
    if (plantingIdxParam !== null) {
      // Clamp to bounds.
      if (plantingIdxParam < -1 || plantingIdxParam >= plantings.length) {
        return multi ? -1 : 0;
      }
      return plantingIdxParam;
    }
    return multi ? -1 : 0;
  });
  const activePlanting = $derived(activePlantingIdx >= 0 ? plantings[activePlantingIdx] : null);

  // ── Derived data ──────────────────────────────────────────────────
  /** All calendar-engine events for the selected block, oldest-first. */
  const blockEvents = $derived.by<CalendarEvent[]>(() => {
    if (!selectedBlock) return [];
    const id = selectedBlock.id;
    const shown = new Set(plantings.map((p) => p.id));
    return events
      .filter((e) => e.blockId === id && (!e.cropId || shown.has(e.cropId)))
      .sort((a, b) => a.startMs - b.startMs);
  });

  const headerStatus = $derived(
    blockStatus(
      plantings.map((p) =>
        plantingStatus(
          p.plantingDate,
          cropMeta[p.cropPluginId]?.daysToMaturity,
          Date.now(),
          p.status
        )
      )
    )
  );
  const companionMap = $derived(
    blockCompanions(plantings, blockEvents, (id) => cropMeta[id]?.daysToMaturity)
  );
  const isPoly = $derived([...companionMap.values()].some((c) => c.length > 0));
  const harvestWindowLabel = $derived(blockHarvestWindowLabel(blockEvents, Date.now(), locale));

  const daysToMaturityById = $derived.by<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(cropMeta)) {
      const dtm = cropMeta[k].daysToMaturity;
      if (dtm !== undefined) out[k] = dtm;
    }
    return out;
  });

  /** Tasks filtered by selected block (and planting if a tab is active). */
  const scheduledRows = $derived.by<ScheduledRow[]>(() => {
    if (!selectedBlock) return [];
    const now = Date.now();
    const window = now + 30 * 24 * 60 * 60 * 1000;
    return tasks
      .filter((t) => t.kind === 'primary')
      .filter((t) => t.blockId === selectedBlock.id)
      .filter((t) => (activePlanting ? t.cropId === activePlanting.id : true))
      .filter((t) => t.scheduledFor < window)
      .sort((a, b) => a.scheduledFor - b.scheduledFor)
      .map((t) => {
        const planting = selectedBlock.plantings.find((p) => p.id === t.cropId);
        const timing = scheduledTaskTiming(t.scheduledFor, now, prefs);
        return {
          id: t.id,
          dateLabel: timing.dateLabel,
          title: t.title,
          plantingLabel: planting ? cropName(planting).split(' ').slice(0, 2).join(' ') : undefined,
          plantingColor: planting ? plantingColor(planting.id) : undefined,
          source: taskSourceLabel(t.pluginTemplateKey, locale),
          status: timing.status
        };
      });
  });

  /** #623: the other shown plantings in the block that share time in the
   *  ground with this one, not every planting the block ever had. */
  function companionsFor(plantingId: string) {
    return companionMap.get(plantingId) ?? [];
  }

  function smallGrainHref(plantingId: string, archetype?: string): string | undefined {
    return archetype === 'small-grain.zadoks'
      ? `/plan/wheat?planting=${encodeURIComponent(plantingId)}`
      : undefined;
  }

  // ── Nav actions ───────────────────────────────────────────────────
  function selectBlockFromMap(id: string) {
    const sp = new URLSearchParams(page.url.search);
    sp.set('block', id);
    sp.delete('field');
    sp.delete('planting');
    sp.delete('map');
    goto(`/plan?${sp.toString()}`, { reset: false });
  }
  function selectPlanting(idx: number) {
    const sp = new URLSearchParams(page.url.search);
    sp.set('planting', idx === -1 ? 'all' : String(idx));
    goto(`/plan?${sp.toString()}`, { reset: false });
  }
  function openMap() {
    const sp = new URLSearchParams(page.url.search);
    sp.set('map', 'open');
    goto(`/plan?${sp.toString()}`, { reset: false });
  }
  function closeMap() {
    const sp = new URLSearchParams(page.url.search);
    sp.delete('map');
    goto(`/plan?${sp.toString()}`, { reset: false });
  }
</script>

<div class="pv2">
  <PlanLeftRail cards={railCards} {selectedAreaId} {onAddBlock} />

  <div class="pv2-main">
    {#if blocks.length > 0 && selectedAreaId}
      <section
        class="area-view"
        aria-label={tr('planui.shell.areaAria')}
        data-testid="plan-area-view"
      >
        {#if areaCard}
          <CardView card={areaCard} {prefs} showAsOf={false} />
          <OrchardPanel areaId={selectedAreaId} />
        {/if}
        <div class="block-cards-head">
          <h2 class="section-title">
            {selectedArea
              ? tr('planui.shell.bedsIn', { name: areaCard?.title ?? selectedArea.name })
              : tr('planui.shell.blocksNoArea')}
          </h2>
          {#if onAddBlock}
            <button type="button" class="ghost-btn" onclick={onAddBlock}
              >{tr('planui.shell.addBlock')}</button
            >
          {/if}
        </div>
        {#if blockCards.length}
          <ul
            class="block-cards"
            data-testid="plan-block-cards"
            data-sveltekit-noscroll
            data-sveltekit-keepfocus
          >
            {#each blockCards as card, i (card.key)}
              <li>
                <CardView
                  {card}
                  variant="compact"
                  {prefs}
                  factLimit={3}
                  compactSections={carryoverSectionTitles(locale)}
                  showAsOf={false}
                  selected={areaBlocks[i]?.id === selectedBlockId}
                />
              </li>
            {/each}
          </ul>
        {:else}
          <div class="card-empty" data-testid="plan-area-empty">
            <p>{tr('planui.shell.nothingPlanted')}</p>
            {#if canEdit && selectedArea && isCropBearing(selectedArea.kind)}
              <a class="primary plan-here" href="/plan?area={encodeURIComponent(selectedArea.id)}">
                <Sparkle size={13} strokeWidth={1.75} />
                {tr('planui.shell.planHere')}
              </a>
            {/if}
          </div>
        {/if}
      </section>
    {/if}
    {#if selectedBlock}
      <PlanBlockHeader
        block={selectedBlock}
        statusLabel={blockStatusLabel(headerStatus, locale)}
        statusTone={blockStatusTone(headerStatus)}
        {harvestWindowLabel}
        {geometryEditHref}
        onOpenMap={openMap}
        onRefineWithAi={onOpenWizard}
        onEditBlock={onEditBlock ? () => onEditBlock(selectedBlock.id) : undefined}
        askOwner={!canEdit}
        onAddPlanting={onAddPlanting ? () => onAddPlanting(selectedBlock.id) : undefined}
        polyculture={isPoly}
      />

      {#if endedHere > 0}
        <p class="ended-note" data-testid="plan-ended-plantings">
          {tr('planui.shell.earlierPlantings', { count: endedHere })}
        </p>
      {/if}

      {#if multi}
        <PlantingsTabStrip {plantings} activeIdx={activePlantingIdx} onSelect={selectPlanting} />
      {/if}

      {#if plantings.length === 0}
        <div class="card-empty">
          <p>{tr('planui.shell.noPlantings')}</p>
          {#if onAddPlanting}
            <button type="button" class="primary" onclick={() => onAddPlanting(selectedBlock.id)}>
              <Sparkle size={13} strokeWidth={1.75} />
              {tr('planui.shell.addFirst')}
            </button>
          {/if}
        </div>
      {:else if activePlantingIdx === -1}
        <div class="grid">
          {#each plantings as p (p.id)}
            {@const meta = cropMeta[p.cropPluginId]}
            <PlantingCard
              planting={p}
              daysToMaturity={meta?.daysToMaturity}
              cropName={meta?.displayName}
              role={plantingRoleLabel(p, locale)}
              stage={currentStageLabel(blockEvents, p, Date.now(), locale)}
              harvestStart={plantingHarvestLabel(blockEvents, p.id, locale)}
              detailHref={smallGrainHref(p.id, meta?.archetype)}
              carryover={plantingCarryover(p.cropPluginId)}
              companions={companionsFor(p.id)}
              split={splitFor(p)}
              keepInOneBed={keepSet.has(p.cropPluginId)}
              onToggleKeep={canEdit ? () => toggleKeep(p.cropPluginId, p.id) : undefined}
              keepBusy={keepBusyCrop === p.cropPluginId}
              keepError={keepError?.plantingId === p.id ? keepError.message : null}
              sourceTag={p.sourceProvenance === 'ai'
                ? 'AI plan'
                : p.sourceProvenance === 'fallback'
                  ? 'Carry-forward'
                  : undefined}
              onCompanionClick={(id) => selectPlanting(plantings.findIndex((x) => x.id === id))}
            />
          {/each}
        </div>
      {:else if activePlanting}
        {@const meta = cropMeta[activePlanting.cropPluginId]}
        <div class="single-grid">
          <PlantingCard
            planting={activePlanting}
            daysToMaturity={meta?.daysToMaturity}
            cropName={meta?.displayName}
            role={plantingRoleLabel(activePlanting, locale)}
            stage={currentStageLabel(blockEvents, activePlanting, Date.now(), locale)}
            harvestStart={plantingHarvestLabel(blockEvents, activePlanting.id, locale)}
            detailHref={smallGrainHref(activePlanting.id, meta?.archetype)}
            carryover={plantingCarryover(activePlanting.cropPluginId)}
            companions={companionsFor(activePlanting.id)}
            split={splitFor(activePlanting)}
            keepInOneBed={keepSet.has(activePlanting.cropPluginId)}
            onToggleKeep={canEdit
              ? () => toggleKeep(activePlanting.cropPluginId, activePlanting.id)
              : undefined}
            keepBusy={keepBusyCrop === activePlanting.cropPluginId}
            keepError={keepError?.plantingId === activePlanting.id ? keepError.message : null}
            sourceTag={activePlanting.sourceProvenance === 'ai'
              ? 'AI plan'
              : activePlanting.sourceProvenance === 'fallback'
                ? 'Carry-forward'
                : undefined}
            onCompanionClick={(id) => selectPlanting(plantings.findIndex((x) => x.id === id))}
          />
        </div>
      {/if}

      {#if plantings.length > 0}
        <SeasonTimelineCard {plantings} events={blockEvents} {daysToMaturityById} {seasonYear} />
      {/if}

      <div id="plan-scheduled-tasks">
        <ScheduledTasksCard
          rows={scheduledRows}
          titleSuffix={activePlanting
            ? `· ${cropName(activePlanting).split(' ').slice(0, 2).join(' ')}`
            : undefined}
          onAddTask={onAddTask
            ? () => onAddTask(selectedBlock.id, activePlanting?.id ?? null)
            : undefined}
        />
      </div>
    {/if}
  </div>

  <MapOverlay
    open={mapOpen}
    onClose={closeMap}
    {blocks}
    {fields}
    {selectedBlockId}
    {farmLabel}
    {canEdit}
    onSelect={selectBlockFromMap}
  />
</div>

<style>
  .pv2 {
    display: flex;
    align-items: stretch;
    gap: 0;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    overflow: hidden;
    min-height: 600px;
  }
  .pv2-main {
    flex: 1;
    padding: 22px 28px 28px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .area-view {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .block-cards-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .section-title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 18px;
    font-weight: 500;
    color: var(--color-ink);
  }
  .block-cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .ghost-btn {
    min-height: 48px;
    padding: 0 14px;
    background: transparent;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    color: var(--color-forest-deep);
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .plan-here {
    min-height: 48px;
    text-decoration: none;
  }
  .ghost-btn:hover {
    border-color: var(--color-forest-deep);
  }
  .ended-note {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .card-empty {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 24px;
    text-align: center;
    color: var(--color-ink-soft);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
    gap: 14px;
  }
  .single-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    padding: 9px 14px;
    background: var(--color-forest);
    color: var(--color-cream);
    border: none;
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .primary:hover {
    background: var(--color-forest-deep);
  }
  @media (max-width: 900px) {
    .pv2 {
      flex-direction: column;
    }
    .pv2-main {
      padding: 18px 16px;
    }
  }
</style>
