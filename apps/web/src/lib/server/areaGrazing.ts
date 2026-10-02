import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listGrazingAttestations } from '$lib/db/grazingAttestations';
import { listApplicationTombstones } from '$lib/db/admin';
import { listBlocks } from '$lib/db/blocks';
import { listFieldIdsWithStays, listLocationsOnField } from '$lib/db/animalLocations';
import { getField, listGrazingAreaIds } from '$lib/db/fields';
import { isGrazingAreaKind } from '$lib/farm/areaKinds';
import {
  exposureHolds,
  parseExposureFloor,
  stayWasExposed,
  type ExposureHold,
  type ExposureStay
} from '$lib/safety/grazingExposure';
import { summarizeAreaGrazing, type GrazingByArea } from '$lib/farm/areaGrazing';
import type { GrazingRestrictions, Plugin } from '$lib/plugins/schemas';
import type { PluginRegistry } from '$lib/plugins/registry';
import {
  DAY_MS,
  GRAZING_LOOKBACK_DAYS,
  attestationDays,
  evaluateGrazing,
  evaluateHayCut,
  applicationFieldId,
  canReassignBlock,
  farmCopyRestrictions,
  hayOffFarmRestrictedFor,
  registryMaxIntervalDays,
  type GrazingApplication,
  type GrazingApplicationSource,
  type GrazingAttestationInput
} from '$lib/safety/grazingInterval';
import { getBaseRegistry, getRegistry } from '$lib/server/registry';
import { readHoldParams, type HoldParamsSource } from '$lib/db/holdParams';

const PESTICIDE_TYPES = new Set(['herbicide', 'insecticide', 'fungicide']);

type Pesticide = Extract<Plugin, { type: 'herbicide' | 'insecticide' | 'fungicide' }>;

function pesticide(registry: PluginRegistry, pluginId: string | null): Pesticide | null {
  if (!pluginId) return null;
  const p = registry.get(pluginId)?.plugin;
  return p && PESTICIDE_TYPES.has(p.type) ? (p as Pesticide) : null;
}

const MAX_DAYS = new WeakMap<PluginRegistry, { size: number; days: number }>();

/** C-23: the longest interval any pesticide plugin in the registry carries. */
export function registryGrazingMaxDays(registry: PluginRegistry): number {
  const size = registry.size();
  const hit = MAX_DAYS.get(registry);
  if (hit && hit.size === size) return hit.days;
  const days = scanGrazingMaxDays(registry);
  MAX_DAYS.set(registry, { size, days });
  return days;
}

function scanGrazingMaxDays(registry: PluginRegistry): number {
  return registryMaxIntervalDays(
    registry
      .all()
      .map((r) => r.plugin)
      .filter((p): p is Pesticide => PESTICIDE_TYPES.has(p.type))
      .map((p) => p.grazingRestrictions as GrazingRestrictions | undefined)
  );
}

interface RawEvent {
  id: string;
  blockId: string;
  occurredAt: number;
  products: Array<{ pluginId?: string | null; displayName?: string }>;
  formerFieldId?: string;
}

export function toApplications(
  source: GrazingApplicationSource,
  events: readonly RawEvent[],
  registry: PluginRegistry,
  base: PluginRegistry
): GrazingApplication[] {
  const out: GrazingApplication[] = [];
  for (const e of events) {
    const products = e.products.length ? e.products : [{ pluginId: null }];
    for (const prod of products) {
      const pluginId = prod.pluginId ?? null;
      const p = pesticide(registry, pluginId);
      const shared = pesticide(base, pluginId);
      const sharedR = shared?.grazingRestrictions as GrazingRestrictions | undefined;
      const farmR =
        p && p !== shared ? (p.grazingRestrictions as GrazingRestrictions | undefined) : undefined;
      const hayOffFarm = hayOffFarmRestrictedFor(sharedR, farmR)
        ? {
            hayOffFarm: {
              source:
                (sharedR?.hayOffFarmRestricted ? sharedR.source : undefined) ??
                (farmR?.hayOffFarmRestricted ? farmR.source : undefined) ??
                null
            }
          }
        : {};
      out.push({
        ref: `${source}:${e.id}`,
        source,
        blockId: e.blockId,
        appliedAtMs: e.occurredAt,
        productPluginId: pluginId,
        productName:
          p?.displayName ??
          shared?.displayName ??
          prod.displayName ??
          pluginId ??
          'an unnamed product',
        restrictions: farmCopyRestrictions(sharedR, farmR),
        activeIngredients: (p ?? shared)?.activeIngredients.map((a) => a.name) ?? [],
        ...(e.formerFieldId ? { formerFieldId: e.formerFieldId } : {}),
        ...hayOffFarm
      });
    }
  }
  return out;
}

