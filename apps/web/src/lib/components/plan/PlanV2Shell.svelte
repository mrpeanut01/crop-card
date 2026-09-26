<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { Sparkle } from 'lucide-svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import type { CalendarEvent } from '$lib/calendar/engine';
  import type { Task } from '$lib/db/tasks';

  import PlanLeftRail from './PlanLeftRail.svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import type { FarmSnapshot } from '$lib/cards/snapshot';
  import { snapshotFromMapData } from '$lib/farm/mapSnapshot';
  import { isCropBearing, type AreaKind } from '$lib/farm/areaKinds';
  import {
    NO_AREA,
    planAreaCard,
    planBlockCard,
    planRailCards,
    plantingColor,
    type PlanAreaEntry
  } from '$lib/plan/planCards';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import PlanBlockHeader from './PlanBlockHeader.svelte';
  import PlantingsTabStrip from './PlantingsTabStrip.svelte';
  import PlantingCard from './PlantingCard.svelte';
  import SeasonTimelineCard from './SeasonTimelineCard.svelte';
  import ScheduledTasksCard, { type ScheduledRow } from './ScheduledTasksCard.svelte';
  import MapOverlay from './MapOverlay.svelte';
  import type { OverlayFieldInput } from '$lib/plan/mapOverlayLayout';
  import { fmt } from '$lib/prefsState.svelte';
  import {
    blockHarvestWindowLabel,
    blockStatus,
    blockStatusTone,
    currentStageLabel,
    plantingRoleLabel,
    plantingHarvestLabel,
    plantingStatus
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
      { displayName: string; daysToMaturity?: number; cropFamily?: string; archetype?: string }
    >;
    /** When the user clicks "Add planting" / "Refine with AI" / etc. */
    onOpenWizard?: () => void;
    /** Optional: wire to /plan's existing block-edit modal. */
    onEditBlock?: (blockId: string) => void;
    /** Optional: wire to /plan's existing add-block flow. */
    onAddBlock?: () => void;
    /** Opens the planning wizard from the empty-farm state (owner only). */
    onStartPlan?: () => void;
    /** Season the empty-farm state invites the operator to plan. */
    seasonYear?: number;
    /** Optional: wire to /plan's existing add-planting flow. */
    onAddPlanting?: (blockId: string) => void;
    /** Opens the add-task form for the selected block (+ active planting). */
    onAddTask?: (blockId: string, plantingId: string | null) => void;
    /** Farm-map editor link for the "No map geometry" pill (owner only). */
    geometryEditHref?: string;
    /** Areas, blocks and plantings for the Area and Block cards. Built
     *  from `fields` + `blocks` when the loader doesn't send one. */
    areaSnapshot?: FarmSnapshot | null;
    /** False for helpers: block and map edits are the owner's. */
    canEdit?: boolean;
  }
  const {
    blocks,
    tasks,
    events = [],
    farmLabel,
    fields = [],
    cropMeta,
    onOpenWizard,
    onEditBlock,
    onAddBlock,
    onStartPlan,
    seasonYear = Number(fmt.today().slice(0, 4)),
    onAddPlanting,
    onAddTask,
    geometryEditHref,
    areaSnapshot = null,
    canEdit = true
  }: Props = $props();

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

  const fieldParam = $derived($page.url.searchParams.get('field'));
  const blockParam = $derived($page.url.searchParams.get('block'));
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
    const raw = $page.url.searchParams.get('planting');
    if (raw === null) return null;
    if (raw === 'all') return -1;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  });
  const mapOpen = $derived($page.url.searchParams.get('map') === 'open');

  const selectedBlock = $derived(blocks.find((b) => b.id === selectedBlockId));
  const railCards = $derived(planRailCards(snapshot, areas, blocks, $page.url.searchParams, prefs));
  const areaCard = $derived(selectedArea ? planAreaCard(snapshot, selectedArea, prefs) : null);
  const cropDays = $derived.by<Record<string, number | undefined>>(() => {
    const out: Record<string, number | undefined> = {};
    for (const k of Object.keys(cropMeta)) out[k] = cropMeta[k].daysToMaturity;
    return out;
  });
  const blockCards = $derived(
    selectedAreaId
      ? areaBlocks.map((b) =>
          planBlockCard(b, $page.url.searchParams, selectedAreaId, cropDays, prefs)
        )
      : []
  );
  const plantings = $derived(selectedBlock?.plantings ?? []);
  const isPoly = $derived(plantings.length > 1);

  /** Active planting tab index; defaults to -1 (all) for poly, 0 otherwise. */
  const activePlantingIdx = $derived.by(() => {
    if (plantings.length === 0) return -1;
    if (plantingIdxParam !== null) {
      // Clamp to bounds.
      if (plantingIdxParam < -1 || plantingIdxParam >= plantings.length) {
        return isPoly ? -1 : 0;
      }
      return plantingIdxParam;
    }
    return isPoly ? -1 : 0;
  });
  const activePlanting = $derived(activePlantingIdx >= 0 ? plantings[activePlantingIdx] : null);

  // ── Derived data ──────────────────────────────────────────────────
  /** All calendar-engine events for the selected block, oldest-first. */
  const blockEvents = $derived.by<CalendarEvent[]>(() => {
    if (!selectedBlock) return [];
    const id = selectedBlock.id;
    return events.filter((e) => e.blockId === id).sort((a, b) => a.startMs - b.startMs);
  });

  const headerStatus = $derived(
    blockStatus(
      plantings.map((p) => plantingStatus(p.plantingDate, cropMeta[p.cropPluginId]?.daysToMaturity))
    )
  );
  const harvestWindowLabel = $derived(blockHarvestWindowLabel(blockEvents));

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
        return {
          id: t.id,
          dateLabel: fmt.day(t.scheduledFor, 'month-day'),
          title: t.title,
          plantingLabel: planting?.varietyDisplayName?.split(' ').slice(0, 2).join(' '),
          plantingColor: planting ? plantingColor(planting.id) : undefined,
          source: t.pluginTemplateKey ?? 'Manual',
          status:
            t.scheduledFor < now - 24 * 60 * 60 * 1000
              ? 'overdue'
              : t.scheduledFor < now + 24 * 60 * 60 * 1000
                ? 'today'
                : 'scheduled'
        };
      });
  });

  /** Companions for a given planting = the other plantings in the same
   *  block (everything that isn't this row). */
  function companionsFor(plantingId: string) {
    return plantings.filter((p) => p.id !== plantingId);
  }

  function smallGrainHref(plantingId: string, archetype?: string): string | undefined {
    return archetype === 'small-grain.zadoks'
      ? `/plan/wheat?planting=${encodeURIComponent(plantingId)}`
      : undefined;
  }

  // ── Nav actions ───────────────────────────────────────────────────
  function selectBlock(id: string) {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('block', id);
    sp.delete('field');
    sp.delete('planting');
    goto(`/plan?${sp.toString()}`, { keepFocus: true, noScroll: true });
  }
  function selectPlanting(idx: number) {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('planting', idx === -1 ? 'all' : String(idx));
    goto(`/plan?${sp.toString()}`, { keepFocus: true, noScroll: true });
  }
  function openMap() {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('map', 'open');
    goto(`/plan?${sp.toString()}`, { keepFocus: true, noScroll: true });
  }
  function closeMap() {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.delete('map');
    goto(`/plan?${sp.toString()}`, { keepFocus: true, noScroll: true });
  }
