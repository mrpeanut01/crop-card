/**
 * Phase 32C record rules for `/api/animals/health/**` and
 * `/api/animals/production/**`: building the withdrawal kernel's inputs from
 * tenant-scoped reads, storing its verdict with `rules_version`, the FR-09
 * lock and the tombstoned delete. The kernel itself
 * (`$lib/safety/animalWithdrawal`) stays pure; every read here goes through
 * the tenant-scoped repos.
 */

import { getAnimal, type Animal } from '$lib/db/animals';
import { getAnimalGroup, type AnimalGroup } from '$lib/db/animalGroups';
import { listGroupIdsSplitFrom, listLocationsForSubject } from '$lib/db/animalLocations';
import { listStatusEventsForSubjects, type AnimalStatusEvent } from '$lib/db/animalStatus';
import {
  listAnimalIdsEverInGroup,
  listHealthEventsForSubjects,
  listHealthEventsRecordedSince,
  listHealthTombstones,
  healthStockNote,
  type AnimalHealthEvent,
  type SubjectRef
} from '$lib/db/animalHealth';
import {
  declaredFoodUse,
  listFoodLogsForSubjects,
  type AnimalProductionLog
} from '$lib/db/animalProduction';
import { decrementForUse, getStockItem } from '$lib/db/stock';
import { getDataKinds } from '$lib/server/registry';
import { bestEffort, errorText } from '$lib/server/recordWrite';
import { ALL_STOCK_UNITS, convert, type StockUnit } from '$lib/stock/units';
import { subjectFoodProducing } from '$lib/server/animals';
import {
  lineageFromStays,
  membershipsFromStays,
  withInheritedLineage
} from '$lib/animals/membership';
import type { AnimalSubjectType } from '$lib/animals/model';
import {
  carriesHold,
  evaluateFoodUse,
  isMeatDeclaration,
  logsCoveredByHolds,
  parseWithdrawalClear,
  parseWithdrawalEntries,
  summarizeHolds,
  type Food,
  type FoodHoldSummary,
  type AnimalHealthProductData,
  type FoodSubject,
  type GroupMembership,
  type PluginLookup,
  type SavedProductionLog,
  type TreatmentRecord
} from '$lib/safety/animalWithdrawal';

export interface ResolvedSubject {
  type: AnimalSubjectType;
  id: string;
  name: string;
  speciesId: string;
  sex: string | null;
  /** The stricter flag the lock reads: food-producing now or ever. */
  foodProducing: boolean;
  animal: Animal | null;
  group: AnimalGroup | null;
}

export function resolveSubject(type: AnimalSubjectType, id: string): ResolvedSubject | null {
  if (type === 'animal') {
    const animal = getAnimal(id);
    if (!animal) return null;
    return {
      type,
      id,
      name: animal.name ?? (animal.tag ? `Tag ${animal.tag}` : 'This animal'),
      speciesId: animal.speciesId,
      sex: animal.sex,
      foodProducing: subjectFoodProducing('animal', id),
      animal,
      group: null
    };
  }
  const group = getAnimalGroup(id);
  if (!group) return null;
  return {
    type,
    id,
    name: group.name,
    speciesId: group.speciesId,
    sex: null,
    foodProducing: subjectFoodProducing('group', id),
    animal: null,
    group
  };
}

export async function healthPlugins(): Promise<PluginLookup> {
  const registry = (await getDataKinds()).animalHealth;
  return (pluginId) => registry.get(pluginId);
}

export async function healthPluginExists(pluginId: string): Promise<boolean> {
  return (await getDataKinds()).animalHealth.has(pluginId);
}

function animalMemberships(animalId: string, currentGroupId: string | null): GroupMembership[] {
  return withInheritedLineage(
    membershipsFromStays(currentGroupId, listLocationsForSubject('animal', animalId)),
    groupLineage
  );
}

function groupLineage(groupId: string): GroupMembership[] {
  return lineageFromStays(
    listLocationsForSubject('group', groupId),
    (parent) => listLocationsForSubject('group', parent),
    groupId
  );
}

export interface FoodContext {
  subject: FoodSubject;
  /** Every subject whose treatments can reach this one. */
  related: SubjectRef[];
}

/** The kernel's view of a subject: memberships over time (C-15), a group's
 *  split ancestry and everyone who was ever in it. */