export interface GrazingContext {
  applications: GrazingApplication[];
  attestations: GrazingAttestationInput[];
  registryMaxIntervalDays: number;
}

/** C-35: the grazing data each product carried when an application was
 *  recorded, as the hold guard stores it in `hold_params_json`. */
export interface ApplicationHoldParams {
  rulesVersion: string;
  /** When the application was saved (the tables have no created_at); null
   *  for a snapshot backfilled onto a record saved before C-35. */
  recordedAtMs: number | null;
  products: Record<string, GrazingRestrictions | null>;
  /** The registry's longest interval at the time, which sets how long an
   *  unknown hold runs; a later shared change can only lengthen it. */
  registryMaxDays?: number;
}

export function applicationHoldParams(
  applications: readonly GrazingApplication[],
  rulesVersion: string,
  recordedAtMs: number | null,
  registryMaxDays?: number
): ApplicationHoldParams {
  const products: Record<string, GrazingRestrictions | null> = {};
  for (const a of applications) products[a.productPluginId ?? ''] = a.restrictions;
  return registryMaxDays === undefined
    ? { rulesVersion, recordedAtMs, products }
    : { rulesVersion, recordedAtMs, products, registryMaxDays };
}

function parseHoldParams(json: string | undefined): ApplicationHoldParams | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as ApplicationHoldParams;
    return v && typeof v.products === 'object' && v.products !== null ? v : null;
  } catch {
    return null;
  }
}

/**
 * C-35: each application counts under the longer of the grazing data it
 * was recorded with and the data on file now. Where the two differ, the
 * snapshot reading is added as a second application with the same ref, so
 * every kernel takes the stricter of the two (attestations still match it).
 */
export function withRecordedParams(
  applications: readonly GrazingApplication[],
  snapshots: ReadonlyMap<string, string>
): GrazingApplication[] {
  const out: GrazingApplication[] = [];
  for (const a of applications) {
    out.push(a);
    const id = a.ref.slice(a.ref.indexOf(':') + 1);
    const params = parseHoldParams(snapshots.get(`${a.source}:${id}`));
    if (!params) continue;
    const key = a.productPluginId ?? '';
    if (!(key in params.products)) continue;
    const recorded = params.products[key] ?? null;
    if (JSON.stringify(recorded) === JSON.stringify(a.restrictions)) continue;
    out.push({ ...a, restrictions: recorded });
  }
  return out;
}

function snapshotsBySource(): Map<string, string> {
  const out = new Map<string, string>();
  for (const source of ['spray', 'insecticide', 'fungicide'] as HoldParamsSource[]) {
    for (const [id, json] of readHoldParams(source)) out.set(`${source}:${id}`, json);
  }
  return out;
}

/** The longest interval any stored application snapshot carries. */
function snapshotMaxDays(snapshots: ReadonlyMap<string, string>): number {
  let max = 0;
  for (const json of snapshots.values()) {
    const params = parseHoldParams(json);
    if (params) max = Math.max(max, registryMaxIntervalDays(Object.values(params.products)));
  }
  return max;
}

/** The longest registry-wide interval any stored snapshot was recorded under. */
function snapshotRegistryMaxDays(snapshots: ReadonlyMap<string, string>): number {
  let max = 0;
  for (const json of snapshots.values()) {
    const days = parseHoldParams(json)?.registryMaxDays;
    if (typeof days === 'number' && Number.isFinite(days) && days > max) max = days;
  }
  return max;
}

/** The registry-wide interval the active farm's unknown holds run for: the
 *  data on file now, never shorter than what a stored application saw. */
export function farmRegistryMaxDays(registry: PluginRegistry, base: PluginRegistry): number {
  return Math.max(registryGrazingMaxDays(registry), registryGrazingMaxDays(base));
}

/** The longest interval any of the farm's attestations gives. */
function attestationMaxDays(attestations: readonly GrazingAttestationInput[]): number {
  let max = 0;
  for (const t of attestations) for (const d of attestationDays(t)) if (d > max) max = d;
  return max;
}

/** The synchronous core of `loadGrazingContext`, for callers that already
 *  hold the registries (the hold guard runs inside one transaction). */
