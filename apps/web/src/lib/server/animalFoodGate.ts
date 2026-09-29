/**
 * Server side of the 32C food gate: gathers, through the tenant-scoped
 * repos, everything the pure kernels need to decide whether an animal's or
 * group's meat, milk or eggs may be declared as food at a moment, then runs
 * the withdrawal rule (`lib/safety/animalWithdrawal.ts`) and the grazing
 * exposure rule (`lib/safety/grazingExposure.ts`) over it. The status
 * endpoint uses it for slaughter and sale for meat, and the production
 * endpoints for eggs and milk. Treatments come from the same loader as the
 * health pages, so force-deleted doses (C-26) and open courses count.
 */

import { listLocationsForSubject } from '$lib/db/animalLocations';
import { listBlocks } from '$lib/db/blocks';
import type { SessionRole } from '$lib/server/session';
import {
  evaluateFoodUse,
  FOODS,
  formatClearDate,
  latestDoseReaching,
  physicalWindow,
  summarizeHolds,
  withdrawalNextStep,
  type ReachingDose,
  type Food,
  type FoodSubject,
  type FoodUseVerdict,
  type ProductionUse
} from '$lib/safety/animalWithdrawal';
import {
  evaluateExposureFoodUse,
  parseExposureFloor,
  type ExposureStay,
  type ExposureVerdict
} from '$lib/safety/grazingExposure';
import {
  applicationFieldId,
  presumeLactating,
  type GrazingApplication
} from '$lib/safety/grazingInterval';
import { loadGrazingContext, type GrazingContext } from '$lib/server/areaGrazing';
import { displayFoods, withExposure, type HoldSummaries } from '$lib/animals/holdCopy';
import { getDataKinds } from '$lib/server/registry';
import {
  foodSubjectFor,
  healthPlugins,
  loadTreatments,
  resolveSubject,
  type ResolvedSubject
} from './animalRecords';

export type SubjectType = 'animal' | 'group';

/** Exposure reads keep undone moves (C-35): the animals were still there. */
function groupStays(groupId: string) {
  return listLocationsForSubject('group', groupId, { includeDeleted: true });
}

function animalStays(animalId: string) {
  return listLocationsForSubject('animal', animalId, { includeDeleted: true });
}

function clip(
  stays: readonly {
    fieldId: string;
    fromMs: number;
    toMs: number | null;
    exposureFloor?: string | null;
  }[],
  window: { fromMs: number | null; toMs: number | null }
): ExposureStay[] {
  const out: ExposureStay[] = [];
  for (const s of stays) {
    if (s.toMs !== null && s.toMs === s.fromMs) continue;
    const fromMs = window.fromMs === null ? s.fromMs : Math.max(s.fromMs, window.fromMs);
    const ends = [s.toMs, window.toMs].filter((v): v is number => v !== null);
    const toMs = ends.length ? Math.min(...ends) : null;
    if (toMs !== null && toMs <= fromMs) continue;
    const floor = parseExposureFloor(s.exposureFloor);
    out.push({ fieldId: s.fieldId, fromMs, toMs, ...(floor.length ? { floor } : {}) });
  }
  return out;
}

/** Where the food could have grazed: the subject's own stays, its groups'
 *  stays while it was a member, the parent groups' stays before a split
 *  and, for a group's eggs and milk, each current member's own stays and
 *  its earlier groups' stays while it was in them (C-16). */
function exposureStays(subject: FoodSubject, food: Food, atMs: number): ExposureStay[] {
  const all = { fromMs: null, toMs: null };
  if (subject.type === 'animal') {
    const out = clip(animalStays(subject.id), all);
    for (const m of subject.memberships.map(physicalWindow)) {
      out.push(...clip(groupStays(m.groupId), m));
    }
    return out;
  }
  const out = clip(groupStays(subject.id), all);
  for (const l of subject.lineage ?? []) out.push(...clip(groupStays(l.groupId), l));
  if (food !== 'meat') {
    for (const member of subject.members) {
      const inGroupNow = member.memberships.some(
        (m) =>
          m.groupId === subject.id &&
          (m.fromMs === null || m.fromMs <= atMs) &&
          (m.toMs === null || atMs < m.toMs)
      );
      if (!inGroupNow) continue;
      out.push(...clip(animalStays(member.animalId), all));
      for (const m of member.memberships.map(physicalWindow)) {
        if (m.groupId !== subject.id) out.push(...clip(groupStays(m.groupId), m));
      }
    }
  }
  return out;
}

/** The latest recorded dose that reached this subject's meat, live or
 *  force-deleted as given (C-26). A meat declaration dated earlier is
 *  refused: the dose shows the animal was still alive. */
export function latestDoseFor(subjectType: SubjectType, subjectId: string): ReachingDose | null {
  const ctx = foodSubjectFor(subjectType, subjectId);
  if (!ctx) return null;
  return latestDoseReaching(ctx.subject, loadTreatments(ctx.related));
}

