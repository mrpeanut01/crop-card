/**
 * Phase 32C withdrawal rule (RULES_VERSION 0.6.0). Refuses to let meat,
 * milk or eggs be declared as food or sale while a treatment's withdrawal
 * runs, while its withdrawal is unknown, or ever after a drug on the
 * 21 CFR 530.41 prohibited list (prohibitedAnimalDrugs.ts). Treatments
 * always save; only the food declaration is blocked, and `discard` is
 * always accepted. Pure: no DB, env or clock reads. Callers do the
 * tenant-scoped reads and pass treatments, memberships and plugin data in.
 *
 * Rulings applied (docs/design/PHASE_32_PLAN.md, 32C): C-01 append-only
 * owner entries clear WITHDRAWAL_UNKNOWN per treatment and food; C-02 the
 * floor is max(label, every entry) and extra-label needs a vet; C-03 the
 * clock runs from the last dose and an open course is unknown; C-04 clear
 * times round up to the next farm-local midnight; C-05 `atMs` is when the
 * food was collected; C-06 backdated treatments flag saved logs; C-07 use
 * changes toward discard are never blocked; C-08 feed-to-animals and
 * unknown warn; C-09 the gate ignores the food_producing flag; C-10 the
 * food being logged picks the label class (milk means lactating, eggs
 * means laying, meat takes every class); C-11 any species, class or route
 * mismatch is unknown; C-12 doNotUseFor needs a vet entry; C-13 prohibited
 * drugs match by ingredient or free text, and only an on-label plugin use
 * exempts; C-14 prohibited holds are forever for members and joiners during
 * the course; C-15 group membership is time-aware; C-16 an individual
 * treatment never blocks a group's unnamed meat; C-17 slaughter and sale
 * for meat run the gate, and culled only when the meat is used; C-18 a
 * stored verdict can only lengthen a recomputed one; C-19 any event naming
 * a product carries a hold; C-26 only a deletion marked "never given"
 * drops a hold.
 */

import { matchProhibitedDrugs, type ProhibitedDrugEntry } from './prohibitedAnimalDrugs';
import { RULES_VERSION } from './version';

export const FOODS = ['meat', 'milk', 'eggs'] as const;
export type Food = (typeof FOODS)[number];

export const PRODUCTION_USES = ['food', 'sale', 'discard', 'feed-to-animals', 'unknown'] as const;
export type ProductionUse = (typeof PRODUCTION_USES)[number];

export const GATED_USES: readonly ProductionUse[] = ['food', 'sale'];
export const WARNED_USES: readonly ProductionUse[] = ['feed-to-animals', 'unknown'];

export const HEALTH_EVENT_KINDS = [
  'treatment',
  'vaccination',
  'deworm',
  'vet-visit',
  'injury',
  'note'
] as const;
export type HealthEventKind = (typeof HEALTH_EVENT_KINDS)[number];

export const HOLD_BEARING_KINDS: readonly HealthEventKind[] = [
  'treatment',
  'vaccination',
  'deworm'
];

export const LABEL_USE_DECLARATIONS = ['label', 'extra-label-vet', 'unknown'] as const;
export type LabelUseDeclaration = (typeof LABEL_USE_DECLARATIONS)[number];

export const LABEL_CLASSES = [
  'all',
  'lactating-dairy',
  'non-lactating-dairy',
  'laying',
  'non-laying',
  'veal-calves'
] as const;
export type LabelClass = (typeof LABEL_CLASSES)[number];

export const MEAT_DECLARATION_STATUSES = ['slaughtered', 'sold-for-meat'] as const;

export const DEFAULT_FARM_TIME_ZONE = 'America/New_York';

export const WITHDRAWAL_REASONS = [
  'PROHIBITED_DRUG',
  'WITHDRAWAL_UNKNOWN',
  'WITHDRAWAL_ACTIVE'
] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];

export const MAX_ENTRY_DAYS = 3650;
export const MAX_ENTRY_HOURS = MAX_ENTRY_DAYS * 24;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_TIME_MS = 8.64e15 - 3 * DAY_MS;

export interface LabelWithdrawalData {
  meatDays?: number;
  milkHours?: number;
  eggsDays?: number;
  doNotUseFor?: readonly Food[];
}

export interface LabelUseData {
  speciesId: string;
  class?: LabelClass;
  routes?: readonly string[];
  withdrawal?: LabelWithdrawalData;
}

/** The part of an animal-health plugin the kernel reads. `AnimalHealthPlugin`
 *  from the plugin schema is assignable to it. */
export interface AnimalHealthProductData {
  pluginId: string;
  displayName?: string;
  activeIngredients: readonly { name: string }[];
  labelUses: readonly LabelUseData[];
}

export type PluginLookup = (pluginId: string) => AnimalHealthProductData | undefined;

interface EntryBase {
  enteredAtMs: number;
  enteredById?: string | null;
  /** The verdict recomputed when this entry was added, kept for audit so the
   *  record's own write-time verdict and rules version are never rewritten. */
  verdict?: WithdrawalClear;
}

export interface LabelWithdrawalEntry extends EntryBase {
  kind: 'label';
  food: Food;
  amount: number;
  unit: 'days' | 'hours';
  labelNamesSpeciesAndClass: boolean;
  labelSaysNone?: boolean;
}

export interface VetWithdrawalEntry extends EntryBase {
  kind: 'vet';
  food: Food;
  amount: number;
  unit: 'days' | 'hours';
  vetName: string;
  vetSaysNone?: boolean;
}

export interface CourseEndEntry extends EntryBase {
  kind: 'course-end';
  endedAtMs: number;
}

export interface ProductEntry extends EntryBase {
  kind: 'product';
  pluginId: string;
  onLabel: boolean;
}

/** One append-only owner entry, stored as a JSON array in
 *  `animal_health_events.vet_directed_withdrawal`. */
export type WithdrawalEntry =
  LabelWithdrawalEntry | VetWithdrawalEntry | CourseEndEntry | ProductEntry;

export interface TreatmentRecord {
  id: string;
  subjectType: 'animal' | 'group';
  subjectId: string;
  /** Species of the treated subject (one species per group, B-05). */
  speciesId: string;
  /** Sex of a treated individual; null for a group. */
  subjectSex?: string | null;
  kind: HealthEventKind;
  productPluginId: string | null;
  productName: string | null;
  /** Other names the dose went by: the stock bottle's name and its active
   *  ingredients (C-34). Only the prohibited-drug match reads them, so they
   *  can add a prohibition and never remove one (C-13). */
  productTexts?: readonly string[];
  route: string | null;
  labelUse: LabelUseDeclaration | null;
  administeredAtMs: number;
  courseEndAtMs: number | null;
  /** A multi-dose course whose end is not known yet. */
  courseOpen?: boolean;
  /** Parsed entries, or 'invalid' when the stored JSON could not be read. */
  entries: readonly WithdrawalEntry[] | 'invalid';
  /** Verdict stored at write time (C-18). */
  storedClear?: WithdrawalClear | null;
  /** Force-deleted through record_deletions (C-26). Only `dosed: false`
   *  ("this was never given") drops the hold. */
  deletion?: { dosed: boolean } | null;
  /** C-35: the product's label data when the dose was recorded (null: the
   *  library had no such product then). A later data change can only
   *  lengthen the hold: each food takes the longer of the two readings. */
  snapshotProduct?: AnimalHealthProductData | null;
}

