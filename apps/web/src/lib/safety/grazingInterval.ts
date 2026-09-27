/**
 * Phase 32C — grazing and haying interval gate (Q5, Q6).
 *
 * Label grazing and haying intervals are law. When a product's plugin
 * carries `grazingRestrictions`, grazing or cutting hay inside the interval
 * is a hard block that nothing overrides. When the plugin has no data (or no
 * plugin was recorded), an application inside the lookback window is
 * `GRAZING_UNKNOWN`: food animals and every hay cut are blocked until the
 * owner records the interval read from the label (`grazing_attestations`).
 * Pets and other non-food animals only get a warning. A label that forbids
 * pasture use (`notForPasture`) blocks for the whole lookback window and no
 * attestation clears it.
 *
 * Rulings applied (docs/design/PHASE_32_PLAN.md, 32C):
 * - C-04 clear times round up to the start of the next farm-local day, via
 *   Intl so DST is handled; rounding can only lengthen a hold.
 * - C-10 lactating is presumed when not known (`presumeLactating`); nothing
 *   a helper answers can shorten a hold.
 * - C-21 every application on any block of the Area counts, spot sprays
 *   included; `canReassignBlock` backs the refusal to move a block with an
 *   open interval to another Area.
 * - C-23 the lookback is max(365 days, the registry's longest known
 *   interval, the longest interval in the input), inclusive at its edge,
 *   and is snapshotted into the verdict.
 * - C-24 a field missing inside `grazingRestrictions` is unknown (0 means
 *   the label states none); an attestation never clears `notForPasture`.
 * - C-25 a species exception replaces the general interval for that
 *   species; the lactating path is never shorter than the general path.
 * - C-27 attestations match one application (`sprayEventRef` + product)
 *   and can only fill an unknown or lengthen, never shorten.
 * - C-28 hay cuts are gated whatever animals the farm keeps.
 * - C-30, C-31 `grazingExposureHolds` turns a verdict into per-food holds
 *   for animals already on the Area.
 *
 * Pure: no DB, env or clock reads. Callers do the tenant-scoped reads.
 */

import type { GrazingRestrictions } from '$lib/plugins/schemas';
import { dateTimeFormat } from '$lib/intlCache';

export const DAY_MS = 86_400_000;
export const GRAZING_LOOKBACK_DAYS = 365;

export type GrazingApplicationSource = 'spray' | 'insecticide' | 'fungicide';

export interface GrazingApplication {
  /** `<source>:<event id>`, the same string `grazing_attestations.spray_event_ref` stores. */
  ref: string;
  source: GrazingApplicationSource;
  blockId: string;
  appliedAtMs: number;
  productPluginId: string | null;
  productName: string;
  /** Null when the product has no plugin or its plugin has no grazing data. */
  restrictions: GrazingRestrictions | null;
  /** Active ingredient names, only used for the manure carryover advisory. */
  activeIngredients?: readonly string[];
}

export interface GrazingAttestationInput {
  id: string;
  sprayEventRef: string | null;
  productPluginId: string | null;
  /** The label's general grazing interval. */
  grazeDays: number | null;
  hayDays: number | null;
  /** The label's lactating dairy interval. Without it (and with no
   *  lactating value on file) the lactating path stays unknown (C-25). */
  lactatingGrazeDays?: number | null;
  /** The label's meat-animal removal before slaughter. Without it meat
   *  stays unknown, as with a label block that lacks the value (C-24). */
  meatRemovalDays?: number | null;
}

/**
 * Who is going onto the Area. `speciesId: null` means any species: every
 * species exception is taken at its longest. `lactating` left undefined is
 * read as lactating.
 */
export interface GrazingSubject {
  speciesId: string | null;
  foodProducing: boolean;
  lactating?: boolean;
}

export interface GrazingInput {
  applications: readonly GrazingApplication[];
  subject: GrazingSubject;
  attestations?: readonly GrazingAttestationInput[];
  atMs: number;
  /** Farm-local IANA zone for rounding. An invalid zone falls back to UTC. */
  timeZone: string;
  /** Longest interval any plugin in the registry carries (`registryMaxIntervalDays`). */
  registryMaxIntervalDays?: number;
}

export type HayCutInput = Omit<GrazingInput, 'subject'>;

export type GrazingReason = 'GRAZING_INTERVAL' | 'GRAZING_UNKNOWN' | 'GRAZING_PROHIBITED';
export type GrazingStatus = 'clear' | 'warn' | 'block';
export type GrazingBasis =
  'label' | 'species-exception' | 'lactating' | 'attestation' | 'unknown' | 'not-for-pasture';

