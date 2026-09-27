/**
 * Phase 32C — food holds for animals that were on a sprayed Area while its
 * grazing interval ran (rulings C-30 and C-31). A move recorded after the
 * fact, an offline move replayed late, and a spray on an Area with animals
 * still on it are all saved truthfully; the harm is stopped at the table
 * instead. Part of the 0.6.0 grazing rule; pure, with no DB or clock reads.
 *
 * For each stay on an Area and each application on that Area, the
 * exposure moment is the later of arrival and application. When the
 * grazing verdict for the strictest reading of the subject (food animal,
 * presumed lactating unless known otherwise) is not clear at that moment,
 * `grazingExposureHolds` gives the per-food hold. A hold with no known end
 * (no label interval, or no pre-slaughter removal days for meat) lasts
 * until the application leaves the lookback window, the same point where
 * the grazing gate stops counting it.
 */

import {
  DAY_MS,
  GRAZING_LOOKBACK_DAYS,
  evaluateGrazing,
  grazingExposureHolds,
  matchingAttestations,
  meatRemovalDaysFor,
  registryMaxIntervalDays,
  roundedClearMs,
  startOfNextLocalDay,
  type GrazingApplication,
  type GrazingAttestationInput,
  type GrazingReason,
  type GrazingSubject
} from './grazingInterval';
import { GATED_USES, type Food, type ProductionUse } from './animalWithdrawal';

export interface ExposureStay {
  fieldId: string;
  fromMs: number;
  /** Null while the subject is still there. */
  toMs: number | null;
  /** Dated holds the gate found when this stay's move was saved. */
  floor?: readonly ExposureFloorEntry[];
}

/**
 * One dated exposure hold stored with the move that caused it, so a later
 * change to plugin data or to the rules can never shorten it (the grazing
 * side of C-18). Only dated holds are kept: an unknown one stays open to
 * the owner's attestation, and a floor only applies while its application
 * is still on record.
 */
export interface ExposureFloorEntry {
  ref: string;
  productPluginId: string | null;
  food: Food;
  /** The subject reading the floor was computed for (C-10). */
  lactating: boolean;
  exposedAtMs: number;
  clearsAtMs: number;
}

export interface ExposureFloor {
  rulesVersion: string;
  entries: ExposureFloorEntry[];
}

export interface GrazingExposureInput {
  stays: readonly ExposureStay[];
  /** Applications on each Area's blocks (C-21: every block of the Area). */
  applicationsByField: ReadonlyMap<string, readonly GrazingApplication[]>;
  attestations?: readonly GrazingAttestationInput[];
  subject: Pick<GrazingSubject, 'speciesId' | 'lactating'>;
  food: Food;
  /** When the food was collected or the animal slaughtered. */
  atMs: number;
  timeZone: string;
  registryMaxIntervalDays?: number;
}

export interface ExposureHold {
  fieldId: string;
  ref: string;
  productName: string;
  exposedAtMs: number;
  reason: GrazingReason;
  /** The known end of the hold; null when the label value is missing. */
  clearsAtMs: number | null;
  /** When the hold stops applying: `clearsAtMs`, or the end of the lookback window. */
  endsAtMs: number;
}

export type ExposureVerdict =
  | { status: 'safe'; food: Food; use: ProductionUse }
  | {
      status: 'warn' | 'block';
      reason: GrazingReason;
      food: Food;
      use: ProductionUse;
      clearsAtMs: number | null;
      /** When every hold stops applying: the known clear time, or the end
       *  of the lookback window for an undated or forbidden one. */
      holdEndsAtMs: number;
      products: string[];
      holds: ExposureHold[];
      message: string;
      resubmitAs?: 'discard';
    };

const REASON_RANK: Record<GrazingReason, number> = {
  GRAZING_INTERVAL: 0,
  GRAZING_UNKNOWN: 1,
  GRAZING_PROHIBITED: 2
};

function lookbackDays(input: GrazingExposureInput, app: GrazingApplication): number {
  return Math.max(
    GRAZING_LOOKBACK_DAYS,
    input.registryMaxIntervalDays ?? 0,
    registryMaxIntervalDays([app.restrictions])
  );
}

/**
 * The label's pre-slaughter removal on its own: meat waits the removal
 * days after the animal's last moment on the treated Area, however short
 * or long the grazing interval is. A label block with no removal value,
 * or an owner attestation for an unsourced product that gives none, leaves
 * meat unknown until the application leaves the lookback window.
 */