export function grazingContextFrom(
  registry: PluginRegistry,
  base: PluginRegistry,
  nowMs: number,
  opts: { fromAtMs?: number } = {}
): GrazingContext {
  const snapshots = snapshotsBySource();
  const max = Math.max(farmRegistryMaxDays(registry, base), snapshotRegistryMaxDays(snapshots));
  const farmAttestations = listGrazingAttestations();
  const anchor = Math.min(nowMs, opts.fromAtMs ?? nowMs);
  const reach = Math.max(
    GRAZING_LOOKBACK_DAYS,
    max,
    snapshotMaxDays(snapshots),
    attestationMaxDays(farmAttestations)
  );
  const fromMs =
    opts.fromAtMs === Number.NEGATIVE_INFINITY ? undefined : anchor - (reach + 1) * DAY_MS;
  const live = new Set<string>();
  const sprays = listSprayEvents({ fromMs });
  const insecticides = listInsecticideEvents({ fromMs });
  const fungicides = listFungicideEvents({ fromMs });
  for (const e of sprays) live.add(`spray:${e.id}`);
  for (const e of insecticides) live.add(`insecticide:${e.id}`);
  for (const e of fungicides) live.add(`fungicide:${e.id}`);
  const deleted = listApplicationTombstones(fromMs ?? Number.NEGATIVE_INFINITY).filter(
    (t) => !live.has(`${t.source}:${t.id}`)
  );
  const bySource = (source: GrazingApplicationSource) => deleted.filter((t) => t.source === source);
  const applications = withRecordedParams(
    [
      ...toApplications('spray', [...sprays, ...bySource('spray')], registry, base),
      ...toApplications(
        'insecticide',
        [...insecticides, ...bySource('insecticide')],
        registry,
        base
      ),
      ...toApplications('fungicide', [...fungicides, ...bySource('fungicide')], registry, base)
    ],
    snapshots
  );
  const refs = new Set(applications.map((a) => a.ref));
  const attestations = farmAttestations.filter(
    (t) => t.sprayEventRef !== null && refs.has(t.sprayEventRef)
  );
  return { applications, attestations, registryMaxIntervalDays: max };
}

/**
 * Every herbicide, insecticide and fungicide application the active Owner
 * recorded inside the widest lookback, with each product's label data.
 * Label data comes from the shared library; a farm's own copy of a plugin
 * can only make it stricter (`farmCopyRestrictions`), and so can the data
 * stored with the application when it was recorded (C-35). Deleted
 * applications still count unless the owner said they were never applied
 * (C-26). The window reaches back from the earlier of `nowMs` and
 * `fromAtMs`, so a backdated verdict sees everything inside its own
 * lookback (C-23). All reads go through the tenant-scoped repos.
 */
export async function loadGrazingContext(
  nowMs: number = Date.now(),
  opts: { fromAtMs?: number } = {}
): Promise<GrazingContext> {
  const [registry, base] = await Promise.all([getRegistry(), getBaseRegistry()]);
  return grazingContextFrom(registry, base, nowMs, opts);
}

interface BlockLike {
  id: string;
  fieldId?: string | null;
}

/** Every live block's Area, for `applicationFieldId`. */
export function fieldOfBlocks(): Map<string, string | null> {
  return new Map(listBlocks({ plantings: 'none' }).map((b) => [b.id, b.fieldId ?? null]));
}

/** The applications that count on one Area: on its blocks now, or on a
 *  block of it that was deleted (review round 4). */
export function applicationsOnField(
  applications: readonly GrazingApplication[],
  fieldId: string,
  fieldOf: ReadonlyMap<string, string | null> = fieldOfBlocks()
): GrazingApplication[] {
  return applications.filter((a) => applicationFieldId(a, fieldOf) === fieldId);
}

/**
 * Whether the grazing and hay rules count this whole Area: grazing land by
 * kind, or any Area an animal has stayed on. A sprayed garden bed or crop
 * field no animal has been on holds nothing for the Area (its own hay hold
 * travels with the block and ends with it).
 */
export function areaIsGrazed(fieldId: string | null | undefined): boolean {
  if (!fieldId) return false;
  if (isGrazingAreaKind(getField(fieldId)?.kind)) return true;
  return listLocationsOnField(fieldId, { includeDeleted: true }).length > 0;
}