export type UnknownWhy =
  | 'no-product'
  | 'no-plugin'
  | 'no-label-use'
  | 'no-value'
  | 'do-not-use'
  | 'extra-label'
  | 'label-use-unknown'
  | 'course-open'
  | 'entries-invalid'
  | 'stored-unreadable';

export type FoodHold =
  | { status: 'none' }
  | {
      status: 'until';
      clearsAtMs: number;
      exactClearsAtMs: number;
      source: 'label' | 'entry' | 'stored';
    }
  | { status: 'unknown'; why: UnknownWhy; labelPathOpen: boolean }
  | { status: 'prohibited'; cfr: string[]; drugs: string[] };

export interface WithdrawalClear {
  rulesVersion: string;
  treatmentId: string;
  lastDoseAtMs: number | null;
  product: string;
  foods: Record<Food, FoodHold>;
}

export interface GroupMembership {
  groupId: string;
  /** null = since before any record. */
  fromMs: number | null;
  /** null = still a member. */
  toMs: number | null;
}

export interface GroupMember {
  animalId: string;
  memberships: readonly GroupMembership[];
}

export type FoodSubject =
  | {
      type: 'animal';
      id: string;
      memberships: readonly GroupMembership[];
      /** Ignored by the gate (C-09); accepted so callers can pass it. */
      foodProducing?: boolean;
    }
  | {
      type: 'group';
      id: string;
      /** Groups this one split from, with the window it carries their
       *  treatments (a B-07 split ends the parent window at the split). */
      lineage?: readonly GroupMembership[];
      members: readonly GroupMember[];
      foodProducing?: boolean;
    };

export interface FoodUseInput {
  subject: FoodSubject;
  food: Food;
  use: ProductionUse;
  /** When the food was collected or the animal slaughtered (C-05). */
  atMs: number;
  treatments: readonly TreatmentRecord[];
  plugins: PluginLookup;
  timeZone?: string;
}

export type HoldVia = 'direct' | 'group' | 'member' | 'lineage';

export interface ActiveHold {
  treatmentId: string;
  product: string;
  via: HoldVia;
  animalId?: string;
  hold: Exclude<FoodHold, { status: 'none' }>;
}

export type FoodUseVerdict =
  | { status: 'safe'; food: Food; use: ProductionUse }
  | {
      status: 'warn' | 'block';
      reason: WithdrawalReason;
      food: Food;
      use: ProductionUse;
      clearsAtMs: number | null;
      products: string[];
      holds: ActiveHold[];
      message: string;
      resubmitAs?: 'discard';
    };

const LOCAL_KEY_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function resolveTimeZone(timeZone: string | undefined): string {
  const tz = timeZone ?? DEFAULT_FARM_TIME_ZONE;
  try {
    localKeyFormatter(tz);
    return tz;
  } catch {
    return DEFAULT_FARM_TIME_ZONE;
  }
}

function localKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = LOCAL_KEY_FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      era: 'short'
    });
    LOCAL_KEY_FORMATTERS.set(timeZone, f);
  }
  return f;
}

/** Local calendar date as a sortable number (year × 10000 + month × 100 + day). */
export function localDateKey(ms: number, timeZone: string): number {
  let year = 0;
  let month = 0;
  let day = 0;
  let bc = false;
  for (const part of localKeyFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'era') bc = part.value.startsWith('B');
  }
  return (bc ? 1 - year : year) * 10000 + month * 100 + day;
}

function firstInstantAfterKey(loMs: number, hiMs: number, key: number, timeZone: string): number {
  let lo = loMs;
  let hi = hiMs;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDateKey(mid, timeZone) > key) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** C-04: the first farm-local midnight at or after `ms`. Rounding up can
 *  only lengthen a hold; DST-safe because it searches Intl local dates. */
export function roundUpToLocalMidnight(ms: number, timeZone?: string): number {
  if (!Number.isFinite(ms) || ms >= MAX_TIME_MS || ms <= -MAX_TIME_MS) return ms;
  const tz = resolveTimeZone(timeZone);
  const key = localDateKey(ms, tz);
  if (localDateKey(ms - 1, tz) < key) return ms;
  return firstInstantAfterKey(ms, ms + 50 * HOUR_MS, key, tz);
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** First instant of a farm-local calendar date (YYYY-MM-DD). */
export function localDayStartMs(ymd: string, timeZone?: string): number | null {
  const parsed = parseYmd(ymd);
  if (!parsed) return null;
  const tz = resolveTimeZone(timeZone);
  const utcMidnight = Date.UTC(parsed.y, parsed.m - 1, parsed.d);
  const key = parsed.y * 10000 + parsed.m * 100 + parsed.d;
  return firstInstantAfterKey(utcMidnight - 30 * HOUR_MS, utcMidnight + 30 * HOUR_MS, key - 1, tz);
}

/** C-03: a date-only course end or dose is read as 23:59 farm-local. */
export function endOfLocalDateMs(ymd: string, timeZone?: string): number | null {
  const parsed = parseYmd(ymd);
  if (!parsed) return null;
  const next = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d + 1));
  const nextYmd = next.toISOString().slice(0, 10);
  const start = localDayStartMs(nextYmd, timeZone);
  return start === null ? null : start - 60_000;
}

export function carriesHold(
  t: Pick<TreatmentRecord, 'kind' | 'productPluginId' | 'productName' | 'deletion'>
): boolean {
  if (t.deletion && t.deletion.dosed === false) return false;
  if (hasProductIdentity(t)) return true;
  return HOLD_BEARING_KINDS.includes(t.kind);
}

function hasProductIdentity(t: Pick<TreatmentRecord, 'productPluginId' | 'productName'>): boolean {
  return Boolean(t.productPluginId?.trim()) || Boolean(t.productName?.trim());
}

function entriesOf(t: TreatmentRecord): readonly WithdrawalEntry[] {
  return t.entries === 'invalid' ? [] : t.entries;
}

function latestProductEntry(t: TreatmentRecord): ProductEntry | null {
  let best: ProductEntry | null = null;
  for (const e of entriesOf(t)) {
    if (e.kind !== 'product') continue;
    if (!best || e.enteredAtMs >= best.enteredAtMs) best = e;
  }
  return best;
}

export function effectiveProduct(t: TreatmentRecord): {
  pluginId: string | null;
  labelUse: LabelUseDeclaration | null;
} {
  const pe = latestProductEntry(t);
  if (pe) return { pluginId: pe.pluginId, labelUse: pe.onLabel ? 'label' : 'unknown' };
  return { pluginId: t.productPluginId?.trim() || null, labelUse: t.labelUse };
}

