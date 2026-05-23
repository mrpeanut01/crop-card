/**
 * /plan — step-0 front door for the season (Phase 13).
 *
 * Tab-driven: ?tab=overview|layout|crops|equipment|calendar.
 * One loader, conditional sections in the renderer. Each tab loads only
 * the data it needs so the round-trip stays cheap.
 *
 *   overview   — fields + blocks + first-run wizard
 *   layout     — block geometry + GeoJSON paste UI (absorbed from /map)
 *   crops      — plantings list + add planting + companion advisor
 *   equipment  — per-crop equipment bindings (Phase 12E)
 *   calendar   — month grid (absorbed from /plan/calendar)
 *
 *   Stock has been promoted to its own /stock route.
 */

import type { PageServerLoad } from './$types';
import {
  eventsForHarvest,
  eventsForPlanting,
  computeShadeWindowEvents,
  type BlockAxes,
  type CalendarEvent,
  type ShadeImpactEvent
} from '$lib/calendar/engine';
import { listShadeSources } from '$lib/db/shadeSources';
import { getFarmLatLon } from '$lib/schedule/settings';
import { loadSeasonSetup } from '$lib/season/setup.server';
import {
  plantingBarEndMs,
  rotationConflicts,
  sameTimeOverlap,
  type BlockBar,
  type PriorCrop,
  type RotationConflict,
  type SameTimeOverlap
} from '$lib/calendar/rotation';
import { listBlocks, type BlockWithPlantings, type PlantingRecord } from '$lib/db/blocks';
import { listCrops, type Crop } from '$lib/db/crops';
import { harvestTargetKey } from '$lib/plan/harvestTargetKey';
import { frostDatesForYear } from '$lib/schedule/settings';
import { getSetting } from '$lib/db/settings';
import {
  SETTINGS_KEYS,
  DEFAULT_SHOW_SHADE_MARKERS,
  parseBoolSetting
} from '$lib/schedule/constants';
import { LOUDOUN_VA, soilTempEarliestDayMs } from '$lib/weather/normals';
import {
  listCropEquipment,
  CROP_EQUIPMENT_ROLES,
  type CropEquipmentBinding,
  type CropEquipmentRole
} from '$lib/db/cropEquipment';
import { listEquipment, type EquipmentWithState } from '$lib/db/equipment';
import { listFields, type FieldWithBlocks } from '$lib/db/fields';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listStockItems, type StockItemWithBalance } from '$lib/db/stock';
import { listTasks, type Task } from '$lib/db/tasks';
import type { CropPlugin, StageSystem, CornType } from '$lib/plugins/schemas';
import {
  resolveGrowthStageTable,
  resolvePerennialTemplate
} from '$lib/plugins/growthStageTemplates';
import {
  projectStages,
  projectHarvestTargets,
  projectPerennialStages,
  projectPerennialHarvestTargets,
  currentStage as currentStageOf
} from '$lib/calendar/stageProjection';
import { getRegistry } from '$lib/server/registry';
import { suggestCompanions, type CompanionSuggestion } from '$lib/calendar/companions';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';

export type PlanTab = 'overview' | 'layout' | 'crops' | 'schedule' | 'calendar';
const TAB_VALUES: PlanTab[] = ['overview', 'layout', 'crops', 'schedule', 'calendar'];

/** Phase 21b follow-up — Calendar tab supports a view toggle so the
 *  swim-lane and the month-grid live behind one entry point. The
 *  Schedule tab now shares the swim-lane renderer (legacy URLs still
 *  work; the visible tab strip drops the standalone Schedule entry). */
export type PlanView = 'swimlane' | 'grid';
const VIEW_VALUES: PlanView[] = ['swimlane', 'grid'];

// harvestTargetKey moved to `$lib/plan/harvestTargetKey.ts` so it can
// be exported from a non-route module — SvelteKit only allows
// `load` / `actions` / `prerender` / etc. as named exports here.