function removalHold(
  input: GrazingExposureInput,
  stay: ExposureStay,
  app: GrazingApplication,
  exposedAtMs: number
): ExposureHold | null {
  const r = app.restrictions;
  if (r?.notForPasture === true) return null;
  const attestations = input.attestations ?? [];
  if (!r && matchingAttestations(app, attestations).length === 0) return null;
  const windowEndsAtMs = startOfNextLocalDay(
    app.appliedAtMs + lookbackDays(input, app) * DAY_MS,
    input.timeZone
  );
  const leftAtMs = Math.min(stay.toMs ?? Number.POSITIVE_INFINITY, windowEndsAtMs, input.atMs);
  if (leftAtMs < exposedAtMs) return null;
  const days = meatRemovalDaysFor(app, attestations);
  if (days === undefined) {
    if (input.atMs >= windowEndsAtMs) return null;
    return {
      fieldId: stay.fieldId,
      ref: app.ref,
      productName: app.productName,
      exposedAtMs,
      reason: 'GRAZING_UNKNOWN',
      clearsAtMs: null,
      endsAtMs: windowEndsAtMs
    };
  }
  if (days <= 0) return null;
  const clearsAtMs = roundedClearMs(leftAtMs, days, input.timeZone);
  if (input.atMs >= clearsAtMs) return null;
  return {
    fieldId: stay.fieldId,
    ref: app.ref,
    productName: app.productName,
    exposedAtMs,
    reason: 'GRAZING_INTERVAL',
    clearsAtMs,
    endsAtMs: clearsAtMs
  };
}

/** Every exposure hold still running at `atMs`. */
export function exposureHolds(input: GrazingExposureInput): ExposureHold[] {
  const out: ExposureHold[] = [];
  const subject: GrazingSubject = {
    speciesId: input.subject.speciesId,
    lactating: input.subject.lactating,
    foodProducing: true
  };
  for (const stay of input.stays) {
    const apps = input.applicationsByField.get(stay.fieldId) ?? [];
    for (const app of apps) {
      if (!Number.isFinite(app.appliedAtMs)) continue;
      const exposedAtMs = Math.max(stay.fromMs, app.appliedAtMs);
      if (stay.toMs !== null && exposedAtMs >= stay.toMs) continue;
      if (exposedAtMs > input.atMs) continue;
      const removal = input.food === 'meat' ? removalHold(input, stay, app, exposedAtMs) : null;
      const grazing = grazingHold(input, subject, stay, app, exposedAtMs);
      const held = withFloor(combine(grazing, removal), input, subject, stay, app);
      if (held) out.push(held);
    }
  }
  return out;
}

/** One stretch of time an exposure holds a food: `[fromMs, toMs)`. */
export interface ExposureSpan {
  fieldId: string;
  ref: string;
  fromMs: number;
  toMs: number;
  basis: 'known' | 'unknown' | 'prohibited';
}

const SPAN_BASIS: Record<GrazingReason, ExposureSpan['basis']> = {
  GRAZING_INTERVAL: 'known',
  GRAZING_UNKNOWN: 'unknown',
  GRAZING_PROHIBITED: 'prohibited'
};

/**
 * Every stretch of time in which `exposureHolds` would find a hold, for
 * stays that all have an end (the hold ledger closes open stays at now).
 * Each stay and application holds from its exposure moment; the moments
 * worth asking about are that exposure, the stay's last moment inside the
 * lookback (the pre-slaughter removal counts from leaving) and each stored
 * floor's exposure. A hold found at one of them runs, unbroken, from its
 * exposure to its `endsAtMs`.
 */
export function exposureSpans(input: Omit<GrazingExposureInput, 'atMs'>): ExposureSpan[] {
  const out: ExposureSpan[] = [];
  for (const stay of input.stays) {
    const apps = input.applicationsByField.get(stay.fieldId) ?? [];
    for (const app of apps) {
      if (!Number.isFinite(app.appliedAtMs)) continue;
      const exposedAtMs = Math.max(stay.fromMs, app.appliedAtMs);
      if (stay.toMs !== null && exposedAtMs >= stay.toMs) continue;
      const windowEndsAtMs = startOfNextLocalDay(
        app.appliedAtMs + lookbackDays({ ...input, atMs: 0 }, app) * DAY_MS,
        input.timeZone
      );
      const points = new Set<number>([exposedAtMs]);
      const left = Math.min(stay.toMs ?? Number.POSITIVE_INFINITY, windowEndsAtMs);
      if (Number.isFinite(left) && left > exposedAtMs) points.add(left);
      for (const f of stay.floor ?? []) {
        if (Number.isFinite(f.exposedAtMs) && f.exposedAtMs >= exposedAtMs) {
          points.add(f.exposedAtMs);
        }
      }
      const one = {
        ...input,
        stays: [stay],
        applicationsByField: new Map([[stay.fieldId, [app]]])
      };
      for (const atMs of points) {
        for (const h of exposureHolds({ ...one, atMs })) {
          if (!(h.endsAtMs > h.exposedAtMs)) continue;
          out.push({
            fieldId: h.fieldId,
            ref: h.ref,
            fromMs: h.exposedAtMs,
            toMs: h.endsAtMs,
            basis: SPAN_BASIS[h.reason]
          });
        }
      }
    }
  }
  return out;
}