/** C-03: the last dose. An open course with no recorded end has none. */
export function lastDoseAtMs(t: TreatmentRecord): number | null {
  const ends = entriesOf(t)
    .filter((e): e is CourseEndEntry => e.kind === 'course-end')
    .map((e) => e.endedAtMs)
    .filter((ms) => Number.isFinite(ms));
  if (t.courseOpen && ends.length === 0) return null;
  let last = t.administeredAtMs;
  if (t.courseEndAtMs !== null && Number.isFinite(t.courseEndAtMs)) {
    last = Math.max(last, t.courseEndAtMs);
  }
  for (const end of ends) last = Math.max(last, end);
  return last;
}

function productLabel(t: TreatmentRecord, plugin: AnimalHealthProductData | undefined): string {
  return (
    t.productName?.trim() ||
    plugin?.displayName?.trim() ||
    t.productPluginId?.trim() ||
    'an unnamed product'
  );
}

const CLASSES_FOR_FOOD: Record<Food, readonly LabelClass[] | 'any'> = {
  meat: 'any',
  milk: ['all', 'lactating-dairy'],
  eggs: ['all', 'laying']
};

function routeMatches(use: LabelUseData, route: string | null): boolean {
  if (!use.routes || use.routes.length === 0) return true;
  return route !== null && use.routes.includes(route);
}

function classMatches(use: LabelUseData, food: Food): boolean {
  const allowed = CLASSES_FOR_FOOD[food];
  if (allowed === 'any') return true;
  return allowed.includes(use.class ?? 'all');
}

function labelValueMs(w: LabelWithdrawalData | undefined, food: Food): number | undefined {
  if (!w) return undefined;
  const v = food === 'meat' ? w.meatDays : food === 'milk' ? w.milkHours : w.eggsDays;
  if (v === undefined || !Number.isFinite(v) || v < 0) return undefined;
  return food === 'milk' ? v * HOUR_MS : v * DAY_MS;
}

interface LabelReading {
  labelMs?: number;
  why?: UnknownWhy;
  labelPathOpen: boolean;
  resolvedByLabel: boolean;
}

function readLabel(
  plugin: AnimalHealthProductData | undefined,
  speciesId: string,
  route: string | null,
  labelUse: LabelUseDeclaration | null,
  food: Food
): LabelReading {
  const extraLabel = labelUse === 'extra-label-vet';
  if (!plugin) {
    return extraLabel
      ? { why: 'extra-label', labelPathOpen: false, resolvedByLabel: false }
      : { why: 'no-plugin', labelPathOpen: true, resolvedByLabel: false };
  }
  const candidates = plugin.labelUses.filter(
    (u) => u.speciesId === speciesId && routeMatches(u, route) && classMatches(u, food)
  );
  if (candidates.length === 0) {
    return { why: 'no-label-use', labelPathOpen: false, resolvedByLabel: false };
  }
  if (candidates.some((u) => (u.withdrawal?.doNotUseFor ?? []).includes(food))) {
    return { why: 'do-not-use', labelPathOpen: false, resolvedByLabel: false };
  }
  const values = candidates
    .map((u) => labelValueMs(u.withdrawal, food))
    .filter((v): v is number => v !== undefined);
  const labelMs = values.length > 0 ? Math.max(...values) : undefined;
  if (extraLabel)
    return { labelMs, why: 'extra-label', labelPathOpen: false, resolvedByLabel: false };
  if (labelMs === undefined)
    return { why: 'no-value', labelPathOpen: true, resolvedByLabel: false };
  if (labelUse !== 'label') {
    return { labelMs, why: 'label-use-unknown', labelPathOpen: true, resolvedByLabel: false };
  }
  return { labelMs, labelPathOpen: true, resolvedByLabel: true };
}

function labelReadingFor(
  t: TreatmentRecord,
  plugin: AnimalHealthProductData | undefined,
  labelUse: LabelUseDeclaration | null,
  food: Food
): LabelReading {
  if (!hasProductIdentity(t) && latestProductEntry(t) === null) {
    return { why: 'no-product', labelPathOpen: false, resolvedByLabel: false };
  }
  return readLabel(plugin, t.speciesId, t.route, labelUse, food);
}

function entryMs(e: LabelWithdrawalEntry | VetWithdrawalEntry): number | undefined {
  if (!Number.isFinite(e.amount) || e.amount < 0) return undefined;
  if (e.unit === 'hours') return e.amount > MAX_ENTRY_HOURS ? undefined : e.amount * HOUR_MS;
  if (e.unit === 'days') return e.amount > MAX_ENTRY_DAYS ? undefined : e.amount * DAY_MS;
  return undefined;
}

function vetEntryResolves(e: VetWithdrawalEntry): boolean {
  if (!e.vetName || e.vetName.trim().length === 0) return false;
  const ms = entryMs(e);
  if (ms === undefined) return false;
  return ms > 0 || e.vetSaysNone === true;
}

function labelEntryResolves(e: LabelWithdrawalEntry, labelPathOpen: boolean): boolean {
  if (!labelPathOpen || e.labelNamesSpeciesAndClass !== true) return false;
  const ms = entryMs(e);
  if (ms === undefined) return false;
  return ms > 0 || e.labelSaysNone === true;
}

function prohibitedMatches(t: TreatmentRecord, lookup: PluginLookup): ProhibitedDrugEntry[] {
  const texts: string[] = [];
  const push = (s: string | null | undefined) => {
    if (s && s.trim()) texts.push(s);
  };
  push(t.productName);
  push(t.productPluginId);
  for (const text of t.productTexts ?? []) push(text);
  const original = t.productPluginId ? lookup(t.productPluginId) : undefined;
  if (original) {
    push(original.displayName);
    for (const ai of original.activeIngredients) push(ai.name);
  }
  for (const e of entriesOf(t)) {
    if (e.kind !== 'product') continue;
    push(e.pluginId);
    const p = lookup(e.pluginId);
    if (p) {
      push(p.displayName);
      for (const ai of p.activeIngredients) push(ai.name);
    }
  }
  return matchProhibitedDrugs({
    speciesId: t.speciesId,
    sex: t.subjectSex,
    texts
  });
}

/** C-11, C-13: an on-label plugin use exempts a prohibited match only for a
 *  food whose label class that use covers, on the same species and route. */
function onLabelExempts(
  entry: ProhibitedDrugEntry,
  t: TreatmentRecord,
  plugin: AnimalHealthProductData | undefined,
  labelUse: LabelUseDeclaration | null,
  food: Food
): boolean {
  if (!entry.onLabelExempt || !plugin || labelUse !== 'label') return false;
  const pluginIsDrug = matchProhibitedDrugs({
    speciesId: t.speciesId,
    sex: t.subjectSex,
    texts: [plugin.pluginId, plugin.displayName, ...plugin.activeIngredients.map((a) => a.name)]
  }).some((m) => m.id === entry.id);
  if (!pluginIsDrug) return false;
  return plugin.labelUses.some(
    (u) => u.speciesId === t.speciesId && routeMatches(u, t.route) && classMatches(u, food)
  );
}