export interface FoodStop {
  code: string;
  error: string;
  food: Food;
  use: ProductionUse;
  clearsAtMs: number | null;
  clearsOn: string | null;
  overridable: false;
  products: string[];
  resubmitAs?: 'discard';
  askOwner: boolean;
  /** Areas whose missing grazing time the owner can add from the label. */
  grazingFieldIds: string[];
  /** What lifts the stop, so the UI can offer the right form. */
  nextStep: FoodNextStep;
  /** When the stop lifts even with no clear date: the end of the grazing
   *  lookback for a spray whose label forbids grazing. */
  holdEndsAtMs: number | null;
  holdEndsOn: string | null;
}

export type FoodNextStep =
  'wait' | 'last-dose' | 'add-withdrawal' | 'contact-support' | 'add-grazing-time' | 'never';

export interface FoodCheck {
  withdrawal: FoodUseVerdict;
  exposure: ExposureVerdict;
  /** Set when either rule blocks the declaration. */
  stop: FoodStop | null;
  /** Plain-English warnings for uses that are allowed but held. */
  warnings: string[];
}

const OWNER_NOTE = /The owner can ([^.]+)\./g;

const DISCARD_NOTE = /Save as discarded instead\./g;

const DISCARD_SENTENCE = 'Save as discarded instead.';

/** One message per blocking rule, with the way out said once, at the end. */
export function joinStops(messages: readonly string[], wayOut: string): string {
  let found = false;
  const parts = messages.map((m) => {
    if (!m.includes(wayOut)) return m.trim();
    found = true;
    return m.split(wayOut).join(' ').replace(/\s+/g, ' ').trim();
  });
  const text = parts.filter(Boolean).join(' ');
  return found ? `${text} ${wayOut}` : text;
}

function forRole(message: string, role: SessionRole, instead?: string): string {
  const text = instead ? message.replace(DISCARD_NOTE, instead) : message;
  if (role === 'owner') return text;
  return text.replace(OWNER_NOTE, (_m, step: string) => `Ask the owner to ${step}.`);
}

function exposureRule(
  grazing: GrazingContext,
  resolved: ResolvedSubject | null,
  kinds: Awaited<ReturnType<typeof getDataKinds>>,
  stays: ExposureStay[]
) {
  const areaOf = new Map(listBlocks({ plantings: 'none' }).map((b) => [b.id, b.fieldId ?? null]));
  const applicationsByField = new Map<string, GrazingApplication[]>();
  for (const a of grazing.applications) {
    const fieldId = applicationFieldId(a, areaOf);
    if (!fieldId) continue;
    const list = applicationsByField.get(fieldId) ?? [];
    list.push(a);
    applicationsByField.set(fieldId, list);
  }
  const speciesId = resolved?.speciesId ?? null;
  const products = (speciesId && kinds.species.get(speciesId)?.products) || [];
  const sex = resolved?.sex ?? undefined;
  return (q: { food: Food; use: ProductionUse; atMs: number; timeZone: string }) =>
    evaluateExposureFoodUse({
      stays: applicationsByField.size ? stays : [],
      applicationsByField,
      attestations: grazing.attestations,
      subject: { speciesId, lactating: presumeLactating({ speciesProducts: products, sex }) },
      food: q.food,
      use: q.use,
      atMs: q.atMs,
      timeZone: q.timeZone,
      registryMaxIntervalDays: grazing.registryMaxIntervalDays,
      formatDate: (ms) => formatClearDate(ms, q.timeZone)
    });
}

export interface PageHolds {
  holds: HoldSummaries;
  /** Foods this subject gives, for display only (the gate covers all). */
  foods: Food[];
}

/**
 * C-33 on the animal pages: one chip per food, from the withdrawal rule and
 * the grazing exposure rule together, limited to the foods the animal
 * gives. A household pet that never counted as a food animal gets none.
 */
export async function pageHoldsFor(
  subjectType: SubjectType,
  subjectId: string,
  timeZone: string,
  atMs: number = Date.now()
): Promise<PageHolds | null> {
  const ctx = foodSubjectFor(subjectType, subjectId);
  const resolved = resolveSubject(subjectType, subjectId);
  if (!ctx || !resolved) return null;
  const kinds = await getDataKinds();
  const foods = displayFoods(
    kinds.species.get(resolved.speciesId) ?? null,
    resolved.sex,
    resolved.foodProducing
  );
  const plugins = await healthPlugins();
  const summary = summarizeHolds({
    subject: ctx.subject,
    atMs,
    treatments: loadTreatments(ctx.related),
    plugins,
    timeZone
  });
  if (foods.length === 0) return { holds: summary, foods };
  const stays = exposureStays(ctx.subject, 'milk', atMs);
  const earliest = stays.reduce((m, st) => Math.min(m, st.fromMs), atMs);
  const grazing = await loadGrazingContext(Date.now(), { fromAtMs: earliest });
  const holds = {} as HoldSummaries;
  for (const food of FOODS) {
    const own = food === 'meat' ? exposureStays(ctx.subject, 'meat', atMs) : stays;
    const ex = exposureRule(grazing, resolved, kinds, own)({ food, use: 'food', atMs, timeZone });
    holds[food] = withExposure(summary[food], ex);
  }
  return { holds, foods };
}