export interface ScheduleCatalogItem {
  pluginId: string;
  displayName: string;
  cropFamily: string;
  daysToMaturity?: { min: number; max: number };
  preHarvestIntervalDays?: number;
  soilTempMinF?: number;
  seasonalTasks?: CropPlugin['seasonalTasks'];
  orchardSeasonalTasks?: CropPlugin['orchardSeasonalTasks'];
  cornType?: CornType;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DayCell {
  iso: string;
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}

export interface CropEquipmentForPlan {
  crop: Crop;
  blockName: string;
  fieldName: string;
  bindings: CropEquipmentBinding[];
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const tabParam = url.searchParams.get('tab') ?? 'overview';
  const tab: PlanTab = (TAB_VALUES as string[]).includes(tabParam)
    ? (tabParam as PlanTab)
    : 'overview';

  // Calendar tab view discriminator. Default = swimlane (because the
  // schedule swim-lane has more interactive features and is the better
  // default for "what's planted where, when"); ?view=grid switches to
  // the month-grid view. Other tabs ignore the param.
  const viewParam = url.searchParams.get('view');
  const view: PlanView =
    viewParam && (VIEW_VALUES as string[]).includes(viewParam)
      ? (viewParam as PlanView)
      : 'swimlane';

  const blocks = listBlocks();
  const fields = listFields();
  const isFirstRun = blocks.length === 0 && fields.length === 0;
  const canEdit = locals.user?.role === 'owner';