function prohibitedForFood(
  matches: readonly ProhibitedDrugEntry[],
  t: TreatmentRecord,
  plugins: PluginLookup,
  food: Food
): ProhibitedDrugEntry[] {
  const eff = effectiveProduct(t);
  const effPlugin = eff.pluginId ? plugins(eff.pluginId) : undefined;
  return matches.filter((entry) => !onLabelExempts(entry, t, effPlugin, eff.labelUse, food));
}

const NONE: FoodHold = { status: 'none' };

/**
 * The hold one treatment puts on each food. Holds are computed for every
 * treatment and every food, whatever the subject's food flag (C-09).
 */
export function computeWithdrawalClear(
  treatment: TreatmentRecord,
  plugins: PluginLookup,
  options: { timeZone?: string } = {}
): WithdrawalClear {
  const current = computeClearWith(treatment, plugins, options);
  if (treatment.snapshotProduct === undefined || latestProductEntry(treatment) !== null) {
    return current;
  }
  const pluginId = effectiveProduct(treatment).pluginId;
  if (!pluginId) return current;
  const snap = treatment.snapshotProduct;
  if (JSON.stringify(snap ?? null) === JSON.stringify(plugins(pluginId) ?? null)) return current;
  const snapshot = computeClearWith(
    treatment,
    (id) => (id === pluginId ? (snap ?? undefined) : plugins(id)),
    options
  );
  const foods = {} as Record<Food, FoodHold>;
  for (const food of FOODS) foods[food] = longerHold(current.foods[food], snapshot.foods[food]);
  return { ...current, foods };
}

const HOLD_RANK: Record<FoodHold['status'], number> = {
  none: 0,
  until: 1,
  unknown: 2,
  prohibited: 3
};

/** C-35: the longer of two readings of one hold. */
export function longerHold(a: FoodHold, b: FoodHold): FoodHold {
  if (a.status === 'prohibited' && b.status === 'prohibited') {
    return {
      status: 'prohibited',
      cfr: [...new Set([...a.cfr, ...b.cfr])],
      drugs: [...new Set([...a.drugs, ...b.drugs])]
    };
  }
  if (a.status === 'until' && b.status === 'until') {
    return b.clearsAtMs > a.clearsAtMs ? b : a;
  }
  return HOLD_RANK[b.status] > HOLD_RANK[a.status] ? b : a;
}

function computeClearWith(
  treatment: TreatmentRecord,
  plugins: PluginLookup,
  options: { timeZone?: string }
): WithdrawalClear {
  const tz = resolveTimeZone(options.timeZone);
  const eff = effectiveProduct(treatment);
  const plugin = eff.pluginId ? plugins(eff.pluginId) : undefined;
  const base = {
    rulesVersion: RULES_VERSION,
    treatmentId: treatment.id,
    product: productLabel(treatment, plugin)
  };
  if (!carriesHold(treatment)) {
    return {
      ...base,
      lastDoseAtMs: lastDoseAtMs(treatment),
      foods: { meat: NONE, milk: NONE, eggs: NONE }
    };
  }

  const matches = prohibitedMatches(treatment, plugins);
  const noProductEntry = latestProductEntry(treatment) === null;
  const last = lastDoseAtMs(treatment);
  const foods = {} as Record<Food, FoodHold>;
  for (const food of FOODS) {
    const prohibited = prohibitedForFood(matches, treatment, plugins, food);
    const stored = treatment.storedClear?.foods[food];
    const storedSticks = noProductEntry && stored?.status === 'prohibited';
    if (prohibited.length > 0 || storedSticks) {
      const storedCfr = storedSticks && stored?.status === 'prohibited' ? stored.cfr : [];
      const storedDrugs = storedSticks && stored?.status === 'prohibited' ? stored.drugs : [];
      foods[food] = {
        status: 'prohibited',
        cfr: [...new Set([...prohibited.map((p) => p.cfr), ...storedCfr])],
        drugs: [...new Set([...prohibited.map((p) => p.label), ...storedDrugs])]
      };
      continue;
    }
    let hold = mergeStored(
      holdForFood(treatment, plugin, eff.labelUse, food, last, tz),
      treatment.storedClear?.foods[food]
    );
    for (const e of entriesOf(treatment)) hold = mergeStored(hold, e.verdict?.foods[food]);
    foods[food] = hold;
  }
  return { ...base, lastDoseAtMs: last, foods };
}

function holdForFood(
  t: TreatmentRecord,
  plugin: AnimalHealthProductData | undefined,
  labelUse: LabelUseDeclaration | null,
  food: Food,
  last: number | null,
  tz: string
): FoodHold {
  if (t.entries === 'invalid')
    return { status: 'unknown', why: 'entries-invalid', labelPathOpen: false };
  const reading = labelReadingFor(t, plugin, labelUse, food);
  const foodEntries = t.entries.filter(
    (e): e is LabelWithdrawalEntry | VetWithdrawalEntry =>
      (e.kind === 'label' || e.kind === 'vet') && e.food === food
  );
  const entryDurations = foodEntries.map(entryMs).filter((v): v is number => v !== undefined);
  const resolvedByEntry = foodEntries.some((e) =>
    e.kind === 'vet' ? vetEntryResolves(e) : labelEntryResolves(e, reading.labelPathOpen)
  );
  if (!reading.resolvedByLabel && !resolvedByEntry) {
    return {
      status: 'unknown',
      why: reading.why ?? 'no-value',
      labelPathOpen: reading.labelPathOpen
    };
  }
  if (last === null) return { status: 'unknown', why: 'course-open', labelPathOpen: false };
  const durations = [...entryDurations];
  if (reading.labelMs !== undefined) durations.push(reading.labelMs);
  const duration = durations.length > 0 ? Math.max(...durations) : 0;
  const exact = Math.min(last + duration, MAX_TIME_MS);
  const entryWins =
    entryDurations.length > 0 &&
    (reading.labelMs === undefined || Math.max(...entryDurations) > reading.labelMs);
  return {
    status: 'until',
    clearsAtMs: roundUpToLocalMidnight(exact, tz),
    exactClearsAtMs: exact,
    source: entryWins ? 'entry' : 'label'
  };
}

/** C-18: a stored verdict can only lengthen a recomputed one. That holds
 *  for the record's write-time verdict and for the verdict saved with each
 *  owner entry, so a later entry (a second product pick, say) can never
 *  shorten a date an earlier one set. A stored unknown yields to a
 *  recompute, since only sourced data or an owner entry can resolve it. */
function mergeStored(recomputed: FoodHold, stored: FoodHold | undefined): FoodHold {
  if (!stored || stored.status !== 'until') return recomputed;
  if (recomputed.status !== 'until') return recomputed;
  if (!Number.isFinite(stored.clearsAtMs) || stored.clearsAtMs <= recomputed.clearsAtMs) {
    return recomputed;
  }
  return {
    status: 'until',
    clearsAtMs: stored.clearsAtMs,
    exactClearsAtMs: Math.max(recomputed.exactClearsAtMs, stored.exactClearsAtMs),
    source: 'stored'
  };
}

