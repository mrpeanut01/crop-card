/**
 * Phase 30F: assembles the offline Card bundle (`FarmSnapshot`) for the
 * active Owner. Every read goes through a tenant-scoped repo; the crop and
 * pesticide plugins come from the Owner's registry view.
 */

import { listOpenSeedStarts } from '$lib/db/seedStarts';
import { createHash } from 'node:crypto';
import {
  FARM_SNAPSHOT_VERSION,
  type FarmSnapshot,
  type SnapshotAnimal,
  type SnapshotAnimalGroup,
  type SnapshotAnimalHold,
  type SnapshotArea,
  type SnapshotAreaHold,
  type SnapshotBlock,
  type SnapshotHoldStatus,
  type SnapshotSpecies,
  type SnapshotCareTask,
  type SnapshotCropPlugin,
  type SnapshotEquipment,
  type SnapshotPlanting,
  type SnapshotSoilTest,
  type SnapshotSprayProduct,
  type SnapshotStockItem
} from '$lib/cards/snapshot';
import { farmZone } from '$lib/climate/zoneSettings.server';
import { snapshotFrostFromSettings } from '$lib/climate/frostSettings.server';
import { loadEmergencyContacts } from '$lib/farm/emergencyContacts.server';
import { listAreas } from '$lib/db/areas';
import { listBlocks } from '$lib/db/blocks';
import {
  activeOwnerName,
  listCarePlansForCards,
  listOpenTasksForCards,
  listPlantingsForCards,
  listTreatmentsForCards
} from '$lib/db/cardSnapshot';
import { hasAnyAnimalRecord, listAnimals, type Animal } from '$lib/db/animals';
import { listAnimalGroups, type AnimalGroupSummary } from '$lib/db/animalGroups';
import { farmTimeZone } from '$lib/db/userProfile';
import { loadAnimalsProfile } from '$lib/animals/profile.server';
import { splitHoldMapKey, type HoldProjection, type Span } from '$lib/safety/holdLedger';
import { projectActiveFarm } from './holdGuard';
import { listEquipment } from '$lib/db/equipment';
import { listSoilTests, type SoilTest } from '$lib/db/fertility';
import { listStockItems } from '$lib/db/stock';
import { dbChangeMarker } from '$lib/db/requestMemo';
import { requireOwnerId } from '$lib/db/tenant';
import type { CropPlugin, Plugin } from '$lib/plugins/schemas';
import { pollinatorDataFor } from '$lib/safety/pollinatorProtection';
import { buildTankMixSteps } from '$lib/safety/tankMixOrder';
import { RULES_VERSION } from '$lib/safety/version';
import { eventsForPlanting } from '$lib/calendar/engine';
import { getDataKinds, getRegistry } from './registry';
import { sprayTermsFor } from './sprayTerms';
import { listMapFeatureViews } from '$lib/db/mapFeatures';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const SNAPSHOT_TASK_PAST_DAYS = 14;
export const SNAPSHOT_TASK_FUTURE_DAYS = 30;

const PESTICIDE_TYPES = new Set(['herbicide', 'insecticide', 'fungicide']);

function positive(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function toArea(a: ReturnType<typeof listAreas>[number]): SnapshotArea {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    acres: a.acres ?? null,
    widthFt: a.widthFt ?? null,
    lengthFt: a.lengthFt ?? null,
    perimeterFt: a.perimeterFt ?? null,
    acresSource: a.acresSource ?? null,
    notes: a.notes ?? null
  };
}

function toBlock(b: ReturnType<typeof listBlocks>[number]): SnapshotBlock {
  const hasLayout =
    b.xFt !== undefined ||
    b.yFt !== undefined ||
    b.rotationDeg !== undefined ||
    b.bedStyle !== undefined;
  return {
    id: b.id,
    areaId: b.fieldId ?? null,
    name: b.name,
    blockLabel: b.blockLabel ?? null,
    kind: b.kind ?? 'block',
    acres: b.acres ?? null,
    widthFt: b.widthFt ?? null,
    lengthFt: b.lengthFt ?? null,
    layout: hasLayout
      ? {
          xFt: b.xFt ?? null,
          yFt: b.yFt ?? null,
          rotationDeg: b.rotationDeg ?? null,
          bedStyle: b.bedStyle ?? null
        }
      : null
  };
}