</script>

<div class="pv2">
  <PlanLeftRail cards={railCards} {selectedAreaId} {onAddBlock} />

  <div class="pv2-main">
    {#if blocks.length > 0 && selectedAreaId}
      <section class="area-view" aria-label="Area" data-testid="plan-area-view">
        {#if areaCard}
          <CardView card={areaCard} {prefs} showAsOf={false} />
        {/if}
        <div class="block-cards-head">
          <h2 class="section-title">
            {selectedArea
              ? `Beds and blocks in ${areaCard?.title ?? selectedArea.name}`
              : 'Blocks not in an Area'}
          </h2>
          {#if onAddBlock}
            <button type="button" class="ghost-btn" onclick={onAddBlock}>Add block</button>
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
                  showAsOf={false}
                  selected={areaBlocks[i]?.id === selectedBlockId}
                />
              </li>
            {/each}
          </ul>
        {:else}
          <div class="card-empty" data-testid="plan-area-empty">
            <p>Nothing is planted here yet.</p>
            {#if canEdit && selectedArea && isCropBearing(selectedArea.kind)}
              <a class="primary plan-here" href="/plan?area={encodeURIComponent(selectedArea.id)}">
                <Sparkle size={13} strokeWidth={1.75} />
                Plan a crop here
              </a>
            {/if}
          </div>
        {/if}
      </section>
    {/if}
    {#if !selectedBlock && blocks.length === 0}
      <div class="pv2-empty" data-empty-state="season-start">
        {#if onStartPlan}
          <h2 class="pv2-empty-title">Plan your {seasonYear} season</h2>
          <p class="pv2-empty-lede">
            The planning wizard walks you through it one step at a time: your season goals, the seed
            you have on hand, and the blocks you'll plant.
          </p>
          <button type="button" class="primary start" onclick={onStartPlan}>
            <Sparkle size={15} strokeWidth={1.75} />
            Start the planning wizard
          </button>
          {#if onAddBlock}
            <p class="pv2-empty-alt">
              Prefer to lay it out yourself? <a href="/plan/farm">Draw your farm</a> or
              <button type="button" class="link" onclick={onAddBlock}>add a block by hand</button>
            </p>
          {/if}
        {:else}
          <p>No blocks yet. The farm owner sets up blocks and the season plan.</p>
        {/if}
      </div>
    {:else if selectedBlock}
      <PlanBlockHeader
        block={selectedBlock}
        statusLabel={headerStatus}
        statusTone={blockStatusTone(headerStatus)}
        {harvestWindowLabel}
        {geometryEditHref}
        onOpenMap={openMap}
        onRefineWithAi={onOpenWizard}
        onEditBlock={onEditBlock ? () => onEditBlock(selectedBlock.id) : undefined}
        askOwner={!canEdit}
        onAddPlanting={onAddPlanting ? () => onAddPlanting(selectedBlock.id) : undefined}
      />

      {#if isPoly}
        <PlantingsTabStrip {plantings} activeIdx={activePlantingIdx} onSelect={selectPlanting} />
      {/if}

      {#if plantings.length === 0}
        <div class="card-empty">
          <p>This block has no plantings yet.</p>
          {#if onAddPlanting}
            <button type="button" class="primary" onclick={() => onAddPlanting(selectedBlock.id)}>
              <Sparkle size={13} strokeWidth={1.75} />
              Add first planting
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
              role={plantingRoleLabel(p)}
              stage={currentStageLabel(blockEvents, p)}
              harvestStart={plantingHarvestLabel(blockEvents, p.id)}
              detailHref={smallGrainHref(p.id, meta?.archetype)}
              companions={companionsFor(p.id)}
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
            role={plantingRoleLabel(activePlanting)}
            stage={currentStageLabel(blockEvents, activePlanting)}
            harvestStart={plantingHarvestLabel(blockEvents, activePlanting.id)}
            detailHref={smallGrainHref(activePlanting.id, meta?.archetype)}
            companions={companionsFor(activePlanting.id)}
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
        <SeasonTimelineCard {plantings} events={blockEvents} {daysToMaturityById} />
      {/if}

      <div id="plan-scheduled-tasks">
        <ScheduledTasksCard
          rows={scheduledRows}
          titleSuffix={activePlanting
            ? `· ${activePlanting.varietyDisplayName.split(' ').slice(0, 2).join(' ')}`
            : '· next 30 days'}
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
    onSelect={selectBlock}
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
  .pv2-empty {
    text-align: center;
    padding: 48px 24px;
    color: var(--color-ink-muted);
    max-width: 520px;
    margin: 0 auto;
  }
  .pv2-empty-title {
    margin: 0 0 10px;
    font-family: var(--font-serif);
    font-size: 26px;
    font-weight: 500;
    color: var(--color-ink);
  }
  .pv2-empty-lede {
    margin: 0;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .pv2-empty-alt {
    margin: 18px 0 0;
    font-size: 14px;
  }
  .primary.start {
    min-height: 48px;
    padding: 12px 20px;
    font-size: 15px;
    margin-top: 20px;
  }
  .link {
    background: transparent;
    border: none;
    color: var(--color-forest);
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    font-family: inherit;
    min-height: 48px;
    padding: 0 4px;
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