function exposureEnd(t: TreatmentRecord, hold: FoodHold, clear: WithdrawalClear): number {
  if (hold.status === 'until') return hold.clearsAtMs;
  if (hold.status === 'prohibited') {
    return clear.lastDoseAtMs === null ? Number.POSITIVE_INFINITY : clear.lastDoseAtMs;
  }
  return Number.POSITIVE_INFINITY;
}

function overlaps(
  m: GroupMembership,
  startMs: number,
  endMs: number,
  inclusiveEnd: boolean
): boolean {
  const from = m.fromMs ?? Number.NEGATIVE_INFINITY;
  const to = m.toMs ?? Number.POSITIVE_INFINITY;
  const joinedBeforeEnd = inclusiveEnd ? from <= endMs : from < endMs;
  return joinedBeforeEnd && to >= startMs;
}

function holdActiveAt(t: TreatmentRecord, hold: FoodHold, atMs: number): boolean {
  if (hold.status === 'none') return false;
  if (atMs < t.administeredAtMs) return false;
  if (hold.status === 'until') return atMs < hold.clearsAtMs;
  return true;
}

function memberAt(memberships: readonly GroupMembership[], groupId: string, atMs: number): boolean {
  return memberships.some(
    (m) =>
      m.groupId === groupId &&
      (m.fromMs ?? Number.NEGATIVE_INFINITY) <= atMs &&
      (m.toMs === null || m.toMs > atMs)
  );
}

interface Ctx {
  food: Food;
  atMs: number;
  treatments: readonly TreatmentRecord[];
  clears: Map<string, WithdrawalClear>;
}

function clearFor(
  ctx: Ctx,
  t: TreatmentRecord,
  plugins: PluginLookup,
  tz: string
): WithdrawalClear {
  let c = ctx.clears.get(t.id);
  if (!c) {
    c = computeWithdrawalClear(t, plugins, { timeZone: tz });
    ctx.clears.set(t.id, c);
  }
  return c;
}

function groupTreatmentReaches(
  t: TreatmentRecord,
  clear: WithdrawalClear,
  hold: FoodHold,
  memberships: readonly GroupMembership[]
): boolean {
  const end = exposureEnd(t, hold, clear);
  const inclusive = hold.status === 'prohibited';
  return memberships.some(
    (m) => m.groupId === t.subjectId && overlaps(m, t.administeredAtMs, end, inclusive)
  );
}

function collectForAnimal(
  animalId: string,
  memberships: readonly GroupMembership[],
  ctx: Ctx,
  plugins: PluginLookup,
  tz: string,
  viaAnimal: 'direct' | 'member',
  out: Map<string, ActiveHold>
): void {
  for (const t of ctx.treatments) {
    if (!carriesHold(t) || out.has(t.id)) continue;
    const clear = clearFor(ctx, t, plugins, tz);
    const hold = clear.foods[ctx.food];
    if (hold.status === 'none' || !holdActiveAt(t, hold, ctx.atMs)) continue;
    if (t.subjectType === 'animal' && t.subjectId === animalId) {
      out.set(t.id, { treatmentId: t.id, product: clear.product, via: viaAnimal, animalId, hold });
    } else if (t.subjectType === 'group' && groupTreatmentReaches(t, clear, hold, memberships)) {
      out.set(t.id, {
        treatmentId: t.id,
        product: clear.product,
        via: viaAnimal === 'direct' ? 'group' : 'member',
        animalId,
        hold
      });
    }
  }
}

/** Every hold that reaches this subject's food at `atMs` (C-14, C-15, C-16). */
export function activeHolds(input: Omit<FoodUseInput, 'use'>): ActiveHold[] {
  const tz = resolveTimeZone(input.timeZone);
  const ctx: Ctx = {
    food: input.food,
    atMs: input.atMs,
    treatments: input.treatments,
    clears: new Map()
  };
  const out = new Map<string, ActiveHold>();
  const subject = input.subject;
  if (subject.type === 'animal') {
    collectForAnimal(subject.id, subject.memberships, ctx, input.plugins, tz, 'direct', out);
    return [...out.values()];
  }
  for (const t of input.treatments) {
    if (!carriesHold(t) || t.subjectType !== 'group') continue;
    const clear = clearFor(ctx, t, input.plugins, tz);
    const hold = clear.foods[input.food];
    if (hold.status === 'none' || !holdActiveAt(t, hold, input.atMs)) continue;
    if (t.subjectId === subject.id) {
      out.set(t.id, { treatmentId: t.id, product: clear.product, via: 'direct', hold });
    } else if (groupTreatmentReaches(t, clear, hold, subject.lineage ?? [])) {
      out.set(t.id, { treatmentId: t.id, product: clear.product, via: 'lineage', hold });
    }
  }
  if (input.food !== 'meat') {
    for (const member of subject.members) {
      if (!memberAt(member.memberships, subject.id, input.atMs)) continue;
      collectForAnimal(member.animalId, member.memberships, ctx, input.plugins, tz, 'member', out);
    }
  }
  return [...out.values()];
}

/** How sure a hold is: a known clear date, an unknown withdrawal (an owner
 *  entry or sourced data can resolve it), or a prohibited drug (never). */
export type HoldSpanBasis = 'known' | 'unknown' | 'prohibited';

/** One stretch of time a treatment holds a food: `[fromMs, toMs)`, with
 *  `toMs` infinite for an unknown or prohibited hold. */
export interface HoldSpan {
  treatmentId: string;
  fromMs: number;
  toMs: number;
  basis: HoldSpanBasis;
}

function spanOf(t: TreatmentRecord, hold: FoodHold): HoldSpan | null {
  if (hold.status === 'none') return null;
  const toMs = hold.status === 'until' ? hold.clearsAtMs : Number.POSITIVE_INFINITY;
  if (!(toMs > t.administeredAtMs)) return null;
  const basis: HoldSpanBasis =
    hold.status === 'until' ? 'known' : hold.status === 'prohibited' ? 'prohibited' : 'unknown';
  return { treatmentId: t.id, fromMs: t.administeredAtMs, toMs, basis };
}

function spansForAnimal(
  animalId: string,
  memberships: readonly GroupMembership[],
  ctx: Omit<Ctx, 'atMs'>,
  plugins: PluginLookup,
  tz: string
): HoldSpan[] {
  const out: HoldSpan[] = [];
  for (const t of ctx.treatments) {
    if (!carriesHold(t)) continue;
    const clear = clearFor({ ...ctx, atMs: 0 }, t, plugins, tz);
    const hold = clear.foods[ctx.food];
    if (hold.status === 'none') continue;
    const direct = t.subjectType === 'animal' && t.subjectId === animalId;
    if (
      !direct &&
      !(t.subjectType === 'group' && groupTreatmentReaches(t, clear, hold, memberships))
    ) {
      continue;
    }
    const span = spanOf(t, hold);
    if (span) out.push(span);
  }
  return out;
}