/** Per application and subject reading: what the grazing rule says,
 *  independent of when the animals arrived. */
interface AppProfile {
  lookMs: number;
  windowEndsAtMs: number;
  /** Grazing finding at the application (always inside its own window). */
  graze: { days: number | null; clearsAtMs: number | null; prohibited: boolean };
  /** The label's pre-slaughter removal, or undefined when not known. */
  removalDays: number | undefined;
  /** Whether the removal rule applies at all (C-24: data or attestation). */
  removalApplies: boolean;
}

/** Memo for `exposureSpansFast`, shared across the subjects of one
 *  projection (same attestations, zone and registry maximum). */
export interface ExposureSpanCache {
  profiles: WeakMap<GrazingApplication, Map<string, AppProfile>>;
  rounded: Map<string, number>;
}

export function newExposureSpanCache(): ExposureSpanCache {
  return { profiles: new WeakMap(), rounded: new Map() };
}

function profileOf(
  input: Omit<GrazingExposureInput, 'atMs' | 'stays' | 'food'>,
  app: GrazingApplication,
  cache: ExposureSpanCache
): AppProfile {
  const key = `${input.subject.speciesId}|${input.subject.lactating !== false}`;
  let byReading = cache.profiles.get(app);
  if (!byReading) {
    byReading = new Map();
    cache.profiles.set(app, byReading);
  }
  const hit = byReading.get(key);
  if (hit) return hit;
  const look = lookbackDays({ ...input, stays: [], food: 'meat', atMs: 0 }, app);
  const verdict = evaluateGrazing({
    applications: [app],
    subject: { speciesId: input.subject.speciesId, lactating: input.subject.lactating, foodProducing: true },
    attestations: input.attestations,
    atMs: app.appliedAtMs,
    timeZone: input.timeZone,
    registryMaxIntervalDays: input.registryMaxIntervalDays
  });
  const f = verdict.findings[0];
  const attestations = input.attestations ?? [];
  const profile: AppProfile = {
    lookMs: look * DAY_MS,
    windowEndsAtMs: startOfNextLocalDay(app.appliedAtMs + look * DAY_MS, input.timeZone),
    graze: {
      days: f ? f.days : null,
      clearsAtMs: f ? f.clearsAtMs : null,
      prohibited: f?.reason === 'GRAZING_PROHIBITED'
    },
    removalDays: meatRemovalDaysFor(app, attestations),
    removalApplies:
      app.restrictions?.notForPasture !== true &&
      (app.restrictions !== null || matchingAttestations(app, attestations).length > 0)
  };
  byReading.set(key, profile);
  return profile;
}

function roundedCached(cache: ExposureSpanCache, fromMs: number, days: number, tz: string): number {
  const key = `${fromMs}|${days}`;
  let v = cache.rounded.get(key);
  if (v === undefined) {
    v = roundedClearMs(fromMs, days, tz);
    cache.rounded.set(key, v);
  }
  return v;
}

/**
 * `exposureSpans` without asking the kernel at each moment: the grazing
 * finding for an application does not depend on when the animals arrived,
 * only whether they arrived inside its window and before it cleared, so it
 * is read once per application and subject reading. Property-tested to
 * hold exactly when `exposureHolds` does. Stays must all have an end.
 */