function nextStepFor(withdrawal: FoodUseVerdict, exposure: ExposureVerdict): FoodNextStep {
  if (withdrawal.status === 'block') {
    if (withdrawal.reason === 'PROHIBITED_DRUG') return 'never';
    if (withdrawal.reason === 'WITHDRAWAL_UNKNOWN') {
      return withdrawalNextStep(withdrawal.holds) ?? 'add-withdrawal';
    }
  }
  if (exposure.status === 'block' && exposure.reason === 'GRAZING_UNKNOWN') {
    return 'add-grazing-time';
  }
  return 'wait';
}

/**
 * Runs both food rules for one declaration. `role` only changes the wording:
 * a helper is told to ask the owner, and nobody has an override (C-32).
 */
export async function checkFoodUse(input: {
  subjectType: SubjectType;
  subjectId: string;
  food: Food;
  use: ProductionUse;
  atMs: number;
  role: SessionRole;
  timeZone: string;
  /** Replaces "Save as discarded instead." where discarding is not the way out. */
  instead?: string;
}): Promise<FoodCheck> {
  const ctx = foodSubjectFor(input.subjectType, input.subjectId);
  const resolved = resolveSubject(input.subjectType, input.subjectId);
  const subject: FoodSubject =
    ctx?.subject ??
    (input.subjectType === 'animal'
      ? { type: 'animal', id: input.subjectId, memberships: [] }
      : { type: 'group', id: input.subjectId, lineage: [], members: [] });
  const stays = exposureStays(subject, input.food, input.atMs);
  const earliest = stays.reduce((m, st) => Math.min(m, st.fromMs), input.atMs);
  const [plugins, kinds, grazing] = await Promise.all([
    healthPlugins(),
    getDataKinds(),
    loadGrazingContext(Date.now(), { fromAtMs: earliest })
  ]);
  const treatments = ctx ? loadTreatments(ctx.related) : [];

  const withdrawal = evaluateFoodUse({
    subject,
    food: input.food,
    use: input.use,
    atMs: input.atMs,
    treatments,
    plugins,
    timeZone: input.timeZone
  });

  const exposure = exposureRule(
    grazing,
    resolved,
    kinds,
    stays
  )({
    food: input.food,
    use: input.use,
    atMs: input.atMs,
    timeZone: input.timeZone
  });

  let stop: FoodStop | null = null;
  const blocking = [withdrawal, exposure].filter((v) => v.status === 'block');
  if (blocking.length) {
    const first = blocking[0] as Exclude<FoodUseVerdict | ExposureVerdict, { status: 'safe' }>;
    const unknown = blocking.some(
      (v) => v.status === 'block' && /UNKNOWN$/.test(v.reason as string)
    );
    const clears = blocking.map((v) => (v.status === 'block' ? v.clearsAtMs : null));
    const clearsAtMs = clears.every((c) => c !== null) ? Math.max(...(clears as number[])) : null;
    const prohibitedGrazing =
      exposure.status === 'block' &&
      exposure.reason === 'GRAZING_PROHIBITED' &&
      withdrawal.status !== 'block'
        ? exposure.holdEndsAtMs
        : null;
    stop = {
      code: first.reason,
      error: joinStops(
        blocking.map((v) =>
          v.status === 'block' ? forRole(v.message, input.role, input.instead) : ''
        ),
        input.instead ?? DISCARD_SENTENCE
      ),
      food: input.food,
      use: input.use,
      clearsAtMs,
      clearsOn: clearsAtMs === null ? null : formatClearDate(clearsAtMs, input.timeZone),
      overridable: false,
      products: [...new Set(blocking.flatMap((v) => (v.status === 'block' ? v.products : [])))],
      resubmitAs: 'discard',
      askOwner: unknown && input.role !== 'owner',
      grazingFieldIds:
        exposure.status === 'block' && exposure.reason === 'GRAZING_UNKNOWN'
          ? [...new Set(exposure.holds.map((h) => h.fieldId))]
          : [],
      nextStep: nextStepFor(withdrawal, exposure),
      holdEndsAtMs: prohibitedGrazing,
      holdEndsOn:
        prohibitedGrazing === null ? null : formatClearDate(prohibitedGrazing, input.timeZone)
    };
  }
  const warnings = [withdrawal, exposure]
    .filter((v) => v.status === 'warn')
    .map((v) => (v.status === 'warn' ? forRole(v.message, input.role) : ''));
  return { withdrawal, exposure, stop, warnings };
}