/**
 * Every stretch of time in which `activeHolds` would find a hold on this
 * subject's food, without choosing a moment: the same reach rules (C-14,
 * C-15, C-16), computed once. `activeHolds(atMs)` is non-empty exactly
 * when some span contains `atMs` (property-tested), so the hold ledger can
 * compare a whole timeline before and after a write.
 */
export function treatmentHoldSpans(
  input: Omit<FoodUseInput, 'use' | 'atMs'>,
  /** Verdicts already computed for these treatments, by id; filled as it goes. */
  clears: Map<string, WithdrawalClear> = new Map()
): HoldSpan[] {
  const tz = resolveTimeZone(input.timeZone);
  const ctx = { food: input.food, treatments: input.treatments, clears };
  const subject = input.subject;
  if (subject.type === 'animal') {
    return spansForAnimal(subject.id, subject.memberships, ctx, input.plugins, tz);
  }
  const out: HoldSpan[] = [];
  for (const t of input.treatments) {
    if (!carriesHold(t) || t.subjectType !== 'group') continue;
    const clear = clearFor({ ...ctx, atMs: 0 }, t, input.plugins, tz);
    const hold = clear.foods[input.food];
    if (hold.status === 'none') continue;
    if (
      t.subjectId !== subject.id &&
      !groupTreatmentReaches(t, clear, hold, subject.lineage ?? [])
    ) {
      continue;
    }
    const span = spanOf(t, hold);
    if (span) out.push(span);
  }
  if (input.food !== 'meat') {
    for (const member of subject.members) {
      const windows = member.memberships.filter((m) => m.groupId === subject.id);
      if (windows.length === 0) continue;
      const own = spansForAnimal(member.animalId, member.memberships, ctx, input.plugins, tz);
      for (const s of own) {
        for (const w of windows) {
          const fromMs = Math.max(s.fromMs, w.fromMs ?? Number.NEGATIVE_INFINITY);
          const toMs = Math.min(s.toMs, w.toMs ?? Number.POSITIVE_INFINITY);
          if (toMs > fromMs) out.push({ ...s, fromMs, toMs });
        }
      }
    }
  }
  return out;
}

export interface ReachingDose {
  treatmentId: string;
  atMs: number;
  product: string;
}

function doseMoments(t: TreatmentRecord): number[] {
  const last = lastDoseAtMs(t);
  return last === null || last === t.administeredAtMs
    ? [t.administeredAtMs]
    : [t.administeredAtMs, last];
}

/**
 * The latest recorded dose that reached this subject's meat: its own
 * treatments, and group treatments while it was a member (or, for a
 * group, its own and its parents' before a split). A dose shows the animal
 * was alive then, so a slaughter or meat sale dated earlier cannot be true.
 * An individual treatment never counts for a group's unnamed animals (C-16).
 */
export function latestDoseReaching(
  subject: FoodSubject,
  treatments: readonly TreatmentRecord[]
): ReachingDose | null {
  let best: ReachingDose | null = null;
  const consider = (t: TreatmentRecord, atMs: number) => {
    if (!Number.isFinite(atMs)) return;
    if (!best || atMs > best.atMs) {
      best = { treatmentId: t.id, atMs, product: productLabel(t, undefined) };
    }
  };
  for (const t of treatments) {
    if (!carriesHold(t)) continue;
    for (const at of doseMoments(t)) {
      if (subject.type === 'animal') {
        if (t.subjectType === 'animal' && t.subjectId === subject.id) consider(t, at);
        else if (t.subjectType === 'group' && memberAt(subject.memberships, t.subjectId, at)) {
          consider(t, at);
        }
      } else if (t.subjectType === 'group') {
        if (t.subjectId === subject.id) consider(t, at);
        else if (memberAt(subject.lineage ?? [], t.subjectId, at)) consider(t, at);
      }
    }
  }
  return best;
}

function reasonFor(holds: readonly ActiveHold[]): WithdrawalReason {
  if (holds.some((h) => h.hold.status === 'prohibited')) return 'PROHIBITED_DRUG';
  if (holds.some((h) => h.hold.status === 'unknown')) return 'WITHDRAWAL_UNKNOWN';
  return 'WITHDRAWAL_ACTIVE';
}

function latestClear(holds: readonly ActiveHold[]): number | null {
  let latest = Number.NEGATIVE_INFINITY;
  for (const h of holds) {
    if (h.hold.status !== 'until') return null;
    latest = Math.max(latest, h.hold.clearsAtMs);
  }
  return Number.isFinite(latest) ? latest : null;
}

/**
 * The food gate. `food` and `sale` block during any hold, with no
 * override; the caller can resubmit as `discard`, which always saves.
 * `feed-to-animals` and `unknown` warn (C-08).
 */
export function evaluateFoodUse(input: FoodUseInput): FoodUseVerdict {
  const { food, use } = input;
  if (use === 'discard') return { status: 'safe', food, use };
  const holds = activeHolds(input);
  if (holds.length === 0) return { status: 'safe', food, use };
  const reason = reasonFor(holds);
  const clearsAtMs = reason === 'WITHDRAWAL_ACTIVE' ? latestClear(holds) : null;
  const products = [...new Set(holds.map((h) => h.product))];
  const tz = resolveTimeZone(input.timeZone);
  const gated = GATED_USES.includes(use);
  return {
    status: gated ? 'block' : 'warn',
    reason,
    food,
    use,
    clearsAtMs,
    products,
    holds,
    message: holdMessage(reason, food, use, clearsAtMs, products, holds, tz),
    ...(gated ? { resubmitAs: 'discard' as const } : {})
  };
}

const FOOD_NOUN: Record<Food, { these: string; plain: string }> = {
  meat: { these: 'This meat', plain: 'meat' },
  milk: { these: 'This milk', plain: 'milk' },
  eggs: { these: 'These eggs', plain: 'eggs' }
};

const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function formatClearDate(ms: number, timeZone?: string): string {
  const tz = resolveTimeZone(timeZone);
  let f = DATE_FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    DATE_FORMATTERS.set(tz, f);
  }
  return f.format(new Date(ms));
}

function listProducts(products: readonly string[]): string {
  if (products.length <= 1) return products[0] ?? 'a treatment';
  return `${products.slice(0, -1).join(', ')} and ${products[products.length - 1]}`;
}