export function exposureSpansFast(
  input: Omit<GrazingExposureInput, 'atMs'>,
  cache: ExposureSpanCache = newExposureSpanCache()
): ExposureSpan[] {
  const out: ExposureSpan[] = [];
  const lactating = input.subject.lactating !== false;
  for (const stay of input.stays) {
    const apps = input.applicationsByField.get(stay.fieldId) ?? [];
    const to = stay.toMs ?? Number.POSITIVE_INFINITY;
    for (const app of apps) {
      if (!Number.isFinite(app.appliedAtMs)) continue;
      const exposed = Math.max(stay.fromMs, app.appliedAtMs);
      if (exposed >= to) continue;
      const p = profileOf(input, app, cache);
      const push = (toMs: number, basis: ExposureSpan['basis'], fromMs = exposed) => {
        if (toMs > fromMs) out.push({ fieldId: stay.fieldId, ref: app.ref, fromMs, toMs, basis });
      };
      if (app.appliedAtMs >= exposed - p.lookMs) {
        const g = p.graze;
        const active = g.days === null || g.prohibited || (g.days > 0 && exposed < (g.clearsAtMs ?? 0));
        if (active) {
          let clears: number | null = g.clearsAtMs;
          if (input.food === 'meat' && clears !== null) {
            clears = p.removalDays === undefined ? null : roundedCached(cache, clears, p.removalDays, input.timeZone);
          }
          if (clears !== null) push(clears, 'known');
          else push(p.windowEndsAtMs, g.prohibited ? 'prohibited' : 'unknown');
        }
      }
      if (input.food === 'meat' && p.removalApplies) {
        const left = Math.min(to, p.windowEndsAtMs);
        if (left >= exposed) {
          if (p.removalDays === undefined) push(p.windowEndsAtMs, 'unknown');
          else if (p.removalDays > 0) push(roundedCached(cache, left, p.removalDays, input.timeZone), 'known');
        }
      }
      for (const f of stay.floor ?? []) {
        if (f.ref !== app.ref || (f.productPluginId ?? null) !== (app.productPluginId ?? null)) continue;
        if (f.food !== input.food) continue;
        if (input.food !== 'milk' && f.lactating !== lactating) continue;
        if (!Number.isFinite(f.clearsAtMs) || !Number.isFinite(f.exposedAtMs)) continue;
        if (f.exposedAtMs < stay.fromMs || f.exposedAtMs >= to) continue;
        push(f.clearsAtMs, 'known', Math.max(f.exposedAtMs, exposed));
      }
    }
  }
  return out;
}

/** The stored floor for this stay and application, applied to the
 *  recomputed hold: it can lengthen a dated hold or restore one, never
 *  shorten one, and it leaves an undated hold undated. Milk takes the
 *  stricter of the two stored readings, so a later change to the animal's
 *  sex never shortens it (C-10). */
function withFloor(
  held: ExposureHold | null,
  input: GrazingExposureInput,
  subject: GrazingSubject,
  stay: ExposureStay,
  app: GrazingApplication
): ExposureHold | null {
  if (!stay.floor?.length) return held;
  const lactating = subject.lactating !== false;
  let best: ExposureFloorEntry | null = null;
  for (const f of stay.floor) {
    if (f.ref !== app.ref || (f.productPluginId ?? null) !== (app.productPluginId ?? null)) {
      continue;
    }
    if (f.food !== input.food) continue;
    if (input.food !== 'milk' && f.lactating !== lactating) continue;
    if (!Number.isFinite(f.clearsAtMs) || !Number.isFinite(f.exposedAtMs)) continue;
    if (f.exposedAtMs < stay.fromMs || (stay.toMs !== null && f.exposedAtMs >= stay.toMs)) continue;
    if (f.exposedAtMs > input.atMs || input.atMs >= f.clearsAtMs) continue;
    if (!best || f.clearsAtMs > best.clearsAtMs) best = f;
  }
  if (!best) return held;
  if (!held) {
    return {
      fieldId: stay.fieldId,
      ref: app.ref,
      productName: app.productName,
      exposedAtMs: best.exposedAtMs,
      reason: 'GRAZING_INTERVAL',
      clearsAtMs: best.clearsAtMs,
      endsAtMs: best.clearsAtMs
    };
  }
  if (held.clearsAtMs === null || held.clearsAtMs >= best.clearsAtMs) return held;
  return {
    ...held,
    clearsAtMs: best.clearsAtMs,
    endsAtMs: Math.max(held.endsAtMs, best.clearsAtMs)
  };
}

/**
 * The dated holds animals arriving on an Area at `arrivedAtMs` get from its
 * applications, for the lactating and the general reading of the subject.
 * Stored with the move as its floor. The meat removal is counted from the
 * arrival, a lower bound for animals that stay longer.
 */
