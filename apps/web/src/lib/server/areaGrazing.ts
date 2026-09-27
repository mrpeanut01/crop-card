import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listGrazingAttestations } from '$lib/db/grazingAttestations';
import { listApplicationTombstones } from '$lib/db/admin';
import { listBlocks } from '$lib/db/blocks';
import { listLocationsOnField } from '$lib/db/animalLocations';
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
  evaluateGrazing,
  evaluateHayCut,
  canReassignBlock,
  farmCopyRestrictions,
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
        restrictions: farmCopyRestrictions(
          shared?.grazingRestrictions as GrazingRestrictions | undefined,
          p && p !== shared ? (p.grazingRestrictions as GrazingRestrictions | undefined) : undefined
        ),
        activeIngredients: (p ?? shared)?.activeIngredients.map((a) => a.name) ?? []
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
  /** When the application was saved (the tables have no created_at). */
  recordedAtMs: number;
  products: Record<string, GrazingRestrictions | null>;
}

export function applicationHoldParams(
  applications: readonly GrazingApplication[],
  rulesVersion: string,
  recordedAtMs: number
): ApplicationHoldParams {
  const products: Record<string, GrazingRestrictions | null> = {};
  for (const a of applications) products[a.productPluginId ?? ''] = a.restrictions;
  return { rulesVersion, recordedAtMs, products };
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

/** The synchronous core of `loadGrazingContext`, for callers that already
 *  hold the registries (the hold guard runs inside one transaction). */
export function grazingContextFrom(
  registry: PluginRegistry,
  base: PluginRegistry,
  nowMs: number,
  opts: { fromAtMs?: number } = {}
): GrazingContext {
  const max = Math.max(registryGrazingMaxDays(registry), registryGrazingMaxDays(base));
  const anchor = Math.min(nowMs, opts.fromAtMs ?? nowMs);
  const fromMs =
    opts.fromAtMs === Number.NEGATIVE_INFINITY
      ? undefined
      : anchor - (Math.max(GRAZING_LOOKBACK_DAYS, max) + 1) * DAY_MS;
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
    snapshotsBySource()
  );
  const attestations = applications.length
    ? listGrazingAttestations({ sprayEventRefs: [...new Set(applications.map((a) => a.ref))] })
    : [];
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

/** Pure assembly: one summary per Area that has a hold, split out for tests. */
export function buildGrazingByArea(input: {
  context: GrazingContext;
  blocks: readonly BlockLike[];
  nowMs: number;
  timeZone: string;
}): GrazingByArea {
  const areaOf = new Map(input.blocks.map((b) => [b.id, b.fieldId ?? null]));
  const byArea = new Map<string, GrazingApplication[]>();
  for (const a of input.context.applications) {
    const areaId = areaOf.get(a.blockId);
    if (!areaId) continue;
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
  return buildGrazingByArea({ context, blocks, nowMs, timeZone });
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
): Promise<{ error: 'BLOCK_HAS_GRAZING_HOLD'; message: string } | null> {
  const fieldId = listBlocks({ plantings: 'none' }).find((b) => b.id === blockId)?.fieldId ?? null;
  const refusal = await blocksDeleteRefusal(fieldId, [blockId], timeZone, nowMs);
  if (!refusal) return null;
  return {
    error: 'BLOCK_HAS_GRAZING_HOLD',
    message:
      'This block was sprayed and its grazing or hay interval still holds, or animals that grazed its Area still have food on hold. It has to stay in its Area until that ends.'
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
  const ids = new Set(
    listBlocks({ plantings: 'none' })
      .filter((b) => b.fieldId === stay.fieldId)
      .map((b) => b.id)
  );
  if (ids.size === 0) return null;
  const context = await loadGrazingContext(nowMs, { fromAtMs: stay.fromMs });
  const applications = context.applications.filter((a) => ids.has(a.blockId));
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
  const ids = new Set(
    listBlocks({ plantings: 'none' })
      .filter((b) => b.fieldId === stay.fieldId)
      .map((b) => b.id)
  );
  if (ids.size === 0) return false;
  const context = await loadGrazingContext(nowMs, { fromAtMs: stay.fromMs });
  const onArea = context.applications.filter((a) => ids.has(a.blockId));
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
 * grazing and hay holds they carry. Refused while a hold is still running
 * or while animals' food is held because they grazed there.
 */
export async function blocksDeleteRefusal(
  fieldId: string | null,
  blockIds: readonly string[],
  timeZone: string,
  nowMs: number = Date.now()
): Promise<{ error: string; code: 'BLOCK_HAS_GRAZING_HOLD' } | null> {
  const ids = new Set(blockIds);
  if (ids.size === 0) return null;
  const context = await loadGrazingContext(nowMs, { fromAtMs: 0 });
  const applications = context.applications.filter((a) => ids.has(a.blockId));
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
  const fieldId = listBlocks({ plantings: 'none' }).find(
    (b) => b.id === applications[0].blockId
  )?.fieldId;
  if (!fieldId) return false;
  const input = exposureInput(context, fieldId, applications, timeZone);
  return listLocationsOnField(fieldId, { includeDeleted: true }).some((stay) =>
    stayWasExposed({ ...input, stay: exposureStayOf(stay), nowMs })
  );
}