function holdMessage(
  reason: WithdrawalReason,
  food: Food,
  use: ProductionUse,
  clearsAtMs: number | null,
  products: readonly string[],
  holds: readonly ActiveHold[],
  tz: string
): string {
  const noun = FOOD_NOUN[food];
  const named = listProducts(products);
  if (use === 'feed-to-animals') {
    return `${noun.these} came from an animal still on hold for ${named}. Only feed it to animals that are not used for food.`;
  }
  if (use === 'unknown') {
    return `${noun.these} came from an animal still on hold for ${named}. Nobody may eat or sell them during the hold. Save them as discarded if you are not sure.`;
  }
  if (reason === 'PROHIBITED_DRUG') {
    const cfr = [
      ...new Set(holds.flatMap((h) => (h.hold.status === 'prohibited' ? h.hold.cfr : [])))
    ].join(', ');
    return `${named} is a drug US law bans from extra-label use in food animals (${cfr}). ${noun.these} can never be used for food or sold. Save as discarded instead.`;
  }
  if (reason === 'WITHDRAWAL_UNKNOWN') {
    const step = withdrawalNextStep(holds);
    if (step === 'contact-support') {
      return `The withdrawal records for ${named} can't be read, so ${noun.plain} can't be used for food or sold yet. Ask your vet for the withdrawal time and contact support. Save as discarded instead.`;
    }
    if (step === 'last-dose') {
      return `The last dose of ${named} is not on record, so ${noun.plain} can't be used for food or sold yet. The owner can record when the last dose was given. Save as discarded instead.`;
    }
    const alsoLastDose = holds.some(
      (h) => h.hold.status === 'unknown' && h.hold.why === 'course-open'
    );
    return alsoLastDose
      ? `We don't know the withdrawal time for ${named}, so ${noun.plain} can't be used for food or sold yet. The owner can add it from the label or the vet and record when the last dose was given. Save as discarded instead.`
      : `We don't know the withdrawal time for ${named}, so ${noun.plain} can't be used for food or sold yet. The owner can add it from the label or the vet. Save as discarded instead.`;
  }
  const date = clearsAtMs === null ? 'the hold ends' : formatClearDate(clearsAtMs, tz);
  return `${noun.these} can't be used for food or sold until ${date}, because ${named} is still in its withdrawal time. Save as discarded instead.`;
}

/** What resolves an unknown hold: the last dose of an open course, a
 *  withdrawal from the label or the vet, or (for entries that cannot be
 *  read) the vet and support, since no new entry can be added. */
export type WithdrawalNextStep = 'last-dose' | 'add-withdrawal' | 'contact-support';

export function withdrawalNextStep(holds: readonly ActiveHold[]): WithdrawalNextStep | null {
  const whys = holds.flatMap((h) => (h.hold.status === 'unknown' ? [h.hold.why] : []));
  if (whys.length === 0) return null;
  if (whys.includes('entries-invalid')) return 'contact-support';
  if (whys.every((w) => w === 'course-open')) return 'last-dose';
  return 'add-withdrawal';
}

export type FoodHoldSummary =
  | { status: 'clear' }
  | { status: 'hold'; clearsAtMs: number; products: string[] }
  | { status: 'unknown'; products: string[] }
  | { status: 'prohibited'; products: string[]; cfr: string[] };

/** C-33: one chip per food for the animal and group pages. */
export function summarizeHolds(
  input: Omit<FoodUseInput, 'use' | 'food'>
): Record<Food, FoodHoldSummary> {
  const out = {} as Record<Food, FoodHoldSummary>;
  for (const food of FOODS) {
    const v = evaluateFoodUse({ ...input, food, use: 'food' });
    if (v.status === 'safe') out[food] = { status: 'clear' };
    else if (v.reason === 'PROHIBITED_DRUG') {
      const cfr = [
        ...new Set(v.holds.flatMap((h) => (h.hold.status === 'prohibited' ? h.hold.cfr : [])))
      ];
      out[food] = { status: 'prohibited', products: v.products, cfr };
    } else if (v.reason === 'WITHDRAWAL_UNKNOWN')
      out[food] = { status: 'unknown', products: v.products };
    else
      out[food] = {
        status: 'hold',
        clearsAtMs: v.clearsAtMs ?? Number.POSITIVE_INFINITY,
        products: v.products
      };
  }
  return out;
}

/** C-07: a use change toward discard is never gated; anything else runs
 *  the gate. */
export function isSaferUseChange(from: ProductionUse, to: ProductionUse): boolean {
  return from === to || to === 'discard';
}

/** C-17: which status changes declare meat as food. */
export function isMeatDeclaration(status: string, meatUsed?: boolean): boolean {
  if ((MEAT_DECLARATION_STATUSES as readonly string[]).includes(status)) return true;
  return (status === 'culled' || status === 'sold' || status === 'died') && meatUsed === true;
}

export interface SavedProductionLog {
  id: string;
  food: Food;
  use: ProductionUse;
  occurredAtMs: number;
  subject: FoodSubject;
}

/** C-06: saved food or sale logs a newly recorded (often backdated)
 *  treatment now covers. The logs are never rewritten; the owner is told. */
export function logsCoveredByHolds(
  logs: readonly SavedProductionLog[],
  treatments: readonly TreatmentRecord[],
  plugins: PluginLookup,
  timeZone?: string
): SavedProductionLog[] {
  return logs.filter((log) => {
    if (!GATED_USES.includes(log.use)) return false;
    return (
      evaluateFoodUse({
        subject: log.subject,
        food: log.food,
        use: log.use,
        atMs: log.occurredAtMs,
        treatments,
        plugins,
        timeZone
      }).status === 'block'
    );
  });
}

export type EntryRefusal =
  | 'OWNER_ONLY'
  | 'INVALID_VALUE'
  | 'ZERO_NOT_CONFIRMED'
  | 'LABEL_NOT_CONFIRMED'
  | 'LABEL_PATH_CLOSED'
  | 'VET_NAME_REQUIRED'
  | 'COURSE_END_BEFORE_START'
  | 'COURSE_END_EARLIER'
  | 'NO_HOLD'
  | 'UNKNOWN_PLUGIN';

export type EntryCheck = { ok: true } | { ok: false; code: EntryRefusal; message: string };

const REFUSAL_COPY: Record<EntryRefusal, string> = {
  OWNER_ONLY: 'Only the owner can add a withdrawal. Ask the owner.',
  INVALID_VALUE: `Enter a whole number of days or hours, up to ${MAX_ENTRY_DAYS} days.`,
  ZERO_NOT_CONFIRMED: 'To record no withdrawal, choose "The label says no withdrawal".',
  LABEL_NOT_CONFIRMED:
    "Confirm that the label names this species and class, or add the vet's withdrawal instead.",
  LABEL_PATH_CLOSED:
    'The label does not cover this use. Only a withdrawal from your vet can clear it.',
  VET_NAME_REQUIRED: "Add the vet's name.",
  COURSE_END_BEFORE_START: 'The last dose cannot be before the first dose.',
  COURSE_END_EARLIER:
    'The last dose can only move later. Delete and re-enter the treatment if the date was wrong.',
  NO_HOLD: 'This record has no product, so it has no withdrawal.',
  UNKNOWN_PLUGIN: 'That product is not in the library.'
};

function refuse(code: EntryRefusal): EntryCheck {
  return { ok: false, code, message: REFUSAL_COPY[code] };
}

/** C-01, C-02, C-03, C-13: whether an owner may append this entry. The
 *  kernel re-applies the same rules when it reads entries back. */