export function exposureFloorFor(input: {
  fieldId: string;
  arrivedAtMs: number;
  applications: readonly GrazingApplication[];
  attestations?: readonly GrazingAttestationInput[];
  speciesId: string | null;
  timeZone: string;
  registryMaxIntervalDays?: number;
}): ExposureFloorEntry[] {
  const out: ExposureFloorEntry[] = [];
  const stay: ExposureStay = { fieldId: input.fieldId, fromMs: input.arrivedAtMs, toMs: null };
  for (const app of input.applications) {
    const applicationsByField = new Map([[input.fieldId, [app]]]);
    for (const lactating of [true, false]) {
      for (const food of ['meat', 'milk', 'eggs'] as const) {
        const holds = exposureHolds({
          stays: [stay],
          applicationsByField,
          attestations: input.attestations,
          subject: { speciesId: input.speciesId, lactating },
          food,
          atMs: input.arrivedAtMs,
          timeZone: input.timeZone,
          registryMaxIntervalDays: input.registryMaxIntervalDays
        });
        for (const h of holds) {
          if (h.clearsAtMs === null) continue;
          out.push({
            ref: app.ref,
            productPluginId: app.productPluginId ?? null,
            food,
            lactating,
            exposedAtMs: h.exposedAtMs,
            clearsAtMs: h.clearsAtMs
          });
        }
      }
    }
  }
  return out;
}

function isFood(v: unknown): v is Food {
  return v === 'meat' || v === 'milk' || v === 'eggs';
}

/** Reads `animal_locations.exposure_floor`. Anything unreadable is no
 *  floor: the recompute is never shorter than the current rules allow. */