/**
 * Whether a harvest on this Area is cut from grazing land (C-28). Grazing
 * kinds always are. On any other Area the hay rule is for forage cut off
 * ground animals graze, so a harvest of a crop planted on the block (a
 * planned or active planting, or the named planting) is a crop harvest
 * even when animals have been on the Area; a harvest naming a crop that is
 * not planted there, on an Area animals have stayed on (`areaIsGrazed`),
 * is still a hay declaration.
 */
export function harvestOnGrazingLand(
  fieldId: string | null | undefined,
  declaredPlantedHere: boolean
): boolean {
  if (!fieldId) return false;
  if (isGrazingAreaKind(getField(fieldId)?.kind)) return true;
  if (declaredPlantedHere) return false;
  return areaIsGrazed(fieldId);
}

/** Every Area the grazing and hay rules count as a whole (`areaIsGrazed`). */
export function grazedAreaIds(): Set<string> {
  const ids = listGrazingAreaIds();
  for (const id of listFieldIdsWithStays()) ids.add(id);
  return ids;
}

/** Pure assembly: one summary per Area that has a hold, split out for tests. */
export function buildGrazingByArea(input: {
  context: GrazingContext;
  blocks: readonly BlockLike[];
  nowMs: number;
  timeZone: string;
  /** Areas to summarize; left out, every Area with an application. */
  grazedAreas?: ReadonlySet<string>;
}): GrazingByArea {
  const areaOf = new Map(input.blocks.map((b) => [b.id, b.fieldId ?? null]));
  const byArea = new Map<string, GrazingApplication[]>();
  for (const a of input.context.applications) {
    const areaId = applicationFieldId(a, areaOf);
    if (!areaId) continue;
    if (input.grazedAreas && !input.grazedAreas.has(areaId)) continue;
    const list = byArea.get(areaId) ?? [];
    list.push(a);
    byArea.set(areaId, list);
  }
  const out: GrazingByArea = {};
  for (const [areaId, applications] of byArea) {
    const base = {
      applications,
      attestations: input.context.attestations,
      atMs: input.nowMs,
      timeZone: input.timeZone,
      registryMaxIntervalDays: input.context.registryMaxIntervalDays
    };
    const summary = summarizeAreaGrazing({
      graze: evaluateGrazing({
        ...base,
        subject: { speciesId: null, foodProducing: true, lactating: false }
      }),
      milking: evaluateGrazing({
        ...base,
        subject: { speciesId: null, foodProducing: true, lactating: true }
      }),
      hay: evaluateHayCut(base)
    });
    if (summary) out[areaId] = summary;
  }
  return out;
}

/** Every Area's grazing and hay holds for the active Owner. */
export async function loadAreaGrazing(
  blocks: readonly BlockLike[],
  timeZone: string,
  nowMs: number = Date.now()
): Promise<GrazingByArea> {
  if (blocks.length === 0) return {};
  const context = await loadGrazingContext(nowMs);
  if (context.applications.length === 0) return {};
  return buildGrazingByArea({ context, blocks, nowMs, timeZone, grazedAreas: grazedAreaIds() });
}

/**
 * C-21: a block whose applications still hold grazing or hay cannot move to
 * another Area, since the holds are counted through its current Area. Nor
 * can it move while animals that grazed its Area have food on hold because
 * of those applications: the food gate finds a block's Area from where it
 * is now, so the move would drop their exposure holds (C-30).
 */
export async function blockReassignRefusal(
  blockId: string,
  timeZone: string,
  nowMs: number = Date.now()
): Promise<{ error: 'BLOCK_HAS_GRAZING_HOLD'; message: string; grazingPage: string } | null> {
  const fieldId = listBlocks({ plantings: 'none' }).find((b) => b.id === blockId)?.fieldId ?? null;
  // A block in no Area counts nowhere yet, so placing it only adds holds
  // (review round 5).
  if (!fieldId) return null;
  // Unlike a delete, this holds on any Area kind: after the move the
  // application counts on the new Area only, so the old one would lose
  // the spray while its interval still runs (review round 4).
  const refusal = await blocksDeleteRefusal(fieldId, [blockId], timeZone, nowMs, {
    anyArea: true
  });
  if (!refusal) return null;
  return {
    error: 'BLOCK_HAS_GRAZING_HOLD',
    message:
      'This block was sprayed and its grazing or hay interval still holds, or animals that grazed its Area still have food on hold, so it stays in its Area until that ends: the spray has to keep counting where it landed. If the label gives a grazing time, type it on the Area’s grazing page to end the hold sooner.',
    grazingPage: `/plan/areas/${fieldId}/grazing`
  };
}