export function checkWithdrawalEntry(
  entry: WithdrawalEntry,
  treatment: TreatmentRecord,
  plugins: PluginLookup,
  actorRole: 'owner' | 'helper' | 'inspector' | string
): EntryCheck {
  if (actorRole !== 'owner') return refuse('OWNER_ONLY');
  if (entry.kind === 'course-end') {
    if (!Number.isFinite(entry.endedAtMs)) return refuse('INVALID_VALUE');
    if (entry.endedAtMs < treatment.administeredAtMs) return refuse('COURSE_END_BEFORE_START');
    const current = lastDoseAtMs(treatment);
    if (current !== null && entry.endedAtMs < current) return refuse('COURSE_END_EARLIER');
    return { ok: true };
  }
  if (entry.kind === 'product') {
    return plugins(entry.pluginId) ? { ok: true } : refuse('UNKNOWN_PLUGIN');
  }
  if (!carriesHold(treatment)) return refuse('NO_HOLD');
  const ms = entryMs(entry);
  if (ms === undefined || !Number.isInteger(entry.amount)) return refuse('INVALID_VALUE');
  if (entry.kind === 'vet') {
    if (!entry.vetName || entry.vetName.trim().length === 0) return refuse('VET_NAME_REQUIRED');
    if (ms === 0 && entry.vetSaysNone !== true) return refuse('ZERO_NOT_CONFIRMED');
    return { ok: true };
  }
  const eff = effectiveProduct(treatment);
  const plugin = eff.pluginId ? plugins(eff.pluginId) : undefined;
  const reading = labelReadingFor(treatment, plugin, eff.labelUse, entry.food);
  if (!reading.labelPathOpen) return refuse('LABEL_PATH_CLOSED');
  if (entry.labelNamesSpeciesAndClass !== true) return refuse('LABEL_NOT_CONFIRMED');
  if (ms === 0 && entry.labelSaysNone !== true) return refuse('ZERO_NOT_CONFIRMED');
  return { ok: true };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFood(v: unknown): v is Food {
  return typeof v === 'string' && (FOODS as readonly string[]).includes(v);
}

function parseEntry(raw: unknown): WithdrawalEntry | null {
  if (!isObj(raw)) return null;
  const enteredAtMs = raw.enteredAtMs;
  if (typeof enteredAtMs !== 'number' || !Number.isFinite(enteredAtMs)) return null;
  const enteredById = typeof raw.enteredById === 'string' ? raw.enteredById : null;
  const verdict = isObj(raw.verdict) ? parseClearObject(raw.verdict) : null;
  const base = { enteredAtMs, enteredById, ...(verdict ? { verdict } : {}) };
  switch (raw.kind) {
    case 'label':
    case 'vet': {
      if (!isFood(raw.food)) return null;
      if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount)) return null;
      if (raw.unit !== 'days' && raw.unit !== 'hours') return null;
      if (raw.kind === 'label') {
        return {
          ...base,
          kind: 'label',
          food: raw.food,
          amount: raw.amount,
          unit: raw.unit,
          labelNamesSpeciesAndClass: raw.labelNamesSpeciesAndClass === true,
          labelSaysNone: raw.labelSaysNone === true
        };
      }
      if (typeof raw.vetName !== 'string') return null;
      return {
        ...base,
        kind: 'vet',
        food: raw.food,
        amount: raw.amount,
        unit: raw.unit,
        vetName: raw.vetName,
        vetSaysNone: raw.vetSaysNone === true
      };
    }
    case 'course-end':
      if (typeof raw.endedAtMs !== 'number' || !Number.isFinite(raw.endedAtMs)) return null;
      return { ...base, kind: 'course-end', endedAtMs: raw.endedAtMs };
    case 'product':
      if (typeof raw.pluginId !== 'string' || raw.pluginId.trim() === '') return null;
      return { ...base, kind: 'product', pluginId: raw.pluginId, onLabel: raw.onLabel === true };
    default:
      return null;
  }
}

/** Reads `vet_directed_withdrawal`. Null or empty is no entries; anything
 *  unreadable is 'invalid', which the kernel treats as unknown. */
export function parseWithdrawalEntries(
  json: string | null | undefined
): readonly WithdrawalEntry[] | 'invalid' {
  if (json === null || json === undefined || json.trim() === '') return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return 'invalid';
  }
  if (!Array.isArray(raw)) return 'invalid';
  const out: WithdrawalEntry[] = [];
  for (const item of raw) {
    const e = parseEntry(item);
    if (!e) return 'invalid';
    out.push(e);
  }
  return out;
}

export function serializeWithdrawalEntries(entries: readonly WithdrawalEntry[]): string {
  return JSON.stringify(entries);
}

/** Appending is the only way entries change (C-01, C-03). */
export function appendWithdrawalEntry(
  existing: readonly WithdrawalEntry[],
  entry: WithdrawalEntry
): WithdrawalEntry[] {
  return [...existing, entry];
}

function parseFoodHold(raw: unknown): FoodHold | null {
  if (!isObj(raw)) return null;
  switch (raw.status) {
    case 'none':
      return NONE;
    case 'until':
      if (typeof raw.clearsAtMs !== 'number' || typeof raw.exactClearsAtMs !== 'number')
        return null;
      return {
        status: 'until',
        clearsAtMs: raw.clearsAtMs,
        exactClearsAtMs: raw.exactClearsAtMs,
        source: raw.source === 'entry' || raw.source === 'stored' ? raw.source : 'label'
      };
    case 'unknown':
      return { status: 'unknown', why: 'stored-unreadable', labelPathOpen: false, ...pickWhy(raw) };
    case 'prohibited':
      return {
        status: 'prohibited',
        cfr: Array.isArray(raw.cfr)
          ? raw.cfr.filter((s): s is string => typeof s === 'string')
          : [],
        drugs: Array.isArray(raw.drugs)
          ? raw.drugs.filter((s): s is string => typeof s === 'string')
          : []
      };
    default:
      return null;
  }
}

function pickWhy(raw: Record<string, unknown>): { why?: UnknownWhy; labelPathOpen?: boolean } {
  return {
    ...(typeof raw.why === 'string' ? { why: raw.why as UnknownWhy } : {}),
    ...(typeof raw.labelPathOpen === 'boolean' ? { labelPathOpen: raw.labelPathOpen } : {})
  };
}

export function serializeWithdrawalClear(clear: WithdrawalClear): string {
  return JSON.stringify(clear);
}

/** Reads `withdrawal_clear`. Returns null when unreadable; the caller then
 *  relies on the recompute, which is never shorter than the rules allow. */
export function parseWithdrawalClear(json: string | null | undefined): WithdrawalClear | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return parseClearObject(raw);
}

function parseClearObject(raw: unknown): WithdrawalClear | null {
  if (!isObj(raw) || !isObj(raw.foods)) return null;
  const foods = {} as Record<Food, FoodHold>;
  for (const food of FOODS) {
    const h = parseFoodHold(raw.foods[food]);
    if (!h) return null;
    foods[food] = h;
  }
  return {
    rulesVersion: typeof raw.rulesVersion === 'string' ? raw.rulesVersion : 'unknown',
    treatmentId: typeof raw.treatmentId === 'string' ? raw.treatmentId : '',
    lastDoseAtMs: typeof raw.lastDoseAtMs === 'number' ? raw.lastDoseAtMs : null,
    product: typeof raw.product === 'string' ? raw.product : '',
    foods
  };
}