  // Common (Overview / Crops / Equipment / Stock all need crop catalog).
  const registry = await getRegistry();
  const cropCatalog = registry
    .all()
    .filter((r) => r.plugin.type === 'crop')
    .map((r) => {
      const c = r.plugin as CropPlugin;
      return {
        pluginId: c.pluginId,
        displayName: c.displayName,
        cropFamily: c.cropFamily,
        daysToMaturity: c.daysToMaturity
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Per-variety planting guide (FR-13) — used by Crops tab.
  const plantingGuides: Record<string, NonNullable<CropPlugin['plantingGuide']>> = {};
  for (const r of registry.all()) {
    if (r.plugin.type !== 'crop') continue;
    const c = r.plugin as CropPlugin;
    if (c.plantingGuide) plantingGuides[c.pluginId] = c.plantingGuide;
  }

  const fieldsByBlockId = blockToFieldMap(blocks, fields);

  const currentYear = new Date().getFullYear();
  const frostDates = frostDatesForYear(currentYear);
  const seasonSetup = loadSeasonSetup(currentYear);
  const lastYearSetup = loadSeasonSetup(currentYear - 1);

  const base = {
    tab,
    blocks,
    fields,
    isFirstRun,
    canEdit,
    cropCatalog,
    plantingGuides,
    showFieldControls: fields.length > 1,
    frostDates,
    currentYear,
    seasonSetup,
    lastYearSetup,
    // Issue #48 follow-up: shadeSources must be visible on every tab that
    // renders <BlockMap> (today: layout + crops). Pushing it into base
    // closes that recurring class of bug — PR #49 fixed the UI side but
    // missed that the Crops-tab loader branch wasn't returning the field.
    shadeSources: listShadeSources(),
    // Phase 21b follow-up — surface to template so the Calendar tab can
    // toggle swim-lane vs grid. Ignored by other tabs.
    view
  };

  if (tab === 'overview') {
    return base;
  }

  if (tab === 'layout') {
    return base;
  }

  if (tab === 'crops') {
    // Phase 14c: Seed Stock rail moved here from Schedule. Drag a seed
    // entry onto a block row to create a planned-status crop on that block.
    const allSeedStock = listStockItems().filter((s) => s.category === 'seed');
    const seedStock = allSeedStock.map((s) => {
      const plug = s.pluginId ? registry.get(s.pluginId)?.plugin : undefined;
      const cropFamily = plug && plug.type === 'crop' ? (plug as CropPlugin).cropFamily : null;
      return {
        stockItemId: s.id,
        displayName: s.displayName,
        shortName: s.shortName,
        onHand: s.onHand,
        defaultUnit: s.defaultUnit,
        cropPluginId: s.pluginId ?? null,
        cropFamily
      };
    });

    // Phase 15d — lookup so each crop pill can render shortName when the
    // matching stock item has one. Crops are bound by `varietyDisplayName`
    // copied from the stock item at planting time.
    const seedShortNameByDisplay: Record<string, string> = {};
    for (const s of allSeedStock) {
      if (s.shortName) seedShortNameByDisplay[s.displayName] = s.shortName;
    }

    return {
      ...base,
      seedStock,
      seedShortNameByDisplay,
      cropsList: listCrops().map((c) => ({
        ...c,
        blockName: blockName(blocks, c.blockId),
        fieldName: fieldName(fieldsByBlockId, c.blockId, fields)
      }))
    };
  }

  // The swim-lane payload is shared between `tab=schedule` (legacy URL) and
  // `tab=calendar&view=swimlane` (new toggle inside the Calendar tab).
  if (tab === 'schedule' || (tab === 'calendar' && view === 'swimlane')) {
    // Phase 14 swim-lane payload — replaces the prior single-row season
    // timeline. Returns blocks ordered E→W, planting bars, shade markers,
    // conflict pairs, the "to schedule" tray, and snap boundaries.

    const yearParam = url.searchParams.get('year');
    const year =
      yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : new Date().getFullYear();

    const scheduleCatalog: ScheduleCatalogItem[] = registry
      .all()
      .filter((r) => r.plugin.type === 'crop')
      .map((r) => {
        const c = r.plugin as CropPlugin;
        return {
          pluginId: c.pluginId,
          displayName: c.displayName,
          cropFamily: c.cropFamily,
          daysToMaturity: c.daysToMaturity,
          preHarvestIntervalDays: c.preHarvestIntervalDays,
          soilTempMinF: c.plantingGuide?.soilTempMinF,
          seasonalTasks: c.seasonalTasks,
          orchardSeasonalTasks: c.orchardSeasonalTasks,
          cornType: c.cornType
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Sort blocks by (E, N, name).
    const swimBlocks = [...blocks].sort((a, b) => {
      const ae = a.eastWestIndex ?? Number.POSITIVE_INFINITY;
      const be = b.eastWestIndex ?? Number.POSITIVE_INFINITY;
      if (ae !== be) return ae - be;
      const an = a.northSouthIndex ?? Number.POSITIVE_INFINITY;
      const bn = b.northSouthIndex ?? Number.POSITIVE_INFINITY;
      if (an !== bn) return an - bn;
      return a.name.localeCompare(b.name);
    });

    const blockAxes: BlockAxes[] = swimBlocks.map((b) => ({
      blockId: b.id,
      eastWestIndex: b.eastWestIndex ?? null,
      northSouthIndex: b.northSouthIndex ?? null
    }));

    // Plantings → bars with computed end-ms; group by block for overlap.
    interface StageBadgeData {
      code: string;
      name: string;
      bodyKind?: 'vegetative' | 'reproductive' | 'ripening' | 'dormant' | 'transition';
      inspect?: string;
      daysIntoStage: number;
    }
    interface NextStageData {
      code: string;
      name: string;
      daysToStart: number;
    }
    interface HarvestTargetWindow {
      stageCode: string;
      label: string;
      useCase?: string;
      startMs: number;
      endMs: number;
    }
    interface SwimPlanting {
      cropId: string;
      blockId: string;
      cropPluginId: string;
      varietyDisplayName: string;
      /** Phase 15d — Haiku-generated short label for the matching stock item. */
      shortName?: string;
      /** Phase 15d — id of the stock item whose displayName matches this
       *  planting's varietyDisplayName, when one exists. The bar editor uses
       *  it to PATCH the stock row's shortName from the Schedule UI. */
      stockItemId?: string;
      cropFamily: string;
      plantingDateMs: number;
      endMs: number;
      shadeCasting: boolean;
      matureHeightFt?: number;
      // Phase 15 — group membership.
      groupId?: string;
      groupRole?: 'anchor' | 'companion';
      groupSystemKind?: 'three-sisters' | 'succession' | 'manual';
      // v1.3 — growth-stage projection (Phase 14 §growth-stages).
      stageSystem?: StageSystem;
      currentStage?: StageBadgeData;
      nextStage?: NextStageData;
      harvestTargets?: HarvestTargetWindow[];
      cornType?: CornType;
      /** Phase 21b follow-up — operator's chosen subset of harvest
       *  use cases. Null = show all (default). */
      harvestUseCases?: string[] | null;
      /** Plugin-declared harvest target options for this crop. Each
       *  entry carries a stable `key` (the canonical useCase enum
       *  value, or a slugified label when the plugin author didn't
       *  tag one) plus the display `label`. Drives the checkbox list
       *  in the edit modal so plugins that ship labels without
       *  useCase tags (e.g. "Sweet" / "Dent" on dual-purpose corn)
       *  still get a working picker. */
      availableHarvestUseCases?: Array<{ key: string; label: string }>;
      /** Phase 21b follow-up — quantity planted + unit on the crop row,
       *  surfaced so the edit modal can pre-populate its Quantity /
       *  Unit fields instead of showing empty "unchanged" placeholders. */
      quantityPlanted?: number;
      quantityUnit?: string;
    }
    const swimPlantings: SwimPlanting[] = [];
    // listCrops gives us the group fields; index by cropId so we can decorate
    // the swim payload (blocks.ts plantings don't carry group metadata).
    const cropById = new Map(listCrops().map((c) => [c.id, c]));
    // Phase 15d — pull short names + stock id off stock items so swim bars
    // can render the terse label and the bar editor can PATCH back to the
    // stock row. Match by displayName since crops.varietyDisplayName is
    // copied from the stock item at planting time.
    const shortNameByDisplay = new Map<string, string>();
    const stockIdByDisplay = new Map<string, string>();
    for (const s of listStockItems()) {
      if (s.shortName) shortNameByDisplay.set(s.displayName, s.shortName);
      stockIdByDisplay.set(s.displayName, s.id);
    }
    const nowMs = Date.now();
    for (const b of swimBlocks) {
      for (const p of b.plantings) {
        if (p.plantingDate == null) continue;
        const rec = registry.get(p.cropPluginId);
        if (!rec || rec.plugin.type !== 'crop') continue;
        const plug = rec.plugin as CropPlugin;
        const cropMeta = cropById.get(p.id);

        // v1.3 — stage projection. Day-from-planting families project against
        // plantingDate; perennials project against the current calendar year.
        let stageSystem: StageSystem | undefined;
        let currentStage: SwimPlanting['currentStage'];
        let nextStage: SwimPlanting['nextStage'];
        let harvestTargets: SwimPlanting['harvestTargets'];

        const stageTable = resolveGrowthStageTable(plug);
        const perennial = resolvePerennialTemplate(plug);
        if (stageTable) {
          stageSystem = stageTable.system;
          const projected = projectStages(p.plantingDate, stageTable, plug.daysToMaturity);
          const cur = currentStageOf(projected, nowMs);
          if (cur.current) {
            currentStage = {
              code: cur.current.code,
              name: cur.current.name,
              bodyKind: cur.current.bodyKind,
              inspect: cur.current.inspect,
              daysIntoStage: cur.daysIntoCurrent ?? 0
            };
          }
          if (cur.next) {
            nextStage = {
              code: cur.next.code,
              name: cur.next.name,
              daysToStart: cur.daysToNext ?? 0
            };
          }
          harvestTargets = projectHarvestTargets(projected, stageTable);
          // Phase 21b follow-up — operator-selected harvest windows.
          // Filter the plugin's projected harvest targets so the
          // swim-lane bar only renders the windows the operator
          // picked. The filter matches against a stable key per
          // target — useCase when the plugin author tagged one,
          // otherwise a slugified version of the label so plugins
          // that haven't been backfilled (e.g. "Sweet" / "Dent" on
          // dual-purpose corn) still work end-to-end. Filter null /
          // empty = surface everything.
          if (cropMeta?.harvestUseCases && cropMeta.harvestUseCases.length > 0 && harvestTargets) {
            const allowed = new Set(cropMeta.harvestUseCases);
            harvestTargets = harvestTargets.filter((t) =>
              allowed.has(harvestTargetKey(t.useCase, t.label))
            );
          }
        } else if (perennial) {
          stageSystem = 'perennial-calendar';
          const year = new Date(nowMs).getFullYear();
          const projected = projectPerennialStages(perennial, year);
          const cur = currentStageOf(projected, nowMs);
          if (cur.current) {
            currentStage = {
              code: cur.current.code,
              name: cur.current.name,
              bodyKind: cur.current.bodyKind,
              inspect: cur.current.inspect,
              daysIntoStage: cur.daysIntoCurrent ?? 0
            };
          }
          if (cur.next) {
            nextStage = {
              code: cur.next.code,
              name: cur.next.name,
              daysToStart: cur.daysToNext ?? 0
            };
          }
          harvestTargets = projectPerennialHarvestTargets(perennial, projected);
        }

        swimPlantings.push({
          cropId: p.id,
          blockId: b.id,
          cropPluginId: p.cropPluginId,
          varietyDisplayName: p.varietyDisplayName,
          shortName: shortNameByDisplay.get(p.varietyDisplayName),
          stockItemId: stockIdByDisplay.get(p.varietyDisplayName),
          cropFamily: plug.cropFamily,
          plantingDateMs: p.plantingDate,
          endMs: plantingBarEndMs(p.plantingDate, plug),
          shadeCasting:
            typeof plug.shadeCasting === 'boolean'
              ? plug.shadeCasting
              : (plug.matureHeightFt ?? 0) >= 5 || plug.cropFamily === 'corn',
          matureHeightFt: plug.matureHeightFt,
          groupId: cropMeta?.groupId,
          groupRole: cropMeta?.groupRole,
          groupSystemKind: cropMeta?.groupSystemKind,
          stageSystem,
          currentStage,
          nextStage,
          harvestTargets,
          cornType: plug.cornType,
          // Surface so the edit modal can pre-populate its harvest-use-case
          // checkbox list.
          harvestUseCases: cropMeta?.harvestUseCases ?? null,
          // Quantity + unit so the edit modal pre-fills instead of showing
          // "(unchanged)" placeholders. The unit is locked at the planting
          // record; the edit modal is read-only on this field.
          quantityPlanted: cropMeta?.quantityPlanted,
          quantityUnit: cropMeta?.quantityUnit,
          // Surface every harvest target as a (key, label) pair the modal
          // renders as a checkbox. Pulled from the SAME source the swim-
          // lane render uses — `stageTable` is `resolveGrowthStageTable(plug)`
          // (already in scope from the projection above), which falls back
          // to the corn / brassica / etc. family-default table when the
          // plugin doesn't declare its own. Reading `plug.growthStageTable`
          // directly silently returned [] for plugins like Oxacana corn
          // that ship without a custom stage table but still get harvest
          // bands via the family default.
          availableHarvestUseCases: (() => {
            const out: Array<{ key: string; label: string }> = [];
            const seen = new Set<string>();
            for (const t of stageTable?.harvestTargets ?? []) {
              const key = harvestTargetKey(t.useCase, t.label);
              if (!key || seen.has(key)) continue;
              seen.add(key);
              out.push({ key, label: t.label });
            }
            return out;
          })()
        });
      }
    }

    // "To schedule" tray = planned crops with null plantingDate. Seed-stock
    // gating moved to the Crops tab (Phase 14c) — the tray here lists every
    // unscheduled crop the operator can drag onto the swim-lane.
    const unscheduled = listCrops({ status: 'planned' })
      .filter((c) => c.plantingDate == null)
      .map((c) => ({
        cropId: c.id,
        blockId: c.blockId,
        cropPluginId: c.cropPluginId,
        varietyDisplayName: c.varietyDisplayName
      }));

    // Shade markers — v2 model. One batch call, projects shadow from every
    // shade-casting crop AND every external shade source (tree rows,
    // hedges, buildings) onto every block, using solar geometry + density +
    // canopy + slope. Gated by user setting (default on).
    const showShadeMarkers = parseBoolSetting(
      getSetting(SETTINGS_KEYS.showShadeMarkers),
      DEFAULT_SHOW_SHADE_MARKERS
    );
    let shadeMarkers: ShadeImpactEvent[] = [];
    const blockById = new Map(swimBlocks.map((b) => [b.id, b]));
    if (showShadeMarkers) {
      const farmLatLon = getFarmLatLon();
      const externalShadeSources = listShadeSources();
      const shadeInputs: Array<{
        planting: PlantingRecord;
        crop: CropPlugin;
        block: BlockWithPlantings;
      }> = [];
      for (const sp of swimPlantings) {
        if (!sp.shadeCasting) continue;
        const block = blockById.get(sp.blockId);
        const planting = block?.plantings.find((p) => p.id === sp.cropId);
        if (!block || !planting) continue;
        const plug = registry.get(sp.cropPluginId)?.plugin as CropPlugin | undefined;
        if (!plug) continue;
        shadeInputs.push({ planting, crop: plug, block });
      }
      const yearStartMs = new Date(year, 0, 1).getTime();
      const yearEndMs = new Date(year + 1, 0, 1).getTime() - 1;
      shadeMarkers = computeShadeWindowEvents({
        plantings: shadeInputs,
        shadeSources: externalShadeSources,
        blocks: swimBlocks,
        farmLat: farmLatLon.lat,
        farmLon: farmLatLon.lon,
        fromMs: yearStartMs,
        toMs: yearEndMs
      });
    }

    // Same-time overlap per block.
    const overlaps: SameTimeOverlap[] = [];
    const barsByBlock = new Map<string, BlockBar[]>();
    for (const sp of swimPlantings) {
      const list = barsByBlock.get(sp.blockId) ?? [];
      list.push({ cropId: sp.cropId, startMs: sp.plantingDateMs, endMs: sp.endMs });
      barsByBlock.set(sp.blockId, list);
    }
    for (const [blockId, bars] of barsByBlock) {
      overlaps.push(...sameTimeOverlap(blockId, bars));
    }

    // Rotation conflicts per (blockId × candidate planting).
    const rotations: RotationConflict[] = [];
    const historyByBlock = new Map<string, PriorCrop[]>();
    for (const sp of swimPlantings) {
      const list = historyByBlock.get(sp.blockId) ?? [];
      list.push({
        cropId: sp.cropId,
        pluginId: sp.cropPluginId,
        family: sp.cropFamily,
        plantingDate: sp.plantingDateMs
      });
      historyByBlock.set(sp.blockId, list);
    }
    for (const sp of swimPlantings) {
      const history = historyByBlock.get(sp.blockId) ?? [];
      rotations.push(
        ...rotationConflicts(
          sp.blockId,
          {
            cropId: sp.cropId,
            pluginId: sp.cropPluginId,
            family: sp.cropFamily,
            plantingDate: sp.plantingDateMs
          },
          history
        )
      );
    }

    const { lastSpringFrostMs, firstFallFrostMs } = frostDatesForYear(year);
    const soilTempEarliestByCrop: Record<string, number | null> = {};
    for (const r of registry.all()) {
      if (r.plugin.type !== 'crop') continue;
      const c = r.plugin as CropPlugin;
      const minF = c.plantingGuide?.soilTempMinF;
      if (minF == null) continue;
      soilTempEarliestByCrop[c.pluginId] = soilTempEarliestDayMs(minF, year, LOUDOUN_VA);
    }

    // Phase 15 — companion suggestions per anchor family. Pure registry
    // lookup; UI further gates by stock + block-attachment before showing.
    const allCropPlugins = registry
      .all()
      .filter((r) => r.plugin.type === 'crop')
      .map((r) => r.plugin as CropPlugin);
    const companionSuggestions: Record<string, CompanionSuggestion[]> = {};
    const seenFamilies = new Set<string>();
    for (const sp of swimPlantings) seenFamilies.add(sp.cropFamily);
    for (const family of seenFamilies) {
      const suggestions = suggestCompanions(family as CropFamily, allCropPlugins);
      if (suggestions.length > 0) companionSuggestions[family] = [...suggestions];
    }

    // Phase 15 — task pips for the swim-lane. One row per materialized task,
    // categorized by title heuristic (plugins set free-form titles today).
    type SwimTaskPip = {
      cropId: string;
      scheduledForMs: number;
      category: 'plant' | 'till' | 'fertilize' | 'spray' | 'scout' | 'companion-check' | 'other';
      title: string;
      stale?: boolean;
    };
    function categorize(title: string, key?: string): SwimTaskPip['category'] {
      const t = (title + ' ' + (key ?? '')).toLowerCase();
      if (t.includes('companion-check')) return 'companion-check';
      if (t.startsWith('plant ') || t.includes(':plant')) return 'plant';
      if (t.includes('till')) return 'till';
      if (t.includes('fert') || t.includes('side-dress')) return 'fertilize';
      if (t.includes('spray') || t.includes('herbicide') || t.includes('insecticide'))
        return 'spray';
      if (t.includes('scout') || t.includes('inspect')) return 'scout';
      return 'other';
    }
    const taskPips: SwimTaskPip[] = [];
    const allTasks = listTasks({ status: 'open' });
    for (const t of allTasks) {
      if (!t.cropId) continue;
      taskPips.push({
        cropId: t.cropId,
        scheduledForMs: t.scheduledFor,
        category: categorize(t.title, t.pluginTemplateKey),
        title: t.title,
        stale: t.staleAnchor || undefined
      });
    }

    // Phase 15 — wizard input pool: blocks-with-attached-crops including
    // their cropFamily. The wizard uses this to gate companion surfacing
    // (must already be attached to the same block).
    type WizardBlock = {
      id: string;
      name: string;
      blockLabel?: string | null;
      sunExposure?: 'full' | 'partial' | 'shade' | null;
      plantings: Array<{
        cropId: string;
        cropPluginId: string;
        varietyDisplayName: string;
        cropFamily: string;
        plantingDate: number | null;
      }>;
    };
    const wizardBlocks: WizardBlock[] = swimBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      blockLabel: b.blockLabel,
      sunExposure: b.sunExposure ?? null,
      plantings: b.plantings
        .map((p) => {
          const rec = registry.get(p.cropPluginId);
          if (!rec || rec.plugin.type !== 'crop') return null;
          return {
            cropId: p.id,
            cropPluginId: p.cropPluginId,
            varietyDisplayName: p.varietyDisplayName,
            cropFamily: (rec.plugin as CropPlugin).cropFamily,
            plantingDate: p.plantingDate
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
    }));

    // Phase 15 — seed-stock cards for the wizard's gate (family + on-hand).
    const seedStockForWizard = listStockItems()
      .filter((s) => s.category === 'seed' && s.onHand > 0)
      .map((s) => ({
        stockItemId: s.id,
        cropPluginId: s.pluginId ?? null,
        cropFamily: s.pluginId
          ? ((registry.get(s.pluginId)?.plugin as CropPlugin | undefined)?.cropFamily ?? null)
          : null,
        displayName: s.displayName,
        onHand: s.onHand,
        defaultUnit: s.defaultUnit
      }));

    return {
      ...base,
      scheduleCatalog,
      swimBlocks: swimBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        blockLabel: b.blockLabel,
        acres: b.acres,
        eastWestIndex: b.eastWestIndex ?? null,
        northSouthIndex: b.northSouthIndex ?? null,
        sunExposure: b.sunExposure ?? null
      })),
      swimPlantings,
      unscheduled,
      shadeMarkers,
      conflicts: { sameTime: overlaps, rotation: rotations },
      snapBoundaries: {
        lastSpringFrostMs,
        firstFallFrostMs,
        soilTempEarliestByCrop
      },
      // Phase 15 additions.
      taskPips,
      companionSuggestions,
      wizardBlocks,
      seedStockForWizard,
      year
    };
  }

  // Equipment-binding tab removed from /plan (2026-05-17). Equipment
  // management lives at /equipment in the top nav; per-crop bindings stay
  // accessible on the crop detail page (/crops/[id]).

  // The month-grid payload only runs for the explicit grid view of the
  // Calendar tab; the swim-lane branch above already handles the default.
  if (tab === 'calendar' && view === 'grid') {
    // Aggregate every event from every planting + every recorded harvest.
    const allEvents: CalendarEvent[] = [];
    for (const b of blocks) {
      for (const p of b.plantings) {
        const rec = registry.get(p.cropPluginId);
        if (!rec || rec.plugin.type !== 'crop') continue;
        allEvents.push(
          ...eventsForPlanting(p, rec.plugin as CropPlugin, { blockPlantings: b.plantings })
        );
      }
    }
    const harvests = listHarvestEvents();
    for (const h of harvests) {
      const rec = registry.get(h.cropPluginId);
      if (!rec || rec.plugin.type !== 'crop') continue;
      allEvents.push(...eventsForHarvest(h, rec.plugin as CropPlugin));
    }

    // Filter chips: ?fieldId= / ?blockId=
    const filterFieldId = url.searchParams.get('fieldId') ?? '';
    const filterBlockId = url.searchParams.get('blockId') ?? '';
    const inField = (event: CalendarEvent): boolean => {
      if (!filterFieldId) return true;
      const blockId = event.blockId;
      if (!blockId) return false;
      const fId = fieldsByBlockId.get(blockId);
      return fId === filterFieldId;
    };
    const inBlock = (event: CalendarEvent): boolean =>
      !filterBlockId || event.blockId === filterBlockId;
    const filteredEvents = allEvents.filter((e) => inField(e) && inBlock(e));

    // Determine month: ?ym=YYYY-MM, default current.
    const today = new Date();
    const ym = url.searchParams.get('ym');
    let year = today.getFullYear();
    let month = today.getMonth();
    if (ym) {
      const m = ym.match(/^(\d{4})-(\d{2})$/);
      if (m) {
        year = parseInt(m[1], 10);
        month = parseInt(m[2], 10) - 1;
      }
    }
    const firstOfMonth = new Date(year, month, 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
    const todayIso = today.toISOString().slice(0, 10);
    const grid: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getTime() + i * DAY_MS);
      const iso = d.toISOString().slice(0, 10);
      const dayStart = d.getTime();
      const dayEnd = dayStart + DAY_MS - 1;
      const eventsThisDay = filteredEvents
        .filter((e) => e.endMs >= dayStart && e.startMs <= dayEnd)
        .sort((a, b) => a.startMs - b.startMs);
      grid.push({
        iso,
        inMonth: d.getMonth() === month,
        isToday: iso === todayIso,
        events: eventsThisDay
      });
    }
    const prev = new Date(year, month - 1, 1);
    const next = new Date(year, month + 1, 1);
    const fmtYM = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    return {
      ...base,
      calendarGrid: grid,
      monthLabel: firstOfMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      prev: fmtYM(prev),
      next: fmtYM(next),
      eventCountTotal: filteredEvents.length,
      filterFieldId,
      filterBlockId
    };
  }

  return base;
};

function blockToFieldMap(
  blocks: BlockWithPlantings[],
  _fields: FieldWithBlocks[]
): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>();
  for (const b of blocks) m.set(b.id, b.fieldId);
  return m;
}

function blockName(blocks: BlockWithPlantings[], blockId: string): string {
  return blocks.find((b) => b.id === blockId)?.name ?? '—';
}

function fieldName(
  byBlock: Map<string, string | undefined>,
  blockId: string,
  fields: FieldWithBlocks[]
): string {
  const fId = byBlock.get(blockId);
  if (!fId) return '—';
  return fields.find((f) => f.id === fId)?.name ?? '—';
}

// Re-exported types for the +page.svelte. (Avoids importing across .svelte/.ts.)
export type {
  EquipmentWithState,
  StockItemWithBalance,
  CropEquipmentBinding,
  CropEquipmentRole,
  Task
};