function exposureInput(
  context: GrazingContext,
  fieldId: string,
  applications: GrazingApplication[],
  timeZone: string
) {
  return {
    applicationsByField: new Map([[fieldId, applications]]),
    attestations: context.attestations,
    subject: { speciesId: null, lactating: true },
    timeZone,
    registryMaxIntervalDays: context.registryMaxIntervalDays
  };
}

/** A stored stay as the exposure rule reads it, with the floor its move
 *  saved (C-18), the same way the food gate's `clip()` builds it. */
export interface StoredStay {
  fieldId: string;
  fromMs: number;
  toMs: number | null;
  exposureFloor?: string | null;
}

export function exposureStayOf(s: StoredStay): ExposureStay {
  const floor = parseExposureFloor(s.exposureFloor);
  return { fieldId: s.fieldId, fromMs: s.fromMs, toMs: s.toMs, ...(floor.length ? { floor } : {}) };
}

/** Whether animals on this stay grazed an Area inside a label interval, so
 *  undoing the move would erase why their food is held (C-30, C-31). */
export async function stayExposureRefusal(
  stored: StoredStay,
  timeZone: string,
  nowMs: number = Date.now()
): Promise<{ error: string; code: 'STAY_HAS_GRAZING_HOLD' } | null> {
  const stay = exposureStayOf(stored);
  const context = await loadGrazingContext(nowMs, { fromAtMs: stay.fromMs });
  const applications = applicationsOnField(context.applications, stay.fieldId);
  if (applications.length === 0) return null;
  const exposed = stayWasExposed({
    ...exposureInput(context, stay.fieldId, applications, timeZone),
    stay,
    nowMs
  });
  if (!exposed) return null;
  return {
    code: 'STAY_HAS_GRAZING_HOLD',
    error:
      'These animals were on a sprayed Area inside its grazing time, so their food is on hold. The move stays on record. If they are somewhere else now, record a new move.'
  };
}

/** A cut dated within this of the request is the request's own moment: a
 *  move recorded now, not a backdated one. */
const SAME_MOMENT_MS = 5_000;

function holdKey(h: ExposureHold): string {
  return `${h.fieldId}|${h.ref}`;
}

/**
 * Pure: whether ending `stay` at `cutAtMs` shortens or removes an exposure
 * hold still running at `nowMs`, for any food and either reading of the
 * subject. This catches the label's pre-slaughter removal, which counts
 * from when the animals leave, so an earlier leaving date ends it sooner
 * even for an application made before the cut.
 */
export function cutShortensHolds(input: {
  stay: ExposureStay;
  cutAtMs: number;
  applications: readonly GrazingApplication[];
  attestations: GrazingContext['attestations'];
  registryMaxIntervalDays: number;
  timeZone: string;
  nowMs: number;
}): boolean {
  const { stay, cutAtMs, nowMs } = input;
  if (cutAtMs >= Math.min(stay.toMs ?? Number.POSITIVE_INFINITY, nowMs - SAME_MOMENT_MS)) {
    return false;
  }
  const cut: ExposureStay[] = cutAtMs > stay.fromMs ? [{ ...stay, toMs: cutAtMs }] : [];
  const applicationsByField = new Map([[stay.fieldId, input.applications]]);
  for (const lactating of [true, false]) {
    for (const food of ['meat', 'milk', 'eggs'] as const) {
      const base = {
        applicationsByField,
        attestations: input.attestations,
        subject: { speciesId: null, lactating },
        food,
        atMs: nowMs,
        timeZone: input.timeZone,
        registryMaxIntervalDays: input.registryMaxIntervalDays
      };
      const full = exposureHolds({ ...base, stays: [stay] });
      if (full.length === 0) continue;
      const after = new Map(exposureHolds({ ...base, stays: cut }).map((h) => [holdKey(h), h]));
      for (const h of full) {
        const c = after.get(holdKey(h));
        if (!c || c.endsAtMs < h.endsAtMs) return true;
        if (h.clearsAtMs === null) continue;
        if (c.clearsAtMs !== null && c.clearsAtMs < h.clearsAtMs) return true;
      }
    }
  }
  return false;
}

/**
 * C-30: whether ending this stay at `cutAtMs` would drop an exposure. A
 * backdated move that ends a stay early takes away the time after the cut,
 * and with it any application made on the Area while the animals were
 * still there, so the food holds that application put on them would go.
 * It also refuses a cut that ends a running hold sooner, such as a meat
 * removal counted from when the animals left.
 */