export interface GrazingFinding {
  ref: string;
  source: GrazingApplicationSource;
  blockId: string;
  productPluginId: string | null;
  productName: string;
  appliedAtMs: number;
  /** Days the hold runs; null when unknown or prohibited. */
  days: number | null;
  basis: GrazingBasis;
  /** Application plus `days`, before rounding. */
  exactClearMs: number | null;
  /** Start of the first farm-local day that is clear. Null when unknown or prohibited. */
  clearsAtMs: number | null;
  /** When the application leaves the lookback window. */
  windowEndsAtMs: number;
  active: boolean;
  reason: GrazingReason | null;
  attestationIds: string[];
}

export interface GrazingVerdict {
  kind: 'graze' | 'hay';
  status: GrazingStatus;
  reason: GrazingReason | null;
  /** When everything active clears. Null when clear now, or when an unknown or prohibited finding has no date. */
  clearsAtMs: number | null;
  /** Latest clear time among active findings that have one. */
  knownClearsAtMs: number | null;
  findings: GrazingFinding[];
  /** Only the owner's label attestation can lift an unknown; a helper never can (C-32). */
  ownerCanAttest: boolean;
  manureCarryover: boolean;
  lookbackDays: number;
  registryMaxIntervalDays: number;
}

// ─── Farm-local day rounding (C-04) ─────────────────────────────────────

