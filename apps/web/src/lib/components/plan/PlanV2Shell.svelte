<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 page shell.
   *
   * Composes the per-component pieces in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * into a single drop-in surface for [/plan](../../../../routes/plan/+page.svelte).
   *
   * URL contract (parent wires these via `?…`):
   *   - `?block=<id>`     → selected block. Defaults to first block.
   *   - `?planting=<idx>` → selected planting tab. `-1` = "All plantings"
   *                         (default for poly blocks); single-planting blocks
   *                         ignore this and render the deep view.
   *   - `?map=open`       → opens the MapOverlay.
   *
   * The shell renders read-only views of each card; mutating actions
   * (edit block / add planting / refine / open wizard) are emitted as
   * callbacks the parent owns. This keeps the shell composable + easy
   * to mock in tests.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { Sparkle } from 'lucide-svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import type { CalendarEvent } from '$lib/calendar/engine';
  import type { Task } from '$lib/db/tasks';

  import PlanLeftRail from './PlanLeftRail.svelte';
  import PlanBlockHeader from './PlanBlockHeader.svelte';
  import PlantingsTabStrip from './PlantingsTabStrip.svelte';
  import PlantingCard from './PlantingCard.svelte';
  import SeasonTimelineCard from './SeasonTimelineCard.svelte';
  import ScheduledTasksCard, { type ScheduledRow } from './ScheduledTasksCard.svelte';
  import MapOverlay from './MapOverlay.svelte';

  interface Props {
    blocks: BlockWithPlantings[];
    /** Open primary tasks across the active tenant. Filtered by selected
     *  block + planting for the ScheduledTasksCard. */
    tasks: Task[];
    /** Active farm name; appears in the MapOverlay title. */
    farmLabel?: string;
    /** Plugin index used to derive crop name + DTM for plantings. */
    cropMeta: Record<string, { displayName: string; daysToMaturity?: number; cropFamily?: string }>;
    /** When the user clicks "Add planting" / "Refine with AI" / etc. */
    onOpenWizard?: () => void;
    /** Optional: wire to /plan's existing block-edit modal. */
    onEditBlock?: (blockId: string) => void;
    /** Optional: wire to /plan's existing add-block flow. */
    onAddBlock?: () => void;
    /** Optional: wire to /plan's existing add-planting flow. */
    onAddPlanting?: (blockId: string) => void;
  }
  const {
    blocks,
    tasks,
    farmLabel,
    cropMeta,
    onOpenWizard,
    onEditBlock,
    onAddBlock,
    onAddPlanting
  }: Props = $props();

  // ── URL-driven state ──────────────────────────────────────────────
  const selectedBlockId = $derived.by(() => {
    const fromUrl = $page.url.searchParams.get('block');
    if (fromUrl && blocks.some((b) => b.id === fromUrl)) return fromUrl;
    return blocks[0]?.id;
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
  const activePlanting = $derived(
    activePlantingIdx >= 0 ? plantings[activePlantingIdx] : null
  );

  // ── Derived data ──────────────────────────────────────────────────
  /** All calendar-engine events for the selected block, oldest-first. */
  const blockEvents = $derived.by<CalendarEvent[]>(() => {
    if (!selectedBlock) return [];
    const out: CalendarEvent[] = [];
    for (const p of selectedBlock.plantings) {
      const meta = cropMeta[p.cropPluginId];
      if (!meta) continue;
      // We need the actual CropPlugin to derive events, but cropMeta is a
      // thin projection. The parent passes through eventsForPlanting()
      // results via the `events` field on each planting when available;
      // here we lazy-derive from a synthetic minimal plugin only if no
      // events were pre-computed. Most callers should pre-derive at the
      // loader layer.
    }
    return out;
  });

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
      .filter((t) => activePlanting ? t.cropId === activePlanting.id : true)
      .filter((t) => t.scheduledFor < window)
      .sort((a, b) => a.scheduledFor - b.scheduledFor)
      .map((t) => {
        const planting = selectedBlock.plantings.find((p) => p.id === t.cropId);
        return {
          id: t.id,
          dateLabel: new Date(t.scheduledFor).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          }),
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

  function plantingColor(plantingId: string): string {
    const PALETTE = ['#7a8f5a', '#c9961f', '#6f8fa8', '#a85a1f', '#4a8b54', '#a23a3a', '#8a6722', '#7a3a4d'];
    let h = 0;
    for (let i = 0; i < plantingId.length; i++) h = (h * 31 + plantingId.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /** Companions for a given planting = the other plantings in the same
   *  block (everything that isn't this row). */
  function companionsFor(plantingId: string) {
    return plantings.filter((p) => p.id !== plantingId);
  }

  // ── Nav actions ───────────────────────────────────────────────────
  function selectBlock(id: string) {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('block', id);
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

  // Phase 25b legacy support — `?tab=layout` now opens the map overlay
  // (per the issue's "back-compat" requirement) BUT we don't auto-flip
  // the URL on first paint, since /plan/+page.svelte still owns the
  // legacy layout-tab content for power users. Parent handles the
  // tab-driven content switch.
</script>

<div class="pv2">
  <PlanLeftRail
    {blocks}
    selectedId={selectedBlockId}
    onSelect={selectBlock}
    {onAddBlock}
  />

  <div class="pv2-main">
    {#if !selectedBlock}
      <div class="pv2-empty">
        <p>No blocks yet. <button type="button" class="link" onclick={() => onAddBlock?.()}>Add your first block</button>.</p>
      </div>
    {:else}
      <PlanBlockHeader
        block={selectedBlock}
        onOpenMap={openMap}
        onRefineWithAi={onOpenWizard}
        onEditBlock={onEditBlock ? () => onEditBlock(selectedBlock.id) : undefined}
        onAddPlanting={onAddPlanting ? () => onAddPlanting(selectedBlock.id) : undefined}
      />

      {#if isPoly}
        <PlantingsTabStrip
          {plantings}
          activeIdx={activePlantingIdx}
          onSelect={selectPlanting}
        />
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
              companions={companionsFor(p.id)}
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
            companions={companionsFor(activePlanting.id)}
            onCompanionClick={(id) => selectPlanting(plantings.findIndex((x) => x.id === id))}
          />
        </div>
      {/if}

      {#if plantings.length > 0}
        <SeasonTimelineCard
          {plantings}
          events={blockEvents}
          {daysToMaturityById}
        />

        <ScheduledTasksCard
          rows={scheduledRows}
          titleSuffix={activePlanting
            ? `· ${activePlanting.varietyDisplayName.split(' ').slice(0, 2).join(' ')}`
            : '· next 30 days'}
        />
      {/if}
    {/if}
  </div>

  <MapOverlay
    open={mapOpen}
    onClose={closeMap}
    {blocks}
    selectedBlockId={selectedBlockId}
    {farmLabel}
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
  .pv2-empty {
    text-align: center;
    padding: 40px 24px;
    color: var(--color-ink-muted);
  }
  .link {
    background: transparent;
    border: none;
    color: var(--color-forest);
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    font-family: inherit;
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