export async function stayCutErasesExposure(
  stored: StoredStay,
  cutAtMs: number,
  timeZone: string,
  nowMs: number = Date.now()
): Promise<boolean> {
  const stay = exposureStayOf(stored);
  const end = Math.min(stay.toMs ?? Number.POSITIVE_INFINITY, nowMs);
  if (cutAtMs >= end) return false;
  const context = await loadGrazingContext(nowMs, { fromAtMs: stay.fromMs });
  const onArea = applicationsOnField(context.applications, stay.fieldId);
  if (onArea.length === 0) return false;
  if (
    cutShortensHolds({
      stay,
      cutAtMs,
      applications: onArea,
      attestations: context.attestations,
      registryMaxIntervalDays: context.registryMaxIntervalDays,
      timeZone,
      nowMs
    })
  ) {
    return true;
  }
  const applications = onArea.filter((a) => a.appliedAtMs >= cutAtMs && a.appliedAtMs < end);
  if (applications.length === 0) return false;
  return stayWasExposed({
    ...exposureInput(context, stay.fieldId, applications, timeZone),
    stay,
    nowMs
  });
}

/**
 * C-21: deleting a block or an Area would erase its spray records and the
 * grazing and hay holds they carry. Refused on grazing land while a hold
 * is still running or while animals' food is held because they grazed
 * there. A block deleted off other land keeps its applications on its
 * Area through their tombstones (`formerFieldId`), so a later move onto
 * that Area is still gated. `wholeArea` (an Area delete) also counts those
 * earlier deleted blocks; `anyArea` (a block moving to another Area)
 * refuses a running hold on any kind of Area.
 */
export async function blocksDeleteRefusal(
  fieldId: string | null,
  blockIds: readonly string[],
  timeZone: string,
  nowMs: number = Date.now(),
  opts: { wholeArea?: boolean; anyArea?: boolean } = {}
): Promise<{ error: string; code: 'BLOCK_HAS_GRAZING_HOLD' } | null> {
  const ids = new Set(blockIds);
  if (ids.size === 0 && !opts.wholeArea) return null;
  if (!opts.anyArea && (!fieldId || !areaIsGrazed(fieldId))) return null;
  const context = await loadGrazingContext(nowMs, { fromAtMs: 0 });
  const fieldOf = fieldOfBlocks();
  const applications = context.applications.filter(
    (a) =>
      ids.has(a.blockId) ||
      (opts.wholeArea === true && fieldId !== null && applicationFieldId(a, fieldOf) === fieldId)
  );
  if (applications.length === 0) return null;
  const refusal = {
    code: 'BLOCK_HAS_GRAZING_HOLD' as const,
    error:
      'This was sprayed and its grazing or hay interval still holds, or animals that grazed here still have food on hold. It has to stay until that ends.'
  };
  const open = !canReassignBlock({
    applications,
    attestations: context.attestations,
    atMs: nowMs,
    timeZone,
    registryMaxIntervalDays: context.registryMaxIntervalDays
  }).ok;
  if (open) return refusal;
  if (!fieldId) return null;
  const input = exposureInput(context, fieldId, applications, timeZone);
  for (const stay of listLocationsOnField(fieldId, { includeDeleted: true })) {
    if (stayWasExposed({ ...input, stay: exposureStayOf(stay), nowMs })) return refusal;
  }
  return null;
}

/** Whether deleting this application would drop a grazing or hay hold that
 *  is still running, or the reason animals that grazed its Area have food
 *  on hold, so only the owner may do it and the delete keeps a tombstone
 *  (C-19, C-26, C-32). */
export async function applicationHoldsGrazing(
  ref: string,
  timeZone: string,
  nowMs: number = Date.now()
): Promise<boolean> {
  const context = await loadGrazingContext(nowMs);
  const applications = context.applications.filter((a) => a.ref === ref);
  if (applications.length === 0) return false;
  const open = !canReassignBlock({
    applications,
    attestations: context.attestations,
    atMs: nowMs,
    timeZone,
    registryMaxIntervalDays: context.registryMaxIntervalDays
  }).ok;
  if (open) return true;
  const fieldId = applicationFieldId(applications[0], fieldOfBlocks());
  if (!fieldId) return false;
  const input = exposureInput(context, fieldId, applications, timeZone);
  return listLocationsOnField(fieldId, { includeDeleted: true }).some((stay) =>
    stayWasExposed({ ...input, stay: exposureStayOf(stay), nowMs })
  );
}