function safeZone(timeZone: string): string {
  try {
    dateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function wallAt(ms: number, timeZone: string): Wall {
  const parts = dateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour') % 24,
    mi: get('minute'),
    s: get('second')
  };
}

function dayKey(w: Wall): number {
  return Date.UTC(w.y, w.m - 1, w.d);
}

function offsetAt(ms: number, timeZone: string): number {
  const w = wallAt(ms, timeZone);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

const QUARTER_HOUR_MS = 15 * 60 * 1000;
const NEXT_DAY_CACHE = new Map<string, number>();

/** The first instant after `ms` that falls on a later farm-local day.
 *  Answers are cached per UTC quarter hour, and only when the whole quarter
 *  hour lies inside one local day, so the cache never changes an answer. */
export function startOfNextLocalDay(ms: number, timeZone: string): number {
  const bucket = Math.floor(ms / QUARTER_HOUR_MS);
  const key = `${timeZone}|${bucket}`;
  const hit = NEXT_DAY_CACHE.get(key);
  if (hit !== undefined) return hit;
  const next = computeStartOfNextLocalDay(ms, timeZone);
  const zone = safeZone(timeZone);
  const b0 = bucket * QUARTER_HOUR_MS;
  const b1 = b0 + QUARTER_HOUR_MS;
  if (next >= b1 && dayKey(wallAt(b0, zone)) === dayKey(wallAt(ms, zone))) {
    if (NEXT_DAY_CACHE.size > 200_000) NEXT_DAY_CACHE.clear();
    NEXT_DAY_CACHE.set(key, next);
  }
  return next;
}

function computeStartOfNextLocalDay(ms: number, timeZone: string): number {
  const zone = safeZone(timeZone);
  const today = dayKey(wallAt(ms, zone));
  const target = today + DAY_MS;
  let guess = target - offsetAt(target, zone);
  guess = target - offsetAt(guess, zone);
  const isStart = (t: number) =>
    t > ms && dayKey(wallAt(t, zone)) > today && dayKey(wallAt(t - 1, zone)) <= today;
  if (isStart(guess)) return guess;
  let lo = ms;
  let hi = ms + 2 * DAY_MS + 3 * 3_600_000;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (dayKey(wallAt(mid, zone)) > today) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** C-04: a hold of `days` from `fromMs`, rounded up to a farm-local day. Zero days is no hold. */
export function roundedClearMs(fromMs: number, days: number, timeZone: string): number {
  if (days <= 0) return fromMs;
  return startOfNextLocalDay(fromMs + days * DAY_MS, timeZone);
}

// ─── Interval selection (C-24, C-25) ────────────────────────────────────

interface Known {
  days: number;
  basis: GrazingBasis;
}

/** `days` is null when a value the subject needs is missing; `floor` keeps the longest known piece so an attestation never undercuts it. */
interface Choice {
  days: number | null;
  basis: GrazingBasis;
  floor: Known | null;
}

const UNKNOWN: Choice = { days: null, basis: 'unknown', floor: null };

function known(days: number, basis: GrazingBasis): Choice {
  return { days, basis, floor: { days, basis } };
}

function longer(a: Known | null, b: Known | null): Known | null {
  if (!a) return b;
  if (!b) return a;
  return b.days > a.days ? b : a;
}

function maxPick(a: Choice, b: Choice): Choice {
  const floor = longer(a.floor, b.floor);
  if (a.days === null || b.days === null) return { days: null, basis: 'unknown', floor };
  return b.days > a.days ? b : a;
}

function exceptionsFor(r: GrazingRestrictions, speciesId: string | null, lactating: boolean) {
  return (r.speciesExceptions ?? []).filter(
    (e) => (speciesId === null || e.speciesId === speciesId) && (e.lactating === true) === lactating
  );
}

function generalPick(r: GrazingRestrictions, speciesId: string | null): Choice {
  const base = r.grazeDays === undefined ? UNKNOWN : known(r.grazeDays, 'label');
  const own = exceptionsFor(r, speciesId, false).filter((e) => e.grazeDays !== undefined);
  if (speciesId !== null) {
    const e = own[0];
    return e ? known(e.grazeDays!, 'species-exception') : base;
  }
  return own.reduce<Choice>(
    (acc, e) => maxPick(acc, known(e.grazeDays!, 'species-exception')),
    base
  );
}

function lactatingPick(r: GrazingRestrictions, speciesId: string | null): Choice {
  return maxPick(generalPick(r, speciesId), lactatingOnlyPick(r, speciesId));
}

/** The lactating value on its own, without the general interval. */
function lactatingOnlyPick(r: GrazingRestrictions, speciesId: string | null): Choice {
  const dairy =
    r.lactatingDairyGrazeDays === undefined
      ? UNKNOWN
      : known(r.lactatingDairyGrazeDays, 'lactating');
  const own = exceptionsFor(r, speciesId, true).filter((e) => e.grazeDays !== undefined);
  let lact: Choice;
  if (speciesId !== null) {
    const e = own[0];
    lact = e ? known(e.grazeDays!, 'species-exception') : dairy;
  } else {
    lact = own.reduce<Choice>(
      (acc, e) => maxPick(acc, known(e.grazeDays!, 'species-exception')),
      dairy
    );
  }
  return lact;
}

function hayPick(r: GrazingRestrictions): Choice {
  const base = r.hayDays === undefined ? UNKNOWN : known(r.hayDays, 'label');
  return (r.speciesExceptions ?? [])
    .filter((e) => e.hayDays !== undefined)
    .reduce<Choice>((acc, e) => maxPick(acc, known(e.hayDays!, 'species-exception')), base);
}

/** The label grazing interval for one subject, or unknown. */
export function labelGrazeDays(
  r: GrazingRestrictions,
  subject: Pick<GrazingSubject, 'speciesId' | 'lactating'>
): number | 'unknown' {
  const p =
    subject.lactating === false
      ? generalPick(r, subject.speciesId)
      : lactatingPick(r, subject.speciesId);
  return p.days === null ? 'unknown' : p.days;
}

/** The label haying interval: the longest of the general and every species value. */
export function labelHayDays(r: GrazingRestrictions): number | 'unknown' {
  const p = hayPick(r);
  return p.days === null ? 'unknown' : p.days;
}

/** Every day count a restrictions block carries, for the registry maximum. */
export function restrictionDays(r: GrazingRestrictions | null | undefined): number[] {
  if (!r) return [];
  const out: number[] = [];
  for (const v of [
    r.grazeDays,
    r.hayDays,
    r.lactatingDairyGrazeDays,
    r.meatAnimalRemovalBeforeSlaughterDays
  ]) {
    if (v !== undefined) out.push(v);
  }
  for (const e of r.speciesExceptions ?? []) {
    if (e.grazeDays !== undefined) out.push(e.grazeDays);
    if (e.hayDays !== undefined) out.push(e.hayDays);
  }
  return out;
}

/** C-23: the longest interval among the given plugins' restrictions. */
export function registryMaxIntervalDays(
  all: Iterable<GrazingRestrictions | null | undefined>
): number {
  let max = 0;
  for (const r of all) for (const d of restrictionDays(r)) if (d > max) max = d;
  return max;
}

function longerDays(base: number | undefined, farm: number | undefined): number | undefined {
  if (base === undefined) return undefined;
  return farm === undefined ? base : Math.max(base, farm);
}

/**
 * C-24, C-27: the grazing data a farm's own copy of a shared pesticide
 * plugin may apply. It can only make the shared label stricter: every
 * interval takes the longer value, an interval the shared label lacks
 * stays unknown (only a per-application attestation fills it), species
 * exceptions come from the shared plugin, and `notForPasture` and
 * `manureCarryover` stay set once either side sets them. With no shared
 * plugin the farm copy counts only for `notForPasture`.
 */
export function farmCopyRestrictions(
  base: GrazingRestrictions | null | undefined,
  farm: GrazingRestrictions | null | undefined
): GrazingRestrictions | null {
  if (!base) {
    if (farm?.notForPasture !== true) return null;
    return {
      source: farm.source,
      notForPasture: true,
      ...(farm.manureCarryover === true ? { manureCarryover: true } : {})
    };
  }
  if (!farm) return base;
  const farmExceptions = farm.speciesExceptions ?? [];
  const exceptions = base.speciesExceptions?.map((e) => {
    const f = farmExceptions.find(
      (x) => x.speciesId === e.speciesId && (x.lactating === true) === (e.lactating === true)
    );
    return {
      ...e,
      grazeDays: longerDays(e.grazeDays, f?.grazeDays),
      hayDays: longerDays(e.hayDays, f?.hayDays)
    };
  });
  return {
    source: base.source,
    grazeDays: longerDays(base.grazeDays, farm.grazeDays),
    hayDays: longerDays(base.hayDays, farm.hayDays),
    lactatingDairyGrazeDays: longerDays(base.lactatingDairyGrazeDays, farm.lactatingDairyGrazeDays),
    meatAnimalRemovalBeforeSlaughterDays: longerDays(
      base.meatAnimalRemovalBeforeSlaughterDays,
      farm.meatAnimalRemovalBeforeSlaughterDays
    ),
    ...(exceptions ? { speciesExceptions: exceptions } : {}),
    ...(base.notForPasture === true || farm.notForPasture === true ? { notForPasture: true } : {}),
    ...(base.manureCarryover === true || farm.manureCarryover === true
      ? { manureCarryover: true }
      : {})
  };
}

/** C-10: a milk species is read as lactating unless the animal is male. */
export function presumeLactating(input: {
  speciesProducts: readonly string[];
  sex?: string | null;
}): boolean {
  if (!input.speciesProducts.includes('milk')) return false;
  return input.sex !== 'male' && input.sex !== 'neutered-male';
}

// ─── Evaluation ─────────────────────────────────────────────────────────

function lookbackDays(input: HayCutInput): number {
  const inInput = registryMaxIntervalDays(input.applications.map((a) => a.restrictions));
  return Math.max(GRAZING_LOOKBACK_DAYS, input.registryMaxIntervalDays ?? 0, inInput);
}

export function matchingAttestations(
  a: GrazingApplication,
  attestations: readonly GrazingAttestationInput[]
): GrazingAttestationInput[] {
  return attestations.filter(
    (t) =>
      t.sprayEventRef !== null &&
      t.sprayEventRef === a.ref &&
      (t.productPluginId ?? null) === (a.productPluginId ?? null)
  );
}

function withAttested(label: Choice, attested: number[]): { pick: Choice; used: boolean } {
  if (attested.length === 0) return { pick: label, used: false };
  const a = Math.max(...attested);
  if (label.days === null) {
    const f = label.floor;
    if (f && f.days > a) return { pick: known(f.days, f.basis), used: true };
    return { pick: known(a, 'attestation'), used: true };
  }
  return a > label.days
    ? { pick: known(a, 'attestation'), used: true }
    : { pick: label, used: false };
}

function dayCount(d: number | null | undefined): number | null {
  return typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : null;
}

/**
 * C-25: what an attestation says for lactating animals. The owner's
 * lactating value counts, never shorter than their general value. A
 * general value alone only counts when the label data already carries a
 * lactating value, which then stays the floor; otherwise the lactating
 * path stays unknown, since many labels give dairy animals a longer wait.
 */
function attestedLactatingDays(
  t: GrazingAttestationInput,
  lactatingOnFile: boolean
): number | null {
  const general = dayCount(t.grazeDays);
  const lactating = dayCount(t.lactatingGrazeDays);
  if (lactating !== null) return Math.max(lactating, general ?? 0);
  return lactatingOnFile ? general : null;
}

/** The longest meat removal an owner attested for this application, or
 *  undefined when none of the matching attestations gives one. */
export function attestedMeatRemovalDays(
  a: GrazingApplication,
  attestations: readonly GrazingAttestationInput[]
): number | undefined {
  const days = matchingAttestations(a, attestations)
    .map((t) => dayCount(t.meatRemovalDays))
    .filter((d): d is number => d !== null);
  return days.length ? Math.max(...days) : undefined;
}

/** The meat removal days in force: the label value and any attested value,
 *  whichever is longer. Undefined when neither gives one. */
export function meatRemovalDaysFor(
  a: GrazingApplication,
  attestations: readonly GrazingAttestationInput[]
): number | undefined {
  const label = a.restrictions?.meatAnimalRemovalBeforeSlaughterDays;
  const attested = attestedMeatRemovalDays(a, attestations);
  if (label === undefined) return attested;
  return attested === undefined ? label : Math.max(label, attested);
}

const STATUS_RANK: Record<GrazingStatus, number> = { clear: 0, warn: 1, block: 2 };
const REASON_RANK: Record<GrazingReason, number> = {
  GRAZING_INTERVAL: 0,
  GRAZING_UNKNOWN: 1,
  GRAZING_PROHIBITED: 2
};

function evaluate(
  kind: 'graze' | 'hay',
  input: HayCutInput,
  subject: GrazingSubject | null
): GrazingVerdict {
  const zone = safeZone(input.timeZone);
  const look = lookbackDays(input);
  const windowStart = input.atMs - look * DAY_MS;
  const attestations = input.attestations ?? [];
  const findings: GrazingFinding[] = [];

  for (const a of input.applications) {
    if (!Number.isFinite(a.appliedAtMs) || a.appliedAtMs < windowStart) continue;
    const windowEndsAtMs = startOfNextLocalDay(a.appliedAtMs + look * DAY_MS, zone);
    const matched = matchingAttestations(a, attestations);
    const base = {
      ref: a.ref,
      source: a.source,
      blockId: a.blockId,
      productPluginId: a.productPluginId,
      productName: a.productName,
      appliedAtMs: a.appliedAtMs,
      windowEndsAtMs
    };
    if (a.restrictions?.notForPasture === true) {
      findings.push({
        ...base,
        days: null,
        basis: 'not-for-pasture',
        exactClearMs: null,
        clearsAtMs: null,
        active: true,
        reason: 'GRAZING_PROHIBITED',
        attestationIds: []
      });
      continue;
    }
    let label: Choice;
    if (a.restrictions === null) label = UNKNOWN;
    else if (kind === 'hay') label = hayPick(a.restrictions);
    else {
      label =
        subject!.lactating === false
          ? generalPick(a.restrictions, subject!.speciesId)
          : lactatingPick(a.restrictions, subject!.speciesId);
    }
    const lactatingPath = kind === 'graze' && subject!.lactating !== false;
    const lactatingOnFile =
      lactatingPath &&
      a.restrictions !== null &&
      lactatingOnlyPick(a.restrictions, subject!.speciesId).days !== null;
    const valueOf = (t: GrazingAttestationInput) =>
      kind === 'hay'
        ? dayCount(t.hayDays)
        : lactatingPath
          ? attestedLactatingDays(t, lactatingOnFile)
          : dayCount(t.grazeDays);
    const attested = matched.map(valueOf).filter((d): d is number => d !== null);
    const { pick, used } = withAttested(label, attested);
    const attestationIds = used
      ? matched.filter((t) => valueOf(t) === Math.max(...attested)).map((t) => t.id)
      : [];
    if (pick.days === null) {
      findings.push({
        ...base,
        days: null,
        basis: 'unknown',
        exactClearMs: null,
        clearsAtMs: null,
        active: true,
        reason: 'GRAZING_UNKNOWN',
        attestationIds: []
      });
      continue;
    }
    const exactClearMs = a.appliedAtMs + pick.days * DAY_MS;
    const clearsAtMs = roundedClearMs(a.appliedAtMs, pick.days, zone);
    const active = pick.days > 0 && input.atMs < clearsAtMs;
    findings.push({
      ...base,
      days: pick.days,
      basis: pick.basis,
      exactClearMs,
      clearsAtMs,
      active,
      reason: active ? 'GRAZING_INTERVAL' : null,
      attestationIds
    });
  }

  const active = findings.filter((f) => f.active);
  const gated = kind === 'hay' || subject!.foodProducing;
  let status: GrazingStatus = 'clear';
  let reason: GrazingReason | null = null;
  for (const f of active) {
    const s: GrazingStatus = gated ? 'block' : 'warn';
    if (STATUS_RANK[s] > STATUS_RANK[status]) status = s;
    if (f.reason && (reason === null || REASON_RANK[f.reason] > REASON_RANK[reason])) {
      reason = f.reason;
    }
  }
  const dated = active.filter((f) => f.clearsAtMs !== null).map((f) => f.clearsAtMs!);
  const knownClearsAtMs = dated.length ? Math.max(...dated) : null;
  const undated = active.some((f) => f.clearsAtMs === null);

  return {
    kind,
    status,
    reason,
    clearsAtMs: active.length === 0 || undated ? null : knownClearsAtMs,
    knownClearsAtMs,
    findings,
    ownerCanAttest: active.some((f) => f.reason === 'GRAZING_UNKNOWN'),
    manureCarryover: hasManureCarryover(input.applications),
    lookbackDays: look,
    registryMaxIntervalDays: input.registryMaxIntervalDays ?? 0
  };
}

/** Moving `subject` onto an Area whose blocks carry `applications`. */
export function evaluateGrazing(input: GrazingInput): GrazingVerdict {
  return evaluate('graze', input, input.subject);
}

/** Cutting hay on an Area. Gated whatever animals the farm keeps (C-28). */
export function evaluateHayCut(input: HayCutInput): GrazingVerdict {
  return evaluate('hay', input, null);
}

/** The strictest subject: any species, lactating, food-producing. */
export const STRICTEST_SUBJECT: GrazingSubject = {
  speciesId: null,
  foodProducing: true,
  lactating: true
};

/**
 * C-21: a block may move to another Area only when neither grazing (for the
 * strictest subject) nor hay has an open hold on its applications.
 */
export function canReassignBlock(input: HayCutInput): {
  ok: boolean;
  grazing: GrazingVerdict;
  hay: GrazingVerdict;
} {
  const grazing = evaluateGrazing({ ...input, subject: STRICTEST_SUBJECT });
  const hay = evaluateHayCut(input);
  return { ok: grazing.status === 'clear' && hay.status === 'clear', grazing, hay };
}

// ─── Advisories ─────────────────────────────────────────────────────────

const CARRYOVER_ACTIVES = ['aminopyralid', 'clopyralid', 'picloram', 'aminocyclopyrachlor'];

/**
 * Advisory only: a product whose label data says residue survives in manure,
 * or one carrying a pyridine carboxylic acid active known to pass through
 * animals into manure and compost.
 */
export function hasManureCarryover(applications: readonly GrazingApplication[]): boolean {
  return applications.some(
    (a) =>
      a.restrictions?.manureCarryover === true ||
      (a.activeIngredients ?? []).some((n) =>
        CARRYOVER_ACTIVES.some((c) => n.toLowerCase().includes(c))
      )
  );
}

export interface FoodHold {
  held: boolean;
  /** Null while held with no known end. */
  clearsAtMs: number | null;
}

export interface GrazingExposureHolds {
  milk: FoodHold;
  eggs: FoodHold;
  meat: FoodHold;
}

/**
 * C-30, C-31: food holds for animals that were on the Area while `verdict`
 * was not clear. Milk and eggs wait for the grazing clear time. Meat also
 * waits the label's pre-slaughter removal days, and is unknown when the
 * label value is missing.
 */
export function grazingExposureHolds(
  verdict: GrazingVerdict,
  applications: readonly GrazingApplication[],
  timeZone: string,
  attestations: readonly GrazingAttestationInput[] = []
): GrazingExposureHolds {
  const active = verdict.findings.filter((f) => f.active);
  if (active.length === 0) {
    const none = { held: false, clearsAtMs: null };
    return { milk: none, eggs: none, meat: none };
  }
  const produce: FoodHold = { held: true, clearsAtMs: verdict.clearsAtMs };
  let meatClear: number | null = verdict.clearsAtMs;
  const byRef = new Map(applications.map((a) => [`${a.ref}|${a.productPluginId ?? ''}`, a]));
  for (const f of active) {
    const app = byRef.get(`${f.ref}|${f.productPluginId ?? ''}`);
    const days = app ? meatRemovalDaysFor(app, attestations) : undefined;
    if (f.clearsAtMs === null || days === undefined) {
      meatClear = null;
      break;
    }
    const c = roundedClearMs(f.clearsAtMs, days, timeZone);
    if (meatClear !== null && c > meatClear) meatClear = c;
  }
  return { milk: produce, eggs: produce, meat: { held: true, clearsAtMs: meatClear } };
}