export function parseExposureFloor(json: string | null | undefined): ExposureFloorEntry[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const entries = (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  const out: ExposureFloorEntry[] = [];
  for (const e of entries) {
    if (typeof e !== 'object' || e === null) continue;
    const r = e as Record<string, unknown>;
    if (typeof r.ref !== 'string' || !isFood(r.food)) continue;
    if (typeof r.exposedAtMs !== 'number' || typeof r.clearsAtMs !== 'number') continue;
    out.push({
      ref: r.ref,
      productPluginId: typeof r.productPluginId === 'string' ? r.productPluginId : null,
      food: r.food,
      lactating: r.lactating !== false,
      exposedAtMs: r.exposedAtMs,
      clearsAtMs: r.clearsAtMs
    });
  }
  return out;
}

export function serializeExposureFloor(floor: ExposureFloor): string {
  return JSON.stringify(floor);
}

function grazingHold(
  input: GrazingExposureInput,
  subject: GrazingSubject,
  stay: ExposureStay,
  app: GrazingApplication,
  exposedAtMs: number
): ExposureHold | null {
  const verdict = evaluateGrazing({
    applications: [app],
    subject,
    attestations: input.attestations,
    atMs: exposedAtMs,
    timeZone: input.timeZone,
    registryMaxIntervalDays: input.registryMaxIntervalDays
  });
  const finding = verdict.findings.find((f) => f.active);
  if (!finding || !finding.reason) return null;
  const hold = grazingExposureHolds(verdict, [app], input.timeZone, input.attestations)[input.food];
  if (!hold.held) return null;
  const endsAtMs = hold.clearsAtMs ?? finding.windowEndsAtMs;
  if (input.atMs >= endsAtMs) return null;
  const reason: GrazingReason =
    hold.clearsAtMs === null && finding.reason === 'GRAZING_INTERVAL'
      ? 'GRAZING_UNKNOWN'
      : finding.reason;
  return {
    fieldId: stay.fieldId,
    ref: app.ref,
    productName: app.productName,
    exposedAtMs,
    reason,
    clearsAtMs: hold.clearsAtMs,
    endsAtMs
  };
}

/** One hold per stay and application: the stricter of the two rules. */
function combine(a: ExposureHold | null, b: ExposureHold | null): ExposureHold | null {
  if (!a) return b;
  if (!b) return a;
  const reason = REASON_RANK[b.reason] > REASON_RANK[a.reason] ? b.reason : a.reason;
  const clearsAtMs =
    a.clearsAtMs === null || b.clearsAtMs === null ? null : Math.max(a.clearsAtMs, b.clearsAtMs);
  return {
    ...a,
    reason: clearsAtMs === null && reason === 'GRAZING_INTERVAL' ? 'GRAZING_UNKNOWN' : reason,
    clearsAtMs,
    endsAtMs: Math.max(a.endsAtMs, b.endsAtMs)
  };
}

/**
 * Whether animals on this stay were ever exposed: an application on the
 * Area whose grazing interval was running (or unknown, or forbidden) when
 * they were there, or whose label asks meat animals to be removed before
 * slaughter. Undoing such a move would erase the reason their food is held.
 */
export function stayWasExposed(
  input: Omit<GrazingExposureInput, 'food' | 'atMs' | 'stays'> & {
    stay: ExposureStay;
    nowMs: number;
  }
): boolean {
  const base = { ...input, stays: [input.stay] };
  const apps = input.applicationsByField.get(input.stay.fieldId) ?? [];
  for (const app of apps) {
    if (!Number.isFinite(app.appliedAtMs)) continue;
    const exposedAtMs = Math.max(input.stay.fromMs, app.appliedAtMs);
    const end = input.stay.toMs ?? input.nowMs;
    if (exposedAtMs >= end && input.stay.toMs !== null) continue;
    if (exposedAtMs > input.nowMs) continue;
    for (const food of ['meat', 'milk', 'eggs'] as const) {
      if (exposureHolds({ ...base, food, atMs: exposedAtMs }).length > 0) return true;
    }
  }
  return false;
}

const NOUN: Record<Food, string> = { meat: 'This meat', milk: 'This milk', eggs: 'These eggs' };

function listProducts(products: readonly string[]): string {
  if (products.length <= 1) return products[0] ?? 'a spray';
  return `${products.slice(0, -1).join(', ')} and ${products[products.length - 1]}`;
}

function exposureMessage(
  reason: GrazingReason,
  food: Food,
  use: ProductionUse,
  products: readonly string[],
  clearsAtMs: number | null,
  holdEndsAtMs: number,
  formatDate: (ms: number) => string
): string {
  const noun = NOUN[food];
  const named = listProducts(products);
  if (use === 'feed-to-animals') {
    return `${noun} came from animals that grazed where ${named} was sprayed, inside its grazing time. Only feed it to animals that are not used for food.`;
  }
  if (use === 'unknown') {
    return `${noun} came from animals that grazed where ${named} was sprayed, inside its grazing time. Nobody may eat or sell it yet. Save it as discarded if you are not sure.`;
  }
  if (reason === 'GRAZING_PROHIBITED') {
    return `${noun} came from animals that grazed where ${named} was sprayed, and its label forbids grazing there. It can't be used for food or sold until ${formatDate(holdEndsAtMs)}, when that spray no longer counts. Save as discarded instead.`;
  }
  if (reason === 'GRAZING_UNKNOWN' || clearsAtMs === null) {
    return `${noun} came from animals that grazed where ${named} was sprayed. We don't have the label's grazing time on file, so it can't be used for food or sold yet. The owner can add it from the label. Save as discarded instead.`;
  }
  return `${noun} can't be used for food or sold until ${formatDate(clearsAtMs)}, because the animals grazed where ${named} was sprayed, inside its grazing time. Save as discarded instead.`;
}

/**
 * The exposure half of the food gate. `food` and `sale` block while any
 * exposure hold runs; `discard` always passes; `feed-to-animals` and
 * `unknown` warn, as in the withdrawal gate (C-08).
 */
export function evaluateExposureFoodUse(
  input: GrazingExposureInput & { use: ProductionUse; formatDate: (ms: number) => string }
): ExposureVerdict {
  const { food, use } = input;
  if (use === 'discard') return { status: 'safe', food, use };
  const holds = exposureHolds(input);
  if (holds.length === 0) return { status: 'safe', food, use };
  let reason: GrazingReason = 'GRAZING_INTERVAL';
  for (const h of holds) if (REASON_RANK[h.reason] > REASON_RANK[reason]) reason = h.reason;
  const clearsAtMs =
    reason === 'GRAZING_INTERVAL' && holds.every((h) => h.clearsAtMs !== null)
      ? Math.max(...holds.map((h) => h.clearsAtMs!))
      : null;
  const products = [...new Set(holds.map((h) => h.productName))];
  const holdEndsAtMs = Math.max(...holds.map((h) => h.endsAtMs));
  const gated = GATED_USES.includes(use);
  return {
    status: gated ? 'block' : 'warn',
    reason,
    food,
    use,
    clearsAtMs,
    holdEndsAtMs,
    products,
    holds,
    message: exposureMessage(
      reason,
      food,
      use,
      products,
      clearsAtMs,
      holdEndsAtMs,
      input.formatDate
    ),
    ...(gated ? { resubmitAs: 'discard' as const } : {})
  };
}