export function foodSubjectFor(type: AnimalSubjectType, id: string): FoodContext | null {
  const related = new Map<string, SubjectRef>();
  const add = (subjectType: AnimalSubjectType, subjectId: string) =>
    related.set(`${subjectType}:${subjectId}`, { subjectType, subjectId });
  add(type, id);
  if (type === 'animal') {
    const animal = getAnimal(id);
    if (!animal) return null;
    const memberships = animalMemberships(animal.id, animal.groupId);
    for (const m of memberships) add('group', m.groupId);
    return { subject: { type: 'animal', id, memberships }, related: [...related.values()] };
  }
  const group = getAnimalGroup(id);
  if (!group) return null;
  const lineage = groupLineage(id);
  for (const l of lineage) add('group', l.groupId);
  const members = listAnimalIdsEverInGroup(id).map((animalId) => {
    const memberships = animalMemberships(animalId, getAnimal(animalId)?.groupId ?? null);
    add('animal', animalId);
    for (const m of memberships) add('group', m.groupId);
    return { animalId, memberships };
  });
  return {
    subject: { type: 'group', id, lineage, members },
    related: [...related.values()]
  };
}

function speciesAndSex(
  ref: SubjectRef,
  cache: Map<string, { speciesId: string; sex: string | null }>
): { speciesId: string; sex: string | null } {
  const key = `${ref.subjectType}:${ref.subjectId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out = { speciesId: 'unknown', sex: null as string | null };
  if (ref.subjectType === 'animal') {
    const a = getAnimal(ref.subjectId);
    if (a) out = { speciesId: a.speciesId, sex: a.sex };
  } else {
    const g = getAnimalGroup(ref.subjectId);
    if (g) out = { speciesId: g.speciesId, sex: null };
  }
  cache.set(key, out);
  return out;
}

/** A stored health event as the kernel reads it. An open course is kept in
 *  the stored verdict (no last dose), and an unreadable verdict on an event
 *  with no recorded end is read as open, which can only lengthen a hold. */
export function toTreatment(
  event: AnimalHealthEvent,
  species: { speciesId: string; sex: string | null },
  deletion: { dosed: boolean } | null = null
): TreatmentRecord {
  const storedClear = parseWithdrawalClear(event.withdrawalClear);
  const holds = carriesHold({ ...event, deletion });
  const courseOpen =
    holds &&
    event.courseEndAt === null &&
    (storedClear === null || storedClear.lastDoseAtMs === null);
  return {
    id: event.id,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    speciesId: species.speciesId,
    subjectSex: species.sex,
    kind: event.kind,
    productPluginId: event.productPluginId,
    productName: event.productName,
    productTexts: parseStockProductText(event.stockProductText),
    route: event.route,
    labelUse: event.labelUse,
    administeredAtMs: event.administeredAt,
    courseEndAtMs: event.courseEndAt,
    courseOpen,
    entries: parseWithdrawalEntries(event.vetDirectedWithdrawal),
    storedClear,
    deletion,
    ...snapshotOf(event.holdParamsJson)
  };
}

/** C-35: the label data stored with the dose, as the kernel reads it:
 *  `product` for the product the dose was saved with, `products` for each
 *  product an owner product entry named, taken when that entry was saved. */
export interface DoseHoldParams {
  rulesVersion: string;
  product: AnimalHealthProductData | null;
  products?: Record<string, AnimalHealthProductData | null>;
}

export function parseDoseHoldParams(json: string | null | undefined): DoseHoldParams | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as DoseHoldParams;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v;
  } catch {
    return null;
  }
}

function snapshotOf(json: string | null | undefined): {
  snapshotProduct?: AnimalHealthProductData | null;
  snapshotProducts?: Record<string, AnimalHealthProductData | null>;
} {
  const v = parseDoseHoldParams(json);
  if (!v) return {};
  const out: {
    snapshotProduct?: AnimalHealthProductData | null;
    snapshotProducts?: Record<string, AnimalHealthProductData | null>;
  } = {};
  if ('product' in v) out.snapshotProduct = v.product ?? null;
  if (v.products && typeof v.products === 'object' && !Array.isArray(v.products)) {
    out.snapshotProducts = v.products;
  }
  return out;
}

/** Live and force-deleted treatments of these subjects (C-26: a deleted
 *  dose keeps its hold unless the owner said it was never given). */
export function loadTreatments(related: readonly SubjectRef[]): TreatmentRecord[] {
  const cache = new Map<string, { speciesId: string; sex: string | null }>();
  const live = listHealthEventsForSubjects(related).map((e) =>
    toTreatment(e, speciesAndSex(e, cache))
  );
  const seen = new Set(live.map((t) => t.id));
  const deleted = listHealthTombstones(related)
    .filter((t) => !seen.has(t.recordId))
    .map((t) => toTreatment(t.event, speciesAndSex(t.event, cache), { dosed: t.dosed }));
  return [...live, ...deleted];
}

export function foodOf(kind: string): Food | null {
  if (kind === 'eggs') return 'eggs';
  if (kind === 'milk') return 'milk';
  return null;
}

/** C-33: one chip per food for a subject's page. */
export function holdSummaryFor(
  type: AnimalSubjectType,
  id: string,
  plugins: PluginLookup,
  timeZone: string,
  atMs = Date.now()
): Record<Food, FoodHoldSummary> | null {
  const ctx = foodSubjectFor(type, id);
  if (!ctx) return null;
  return summarizeHolds({
    subject: ctx.subject,
    atMs,
    treatments: loadTreatments(ctx.related),
    plugins,
    timeZone
  });
}

/** Every subject a treatment of `treated` can reach at a food declaration:
 *  its own related set plus each group split off it (at any depth) and
 *  their members, which inherit its hold through lineage (C-15). */
function reachedBy(treated: SubjectRef): SubjectRef[] {
  const ctx = foodSubjectFor(treated.subjectType, treated.subjectId);
  if (!ctx) return [];
  const out = new Map<string, SubjectRef>();
  const add = (r: SubjectRef) => out.set(`${r.subjectType}:${r.subjectId}`, r);
  for (const r of ctx.related) add(r);
  const roots = ctx.related.filter((r) => r.subjectType === 'group').map((r) => r.subjectId);
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of listGroupIdsSplitFrom(parent)) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
      add({ subjectType: 'group', subjectId: child });
      for (const animalId of listAnimalIdsEverInGroup(child)) {
        add({ subjectType: 'animal', subjectId: animalId });
      }
    }
  }
  return [...out.values()];
}

/** C-17 on a stored status change: slaughter or sale for meat, or a death,
 *  sale or cull that ran the food gate because the meat was used. */
export function declaresMeat(e: Pick<AnimalStatusEvent, 'status' | 'rulesVersion'>): boolean {
  return isMeatDeclaration(e.status, e.rulesVersion !== null);
}

export interface CoveredRecords {
  logs: AnimalProductionLog[];
  /** Meat already declared as food inside a hold. */
  meat: AnimalStatusEvent[];
}

/** C-06: saved food or sale logs, and meat declarations, a new treatment
 *  now covers. The records are never rewritten; the owner is told so a
 *  buyer can be warned. A log changed to discarded after it was saved as
 *  food or for sale still counts. */
export function coveredRecordsAfter(
  treated: SubjectRef,
  plugins: PluginLookup,
  timeZone: string
): CoveredRecords {
  const reached = reachedBy(treated);
  if (reached.length === 0) return { logs: [], meat: [] };
  const logs = listFoodLogsForSubjects(reached);
  const meatEvents = listStatusEventsForSubjects(reached).filter(declaresMeat);
  if (logs.length === 0 && meatEvents.length === 0) return { logs: [], meat: [] };
  const contexts = new Map<string, FoodContext | null>();
  const related = new Map<string, SubjectRef>();
  const contextOf = (type: AnimalSubjectType, id: string) => {
    const key = `${type}:${id}`;
    if (!contexts.has(key)) {
      const sc = foodSubjectFor(type, id);
      contexts.set(key, sc);
      for (const r of sc?.related ?? []) related.set(`${r.subjectType}:${r.subjectId}`, r);
    }
    return contexts.get(key) ?? null;
  };
  const saved: SavedProductionLog[] = [];
  const byId = new Map<string, AnimalProductionLog>();
  for (const log of logs) {
    const sc = contextOf(log.subjectType, log.subjectId);
    const food = foodOf(log.kind);
    if (!sc || !food) continue;
    byId.set(log.id, log);
    saved.push({
      id: log.id,
      food,
      use: declaredFoodUse(log),
      occurredAtMs: log.occurredAt,
      subject: sc.subject
    });
  }
  const meatSubjects = meatEvents
    .map((e) => ({ e, sc: contextOf(e.subjectType, e.subjectId) }))
    .filter((x): x is { e: AnimalStatusEvent; sc: FoodContext } => x.sc !== null);
  const treatments = loadTreatments([...related.values()]);
  const coveredLogs = logsCoveredByHolds(saved, treatments, plugins, timeZone)
    .map((l) => byId.get(l.id))
    .filter((l): l is AnimalProductionLog => l !== undefined)
    .sort((a, b) => a.occurredAt - b.occurredAt);
  const coveredMeat = meatSubjects
    .filter(
      ({ e, sc }) =>
        evaluateFoodUse({
          subject: sc.subject,
          food: 'meat',
          use: 'food',
          atMs: e.occurredAt,
          treatments,
          plugins,
          timeZone
        }).status === 'block'
    )
    .map(({ e }) => e);
  return { logs: coveredLogs, meat: coveredMeat };
}

/** C-06: saved food or sale logs a new treatment now covers. */
export function coveredLogsAfter(
  treated: SubjectRef,
  plugins: PluginLookup,
  timeZone: string
): AnimalProductionLog[] {
  return coveredRecordsAfter(treated, plugins, timeZone).logs;
}

export interface CoveredLogAlert {
  subjectType: AnimalSubjectType;
  subjectId: string;
  name: string;
  /** Egg and milk logs. */
  count: number;
  /** Meat declarations (slaughter or sale for meat). */
  meatCount: number;
}

const COVERED_ALERT_DAYS = 14;
const COVERED_ALERT_SUBJECTS = 10;

/** C-06 on the owner's /today: the subjects whose own saved food or sale
 *  logs, or meat declarations, fall inside a hold from a treatment recorded
 *  in the last two weeks, so each link opens the page that lists them. One
 *  query when nothing was recorded. */
export function coveredLogAlerts(
  plugins: PluginLookup,
  timeZone: string,
  now = Date.now()
): CoveredLogAlert[] {
  const recent = listHealthEventsRecordedSince(now - COVERED_ALERT_DAYS * 86_400_000).filter((e) =>
    carriesHold(e)
  );
  const treated = new Map<string, SubjectRef>();
  for (const e of recent) {
    treated.set(`${e.subjectType}:${e.subjectId}`, {
      subjectType: e.subjectType,
      subjectId: e.subjectId
    });
  }
  const bySubject = new Map<string, { ref: SubjectRef; logs: Set<string>; meat: Set<string> }>();
  const entryFor = (ref: SubjectRef) => {
    const key = `${ref.subjectType}:${ref.subjectId}`;
    const entry = bySubject.get(key) ?? { ref, logs: new Set<string>(), meat: new Set<string>() };
    bySubject.set(key, entry);
    return entry;
  };
  for (const ref of [...treated.values()].slice(0, COVERED_ALERT_SUBJECTS)) {
    const covered = coveredRecordsAfter(ref, plugins, timeZone);
    for (const log of covered.logs) {
      entryFor({ subjectType: log.subjectType, subjectId: log.subjectId }).logs.add(log.id);
    }
    for (const e of covered.meat) {
      entryFor({ subjectType: e.subjectType, subjectId: e.subjectId }).meat.add(e.id);
    }
  }
  const out: CoveredLogAlert[] = [];
  for (const { ref, logs, meat } of bySubject.values()) {
    const subject = resolveSubject(ref.subjectType, ref.subjectId);
    if (!subject) continue;
    out.push({ ...ref, name: subject.name, count: logs.size, meatCount: meat.size });
  }
  return out;
}

/** C-06 on a log page: which of this subject's saved food or sale logs fall
 *  inside a treatment hold, so the owner can find them. A log changed to
 *  discarded after it was saved as food or for sale is still marked. */
export function coveredLogIds(
  type: AnimalSubjectType,
  id: string,
  logs: readonly AnimalProductionLog[],
  plugins: PluginLookup,
  timeZone: string
): Set<string> {
  const ctx = foodSubjectFor(type, id);
  if (!ctx) return new Set();
  const saved: SavedProductionLog[] = [];
  for (const log of logs) {
    const food = foodOf(log.kind);
    if (!food) continue;
    saved.push({
      id: log.id,
      food,
      use: declaredFoodUse(log),
      occurredAtMs: log.occurredAt,
      subject: ctx.subject
    });
  }
  if (!saved.some((l) => l.use === 'food' || l.use === 'sale')) return new Set();
  const treatments = loadTreatments(ctx.related);
  return new Set(logsCoveredByHolds(saved, treatments, plugins, timeZone).map((l) => l.id));
}

export interface RecordWarning {
  code:
    | 'PRODUCT_FROM_STOCK'
    | 'STOCK_NOT_DEDUCTED'
    | 'STOCK_SHORT'
    | 'LOGS_COVERED'
    | 'MEAT_COVERED'
    | 'FOOD_USE_WARNING'
    | 'LOGGED_LATE'
    | 'LABEL_USE_OWNER';
  message: string;
}

export interface StockPlan {
  stockItemId: string | null;
  productPluginId: string | null;
  productName: string | null;
  /** The bottle's own name and active ingredients, as stored JSON. */
  stockProductText: string | null;
  deduct: { amount: number; unit: StockUnit } | null;
  warnings: RecordWarning[];
}

/** The stored bottle texts, read leniently: anything unreadable is dropped,
 *  since the typed name and plugin still drive the match. */
export function parseStockProductText(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  } catch {
    return [];
  }
}

/** C-34: what the bottle calls itself, for the prohibited-drug match: its
 *  name and the names of its active ingredients. */
export function stockProductTexts(item: {
  displayName: string;
  shortName?: string;
  activeIngredientsJson?: string;
}): string[] {
  const out = [item.displayName, item.shortName ?? ''];
  if (item.activeIngredientsJson) {
    try {
      const parsed: unknown = JSON.parse(item.activeIngredientsJson);
      if (Array.isArray(parsed)) {
        for (const ai of parsed) {
          if (typeof ai === 'string') out.push(ai);
          else if (ai && typeof ai === 'object') {
            const name = (ai as { name?: unknown }).name;
            if (typeof name === 'string') out.push(name);
          }
        }
      }
    } catch {
      /* an unreadable list adds nothing; the bottle's name still counts */
    }
  }
  return [...new Set(out.map((t) => t.trim()).filter(Boolean))];
}

function asStockUnit(unit: string | null | undefined): StockUnit | null {
  const u = unit?.trim().toLowerCase();
  return u && (ALL_STOCK_UNITS as readonly string[]).includes(u) ? (u as StockUnit) : null;
}

/**
 * C-34: the bottle that was used names the product that drives the hold,
 * so a stock item carrying an animal-health plugin overrides a different
 * pick, and the bottle's own name and active ingredients are kept beside
 * any typed name for the prohibited-drug match (C-13). Treatments always save: a dose in a unit the stock item cannot take
 * is recorded without a deduction and says so.
 */
export function planHealthStock(
  input: {
    stockItemId?: string | null;
    productPluginId?: string | null;
    productName?: string | null;
    dose?: number | null;
    doseUnit?: string | null;
  },
  isHealthPlugin: (pluginId: string) => boolean
): StockPlan {
  const warnings: RecordWarning[] = [];
  let productPluginId = input.productPluginId ?? null;
  let productName = input.productName?.trim() || null;
  const none = { stockItemId: null, stockProductText: null, deduct: null };
  if (!input.stockItemId) return { ...none, productPluginId, productName, warnings };
  const item = getStockItem(input.stockItemId);
  if (!item) return { ...none, productPluginId, productName, warnings };
  if (item.pluginId && isHealthPlugin(item.pluginId) && item.pluginId !== productPluginId) {
    if (productPluginId) {
      warnings.push({
        code: 'PRODUCT_FROM_STOCK',
        message: `Saved as ${item.displayName}, the product in the bottle you picked from stock.`
      });
    }
    productPluginId = item.pluginId;
  }
  if (!productName && !productPluginId) productName = item.displayName;
  const unit = asStockUnit(input.doseUnit);
  let deduct: StockPlan['deduct'] = null;
  if (input.dose && input.dose > 0) {
    if (unit && convert(input.dose, unit, item.defaultUnit) !== null) {
      deduct = { amount: input.dose, unit };
    } else {
      warnings.push({
        code: 'STOCK_NOT_DEDUCTED',
        message: `The dose was saved, but ${item.displayName} is counted in ${item.defaultUnit}, so nothing was taken off stock. Adjust it on the inventory page.`
      });
    }
  }
  return {
    stockItemId: item.id,
    productPluginId,
    productName,
    stockProductText: JSON.stringify(stockProductTexts(item)),
    deduct,
    warnings
  };
}

/** Takes the dose off stock inside the record's transaction. A shortfall or
 *  a failure is a warning, never a reason to refuse the treatment. */
export function deductHealthStock(
  plan: StockPlan,
  ctx: { eventId: string; performedById: string | null; occurredAt: number }
): RecordWarning[] {
  if (!plan.stockItemId || !plan.deduct) return [];
  const { stockItemId, deduct } = plan;
  const res = bestEffort(() =>
    decrementForUse({
      stockItemId,
      amount: deduct.amount,
      unit: deduct.unit,
      reason: 'animal-treatment',
      performedById: ctx.performedById ?? undefined,
      occurredAt: ctx.occurredAt,
      notes: healthStockNote(ctx.eventId)
    })
  );
  if (!res.ok) {
    return [
      {
        code: 'STOCK_NOT_DEDUCTED',
        message: `The dose was saved, but stock was not updated: ${errorText(res.error)}`
      }
    ];
  }
  return res.value.shortfall > 0
    ? [
        {
          code: 'STOCK_SHORT',
          message: `Stock ran short by ${res.value.shortfall}. Check the lots on the inventory page.`
        }
      ]
    : [];
}