function toEquipment(e: ReturnType<typeof listEquipment>[number]): SnapshotEquipment {
  const s = e.state;
  return {
    id: e.id,
    type: e.type,
    label: e.label,
    tankGal: positive(e.spec?.tankGal),
    state: {
      calibratedGpa: s.calibratedGpa ?? null,
      calibrationDate: s.calibrationDate ?? null,
      lastDeconAt: s.lastDeconAt ?? null,
      lastUsedAt: s.lastUsedAt ?? null,
      lastChemistryClass: s.lastChemistryClass ?? null,
      winterizedAt: s.winterizedAt ?? null
    }
  };
}

function toStock(i: ReturnType<typeof listStockItems>[number]): SnapshotStockItem {
  return {
    id: i.id,
    pluginId: i.pluginId ?? null,
    category: i.category,
    displayName: i.displayName,
    unit: i.defaultUnit,
    onHand: i.onHand,
    reorderThreshold: i.reorderThreshold ?? null,
    earliestExpiry: i.earliestExpiry ? new Date(i.earliestExpiry).toISOString().slice(0, 10) : null
  };
}

/** Newest test per block; `tests` arrive newest first. */
export function latestSoilTestsPerBlock(tests: readonly SoilTest[]): SnapshotSoilTest[] {
  const seen = new Set<string>();
  const out: SnapshotSoilTest[] = [];
  for (const t of tests) {
    if (seen.has(t.blockId)) continue;
    seen.add(t.blockId);
    out.push({
      id: t.id,
      blockId: t.blockId,
      sampledAt: t.sampledAt,
      lab: t.lab ?? null,
      ph: t.ph ?? null,
      bufferPh: t.bufferPh ?? null,
      organicMatterPct: t.organicMatterPct ?? null,
      cec: t.cec ?? null,
      nitratePpm: t.nitratePpm ?? null,
      phosphorusPpm: t.phosphorusPpm ?? null,
      potassiumPpm: t.potassiumPpm ?? null,
      caPpm: t.caPpm ?? null,
      mgPpm: t.mgPpm ?? null,
      extractionMethod: t.extractionMethod ?? null,
      unitsBasis: t.unitsBasis ?? null,
      labRatings: t.labRatings ?? null
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const CARE_TASK_KINDS: ReadonlySet<string> = new Set(['pruning', 'thinning']);

export function careTasksOf(p: CropPlugin): SnapshotCareTask[] {
  const out: SnapshotCareTask[] = [];
  for (const t of p.seasonalTasks ?? []) {
    if (t.kind === 'spray' || t.category === 'spray') continue;
    if (!CARE_TASK_KINDS.has(t.kind) && t.category !== 'prune') continue;
    out.push(t.body ? { title: t.title, body: t.body } : { title: t.title });
  }
  for (const t of p.orchardSeasonalTasks ?? []) {
    if (t.category !== 'prune') continue;
    out.push(t.body ? { title: t.title, body: t.body } : { title: t.title });
  }
  return out;
}

export function toCropPlugin(p: Plugin): SnapshotCropPlugin | null {
  if (p.type !== 'crop') return null;
  const careTasks = careTasksOf(p);
  return {
    pluginId: p.pluginId,
    displayName: p.displayName,
    version: p.version,
    cropFamily: p.cropFamily,
    archetype: p.archetype,
    daysToMaturity: p.daysToMaturity,
    defaultRowSpacingInches: p.defaultRowSpacingInches,
    preHarvestIntervalDays: p.preHarvestIntervalDays,
    plantingGuide: p.plantingGuide
      ? {
          rowSpacingIn: p.plantingGuide.rowSpacingIn,
          inRowSpacingIn: p.plantingGuide.inRowSpacingIn,
          seedDepthIn: p.plantingGuide.seedDepthIn,
          soilTempMinF: p.plantingGuide.soilTempMinF,
          establishment: p.plantingGuide.establishment,
          startIndoorsWeeks: p.plantingGuide.startIndoorsWeeks,
          hardenOffDays: p.plantingGuide.hardenOffDays,
          germinationTempF: p.plantingGuide.germinationTempF,
          dtmFrom: p.plantingGuide.dtmFrom
        }
      : undefined,
    harvestIndicators: p.harvestIndicators,
    notes: p.notes,
    ...(careTasks.length ? { careTasks } : {})
  };
}

export function toSprayProduct(p: Plugin): SnapshotSprayProduct | null {
  if (p.type === 'herbicide') {
    return {
      pluginId: p.pluginId,
      type: 'herbicide',
      displayName: p.displayName,
      version: p.version,
      epaRegistrationNumber: p.epaRegistrationNumber ?? null,
      ratePerAcre: p.ratePerAcre,
      gpaCalibration: p.gpaCalibration ?? null,
      reEntryIntervalHours: null,
      preHarvestIntervalDays: null,
      targets: [],
      loadClasses: [...new Set(p.activeIngredients.map((ai) => ai.chemistryClass))],
      mixSteps: buildTankMixSteps([p]).map((s) => s.instruction),
      rainfastHours: null,
      pollinator: null
    };
  }
  if (p.type === 'insecticide') {
    return {
      pluginId: p.pluginId,
      type: 'insecticide',
      displayName: p.displayName,
      version: p.version,
      epaRegistrationNumber: p.epaRegistrationNumber ?? null,
      ratePerAcre: p.ratePerAcre ?? null,
      gpaCalibration: p.gpaCalibration ?? null,
      reEntryIntervalHours: p.reEntryIntervalHours,
      preHarvestIntervalDays: p.preHarvestIntervalDays ?? null,
      targets: p.targetPests ?? [],
      loadClasses: ['insecticide-load'],
      mixSteps: [],
      rainfastHours: null,
      pollinator: (({ beeToxicity, bloomRestriction }) => ({ beeToxicity, bloomRestriction }))(
        pollinatorDataFor(p)
      )
    };
  }
  if (p.type === 'fungicide') {
    return {
      pluginId: p.pluginId,
      type: 'fungicide',
      displayName: p.displayName,
      version: p.version,
      epaRegistrationNumber: p.epaRegistrationNumber ?? null,
      ratePerAcre: p.ratePerAcre,
      gpaCalibration: p.gpaCalibration ?? null,
      reEntryIntervalHours: p.reEntryIntervalHours,
      preHarvestIntervalDays: p.preHarvestIntervalDays,
      targets: p.targetDiseases ?? [],
      loadClasses: ['fungicide-load'],
      mixSteps: [],
      rainfastHours: p.rainfastHours ?? null,
      pollinator: null
    };
  }
  return null;
}

/** Treatments shown on Animal and Flock Cards (display only, D1-01). */
export const SNAPSHOT_TREATMENT_DAYS = 90;

/**
 * Holds are projected as if every open stay and course ran this far past
 * the snapshot's hour. The projection only ever grows as open facts run
 * longer, so an offline chip reads the same as the server or longer, never
 * shorter, for as long as a clear can be trusted (`HOLD_CONFIRM_MAX_AGE_MS`
 * plus the hour the window is cut at).
 */
export const SNAPSHOT_HOLD_HORIZON_MS = 25 * HOUR_MS;

function toSnapshotAnimal(a: Animal, groups: Map<string, AnimalGroupSummary>): SnapshotAnimal {
  const group = a.groupId ? groups.get(a.groupId) : undefined;
  return {
    id: a.id,
    groupId: a.groupId,
    speciesId: a.speciesId,
    name: a.name,
    tag: a.tag,
    sex: a.sex,
    breed: a.breed,
    birthDate: a.birthDate,
    birthDateEstimated: a.birthDateEstimated,
    purpose: a.purpose,
    foodProducing: a.foodProducing,
    notForSlaughter: a.notForSlaughter,
    housingFieldId: group ? group.housingFieldId : a.housingFieldId,
    microchipId: a.microchipId,
    feedingNote: a.feedingNote
  };
}

function toSnapshotGroup(g: AnimalGroupSummary): SnapshotAnimalGroup {
  return {
    id: g.id,
    name: g.name,
    speciesId: g.speciesId,
    purpose: g.purpose,
    headCount: g.headCount,
    namedCount: g.namedCount,
    total: g.total,
    foodProducing: g.effectiveFoodProducing,
    housingFieldId: g.housingFieldId
  };
}

function statusOf(span: Span): { status: SnapshotHoldStatus; clearMs: number | null } {
  const finite = Number.isFinite(span.toMs);
  if (span.basis === 'prohibited') return { status: 'prohibited', clearMs: null };
  if (span.basis === 'unknown' || !finite) return { status: 'unknown', clearMs: null };
  return { status: 'held', clearMs: span.toMs };
}

const FOOD_OF_KIND: Record<string, SnapshotAnimalHold['food'] | undefined> = {
  meat: 'meat',
  preSlaughter: 'meat',
  milk: 'milk',
  eggs: 'eggs'
};

/** Every hold of the projection that is still open at `openAtMs`: food
 *  holds for the listed subjects, and grazing and haying holds per Area. */
export function snapshotHolds(
  projection: HoldProjection,
  openAtMs: number,
  subjects: ReadonlySet<string>
): { animalHolds: SnapshotAnimalHold[]; areaHolds: SnapshotAreaHold[] } {
  const animalHolds: SnapshotAnimalHold[] = [];
  const areaHolds: SnapshotAreaHold[] = [];
  for (const [mapKey, spans] of projection.holds) {
    const { key, kind } = splitHoldMapKey(mapKey);
    for (const span of spans) {
      if (span.toMs <= openAtMs) continue;
      const { status, clearMs } = statusOf(span);
      if (key.startsWith('area:') && (kind === 'graze' || kind === 'hay')) {
        areaHolds.push({ areaId: key.slice(5), kind, fromMs: span.fromMs, clearMs, status });
        continue;
      }
      const food = FOOD_OF_KIND[kind];
      if (food && subjects.has(key)) {
        animalHolds.push({ subject: key, food, fromMs: span.fromMs, clearMs, status });
      }
    }
  }
  const order = (a: { fromMs: number }, b: { fromMs: number }) => a.fromMs - b.fromMs;
  animalHolds.sort(
    (a, b) => a.subject.localeCompare(b.subject) || a.food.localeCompare(b.food) || order(a, b)
  );
  areaHolds.sort(
    (a, b) => a.areaId.localeCompare(b.areaId) || a.kind.localeCompare(b.kind) || order(a, b)
  );
  return { animalHolds, areaHolds };
}

type AnimalSnapshotPart = Pick<
  FarmSnapshot,
  | 'animals'
  | 'animalGroups'
  | 'species'
  | 'animalsLayout'
  | 'carePlans'
  | 'treatments'
  | 'animalHolds'
  | 'areaHolds'
  | 'holdTimeZone'
  | 'holdsProjectedTo'
>;

/** 32D: animals, flocks, care plans, recent treatments and the kernel's
 *  open holds. A farm that never had an animal pays one existence check. */
export async function animalSnapshotPart(windowNow: number): Promise<AnimalSnapshotPart> {
  if (!hasAnyAnimalRecord()) return {};
  const groupRows = listAnimalGroups();
  const groups = new Map(groupRows.map((g) => [g.id, g]));
  const animalRows = listAnimals();
  const kinds = await getDataKinds();
  const species: Record<string, SnapshotSpecies> = {};
  for (const id of new Set([...groupRows, ...animalRows].map((r) => r.speciesId))) {
    const p = kinds.species.get(id);
    if (!p) continue;
    species[id] = {
      pluginId: p.pluginId,
      displayName: p.displayName,
      label: p.tile.label ?? p.displayName,
      groupNoun: p.groupNoun,
      foodProducingDefault: p.foodProducingDefault,
      products: [...p.products]
    };
  }
  const subjects = new Set([
    ...groupRows.map((g) => `group:${g.id}`),
    ...animalRows.map((a) => `animal:${a.id}`)
  ]);
  const timeZone = farmTimeZone();
  const projectedTo = windowNow + SNAPSHOT_HOLD_HORIZON_MS;
  const { projection } = await projectActiveFarm(timeZone, projectedTo);
  const holds = snapshotHolds(projection, windowNow, subjects);
  return {
    animals: animalRows
      .map((a) => toSnapshotAnimal(a, groups))
      .sort((a, b) => a.id.localeCompare(b.id)),
    animalGroups: groupRows.map(toSnapshotGroup).sort((a, b) => a.id.localeCompare(b.id)),
    species,
    animalsLayout: loadAnimalsProfile().layout,
    carePlans: listCarePlansForCards(),
    treatments: listTreatmentsForCards(windowNow - SNAPSHOT_TREATMENT_DAYS * DAY_MS),
    animalHolds: holds.animalHolds,
    areaHolds: holds.areaHolds,
    holdTimeZone: timeZone,
    holdsProjectedTo: projectedTo
  };
}

export interface BuildSnapshotOptions {
  now?: number;
  origin?: string | null;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The engine's harvest window for a planting, so a Planting Card and /plan
 *  show the same dates. */
export function engineHarvestWindow(
  p: SnapshotPlanting,
  crop: CropPlugin
): { start: string; end: string } | null {
  if (!p.plantingDate) return null;
  const plantingDate = Date.parse(p.plantingDate);
  if (!Number.isFinite(plantingDate)) return null;
  const windows = eventsForPlanting(
    {
      id: p.id,
      blockId: p.blockId,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      plantingDate,
      establishment: p.establishment ?? null,
      sownIndoorsAt: p.sownIndoorsAt ?? null
    },
    crop
  ).filter((e) => e.kind === 'harvest-window');
  if (!windows.length) return null;
  return {
    start: utcDay(Math.min(...windows.map((e) => e.startMs))),
    end: utcDay(Math.max(...windows.map((e) => e.endMs)))
  };
}

/** The time the snapshot's date windows are cut at: `now` rounded down to
 *  the hour, so the content (and its ETag) only moves with the data or on
 *  the hour, and `snapshotStateKey` can name it without building. */
export function snapshotWindowTime(now: number): number {
  return Math.floor(now / HOUR_MS) * HOUR_MS;
}

/** Open trays (not transplanted) on each planting, in one query (E1-18). */
export function attachOpenTrays(plantings: SnapshotPlanting[]): void {
  const byCrop = new Map<string, SnapshotPlanting>(plantings.map((p) => [p.id, p]));
  for (const t of listOpenSeedStarts()) {
    const p = byCrop.get(t.cropId);
    if (!p) continue;
    (p.trays ??= []).push({
      id: t.id,
      trayLabel: t.trayLabel,
      cells: t.cells,
      seedsPerCell: t.seedsPerCell,
      germinatedCount: t.germinatedCount,
      sownAt: t.sownAt
    });
  }
}

export async function buildFarmSnapshot(opts: BuildSnapshotOptions = {}): Promise<FarmSnapshot> {
  const ownerId = requireOwnerId();
  const now = opts.now ?? Date.now();
  const windowNow = snapshotWindowTime(now);
  const registry = await getRegistry();

  const plantings = listPlantingsForCards(windowNow);
  const cropPlugins: Record<string, SnapshotCropPlugin> = {};
  for (const id of new Set(plantings.map((p) => p.cropPluginId))) {
    const rec = registry.get(id);
    const plugin = rec ? toCropPlugin(rec.plugin) : null;
    if (plugin) cropPlugins[id] = plugin;
  }
  for (const p of plantings) {
    const rec = registry.get(p.cropPluginId);
    if (rec?.plugin.type === 'crop') p.harvestWindow = engineHarvestWindow(p, rec.plugin);
  }
  attachOpenTrays(plantings);

  const stockItems = listStockItems();
  const sprayProducts: Record<string, SnapshotSprayProduct> = {};
  for (const item of stockItems) {
    if (!item.pluginId || !PESTICIDE_TYPES.has(item.category)) continue;
    const rec = registry.get(item.pluginId);
    const product = rec ? toSprayProduct(rec.plugin) : null;
    if (product) sprayProducts[product.pluginId] = product;
  }

  return {
    version: FARM_SNAPSHOT_VERSION,
    ownerId,
    farmName: activeOwnerName(),
    generatedAt: now,
    rulesVersion: RULES_VERSION,
    origin: opts.origin ?? null,
    areas: listAreas().map(toArea),
    blocks: listBlocks({ plantings: 'none' })
      .map(toBlock)
      .sort((a, b) => a.id.localeCompare(b.id)),
    plantings,
    tasks: listOpenTasksForCards(
      windowNow - SNAPSHOT_TASK_PAST_DAYS * DAY_MS,
      windowNow + SNAPSHOT_TASK_FUTURE_DAYS * DAY_MS
    ),
    equipment: listEquipment()
      .filter((e) => e.retiredAt === undefined)
      .map(toEquipment)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
    stock: stockItems.map(toStock).sort((a, b) => a.id.localeCompare(b.id)),
    cropPlugins,
    frost: snapshotFrostFromSettings(),
    zone: await farmZone(),
    sprayProducts,
    sprayTerms: sprayTermsFor(registry),
    mapFeatures: listMapFeatureViews(),
    emergencyContacts: loadEmergencyContacts(),
    soilTests: latestSoilTestsPerBlock(listSoilTests()),
    ...(await animalSnapshotPart(windowNow))
  };
}

/** Weak validator over everything but `generatedAt`, so an unchanged farm
 *  answers 304 even though every build stamps a new time. */
export function snapshotEtag(snapshot: FarmSnapshot): string {
  const { generatedAt: _generatedAt, ...rest } = snapshot;
  const digest = createHash('sha256').update(JSON.stringify(rest)).digest('base64url');
  return `W/"${digest.slice(0, 32)}"`;
}

const registryIds = new WeakMap<object, number>();
let nextRegistryId = 1;

function registryIdentity(registry: object): number {
  let id = registryIds.get(registry);
  if (id === undefined) {
    id = nextRegistryId++;
    registryIds.set(registry, id);
  }
  return id;
}

/** Everything a snapshot is a function of, without building it: the Owner,
 *  the database change marker (any row written anywhere, or a commit from
 *  another connection, moves it), the plugin registry instance this Owner
 *  sees, the hour its date windows are cut at, the origin, and the rules
 *  and bundle versions. Equal keys mean an equal snapshot, give or take
 *  `generatedAt`. Read it before building, so a write that lands mid-build
 *  can only make the next key differ. */
export async function snapshotStateKey(opts: {
  now: number;
  origin: string | null;
}): Promise<string> {
  const ownerId = requireOwnerId();
  const registry = await getRegistry();
  return JSON.stringify([
    ownerId,
    dbChangeMarker(),
    registryIdentity(registry),
    snapshotWindowTime(opts.now),
    opts.origin,
    RULES_VERSION,
    FARM_SNAPSHOT_VERSION
  ]);
}

const MAX_KNOWN_ETAGS = 1000;
const knownEtags = new Map<string, { key: string; etag: string }>();

/** The ETag last built for this Owner, if it was built from the same state. */
export function knownSnapshotEtag(key: string): string | null {
  const hit = knownEtags.get(requireOwnerId());
  return hit && hit.key === key ? hit.etag : null;
}

export function rememberSnapshotEtag(key: string, etag: string): void {
  const ownerId = requireOwnerId();
  knownEtags.delete(ownerId);
  knownEtags.set(ownerId, { key, etag });
  if (knownEtags.size > MAX_KNOWN_ETAGS) {
    const oldest = knownEtags.keys().next().value;
    if (oldest !== undefined) knownEtags.delete(oldest);
  }
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  const want = bare(etag);
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || bare(t) === want);
}
