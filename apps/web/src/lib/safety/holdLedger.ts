/**
 * Phase 32C ruling C-35: holds never shorten (invariant I1).
 *
 * A hold is a stretch of time in which a subject may not be used for a
 * purpose: meat, milk or eggs under a withdrawal or a grazing exposure, the
 * label's pre-slaughter removal, and grazing or haying on an Area inside a
 * label interval. `projectHolds` turns the whole farm's hold facts into
 * those stretches, per subject and purpose, plus the set of declarations
 * and stays a hold covers (the C-06 set). `shortenings` compares two
 * projections over all of time. The server guard (`lib/server/holdGuard.ts`)
 * projects the farm before and after every write, in one transaction, and
 * refuses the write when anything held before is not held after.
 *
 * Every hold is computed by the existing kernels (`treatmentHoldSpans`,
 * `exposureSpans`, `evaluateGrazing`, `evaluateHayCut`), so the ledger and
 * the gates can never disagree about what a hold is. Open facts (a stay
 * with no end, a course with no last dose) are closed at `nowMs`, so a
 * record dated now can never shorten a hold, and a backdated record that
 * only adds holds always passes.
 *
 * Pure: no DB, env or clock reads.
 */

import {
  FOODS,
  computeWithdrawalClear,
  treatmentHoldSpans,
  type Food,
  type GroupMembership,
  type PluginLookup,
  type TreatmentRecord,
  type WithdrawalClear
} from './animalWithdrawal';
import {
  lineageFromStays,
  membershipsFromStays,
  type MembershipStay
} from '$lib/animals/membership';
import {
  exposureSpansFast,
  newExposureSpanCache,
  type ExposureFloorEntry,
  type ExposureSpanCache,
  type ExposureStay
} from './grazingExposure';
import {
  DAY_MS,
  GRAZING_LOOKBACK_DAYS,
  STRICTEST_SUBJECT,
  evaluateGrazing,
  evaluateHayCut,
  presumeLactating,
  registryMaxIntervalDays,
  type GrazingApplication,
  type GrazingAttestationInput
} from './grazingInterval';

// ─── Vocabulary ─────────────────────────────────────────────────────────

export const HOLD_KINDS = ['meat', 'milk', 'eggs', 'preSlaughter', 'graze', 'hay'] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export type HoldBasis = 'known' | 'unknown' | 'prohibited';

/** `animal:<id>`, `group:<id>` (a flock's own eggs and milk) or
 *  `area:<field id>` (a block with no Area: `block:<id>`). Never a
 *  source-record id, so a split, join, leave or rename cannot drop a key. */
export type SubjectKey = string;

export interface Span {
  fromMs: number;
  /** Exclusive; `Infinity` for a prohibited drug or an unknown label. */
  toMs: number;
  basis: HoldBasis;
}

/** What a kind of record does to holds. */
export type FactEffect = 'opens' | 'closes' | 'declares';

export const FACT_KINDS = [
  'health-dose',
  'application',
  'stay-start',
  'animal-created-with-housing',
  'group-join',
  'split-child-lineage',
  'block-assignment',
  'stay-end',
  'group-leave',
  'split-parent-end',
  'block-delete-or-reassign',
  'status-outcome',
  'pre-slaughter-removal',
  'label-answer',
  'animal-attributes',
  'slaughter',
  'sale-for-meat',
  'production-food',
  'hay-step',
  'forage-harvest',
  'meat-declaration'
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Every fact kind, classified. A new kind fails typecheck until it is. */
export const FACT_EFFECT = {
  'health-dose': 'opens',
  application: 'opens',
  'stay-start': 'opens',
  'animal-created-with-housing': 'opens',
  'group-join': 'opens',
  'split-child-lineage': 'opens',
  'block-assignment': 'opens',
  'stay-end': 'closes',
  'group-leave': 'closes',
  'split-parent-end': 'closes',
  'block-delete-or-reassign': 'closes',
  'status-outcome': 'closes',
  'pre-slaughter-removal': 'closes',
  'label-answer': 'closes',
  'animal-attributes': 'closes',
  slaughter: 'declares',
  'sale-for-meat': 'declares',
  'production-food': 'declares',
  'hay-step': 'declares',
  'forage-harvest': 'declares',
  'meat-declaration': 'declares'
} as const satisfies Record<FactKind, FactEffect>;

export function isDeclaration(kind: FactKind): boolean {
  return FACT_EFFECT[kind] === 'declares';
}

// ─── Facts ──────────────────────────────────────────────────────────────

export interface SubjectFact {
  kind: 'subject';
  subjectType: 'animal' | 'group';
  id: string;
  speciesId: string;
  sex: string | null;
  /** The animal's group now; null for a group or an ungrouped animal. */
  currentGroupId: string | null;
  /** What the species gives (for the presumed-lactating reading, C-10). */
  speciesProducts: readonly string[];
}

export interface DoseFact {
  kind: 'dose';
  treatment: TreatmentRecord;
}

export interface StayFact {
  kind: 'stay';
  id: string;
  subjectType: 'animal' | 'group';
  subjectId: string;
  fieldId: string;
  fromMs: number;
  toMs: number | null;
  fromGroupId: string | null;
  toGroupId: string | null;
  floor: readonly ExposureFloorEntry[];
  /** Undone, but still counting (a tombstone). */
  deleted: boolean;
}

export interface ApplicationFact {
  kind: 'application';
  application: GrazingApplication;
}

export interface BlockAssignmentFact {
  kind: 'block-assignment';
  blockId: string;
  fieldId: string | null;
}

export interface AttestationFact {
  kind: 'attestation';
  attestation: GrazingAttestationInput;
}

export interface ProductionFact {
  kind: 'production';
  id: string;
  subjectType: 'animal' | 'group';
  subjectId: string;
  food: Food;
  /** The strongest food or sale use it was ever saved as (C-06). */
  declaredUse: 'food' | 'sale' | null;
  occurredAtMs: number;
  deleted: boolean;
}

export interface StatusFact {
  kind: 'status';
  id: string;
  subjectType: 'animal' | 'group';
  subjectId: string;
  status: string;
  /** Declares meat as food (C-17). */
  declaresMeat: boolean;
  occurredAtMs: number;
  deleted: boolean;
}

export interface HayFact {
  kind: 'hay';
  /** A hay cutting, or a harvest on a forage block. */
  source?: 'hay' | 'harvest';
  id: string;
  blockId: string;
  /** The mow and every later dated step. */
  datesMs: readonly number[];
}

export type HoldFact =
  | SubjectFact
  | DoseFact
  | StayFact
  | ApplicationFact
  | BlockAssignmentFact
  | AttestationFact
  | ProductionFact
  | StatusFact
  | HayFact;

/** The fact kinds each stored fact stands for. Exhaustive over `HoldFact`. */
export const HOLD_FACT_KINDS = {
  subject: ['animal-created-with-housing', 'animal-attributes'],
  dose: ['health-dose'],
  stay: ['stay-start', 'stay-end', 'group-join', 'group-leave', 'split-child-lineage'],
  application: ['application'],
  'block-assignment': ['block-assignment', 'block-delete-or-reassign'],
  attestation: ['label-answer'],
  production: ['production-food'],
  status: ['status-outcome', 'slaughter', 'sale-for-meat', 'meat-declaration'],
  hay: ['hay-step', 'forage-harvest']
} as const satisfies Record<HoldFact['kind'], readonly FactKind[]>;

export interface ProjectionContext {
  plugins: PluginLookup;
  timeZone: string;
  registryMaxIntervalDays: number;
  /** Withdrawal verdicts keyed by the treatment, its plugin data and the
   *  time zone, so they can be reused across projections. */
  verdictCache?: Map<string, WithdrawalClear>;
}

/** The plugin data a treatment's verdict reads, so a cached verdict is
 *  only reused while that data is unchanged. */
function pluginIdsOf(t: TreatmentRecord): string[] {
  const ids = t.productPluginId ? [t.productPluginId] : [];
  if (t.entries !== 'invalid') {
    for (const e of t.entries) if (e.kind === 'product') ids.push(e.pluginId);
  }
  return ids;
}

/** One verdict per treatment for the whole projection. */
function verdictsFor(doses: readonly TreatmentRecord[], ctx: ProjectionContext) {
  const out = new Map<string, WithdrawalClear>();
  for (const t of doses) {
    const key = ctx.verdictCache
      ? JSON.stringify([ctx.timeZone, t, pluginIdsOf(t).map((id) => ctx.plugins(id) ?? null)])
      : '';
    let clear = ctx.verdictCache?.get(key);
    if (!clear) {
      clear = computeWithdrawalClear(t, ctx.plugins, { timeZone: ctx.timeZone });
      ctx.verdictCache?.set(key, clear);
    }
    out.set(t.id, clear);
  }
  return out;
}

export interface HoldProjection {
  /** `${key}|${kind}` → merged spans. */
  holds: Map<string, Span[]>;
  /** Declarations and stays a hold covers (the C-06 set), with how sure. */
  covered: Map<string, HoldBasis>;
}

export function holdMapKey(key: SubjectKey, kind: HoldKind): string {
  return `${key}|${kind}`;
}

export function splitHoldMapKey(k: string): { key: SubjectKey; kind: HoldKind } {
  const at = k.lastIndexOf('|');
  return { key: k.slice(0, at), kind: k.slice(at + 1) as HoldKind };
}

// ─── Span algebra ───────────────────────────────────────────────────────

const BASIS_RANK: Record<HoldBasis, number> = { unknown: 0, known: 1, prohibited: 2 };
const BASIS_INDEX = BASIS_RANK;
const BASES: readonly HoldBasis[] = ['unknown', 'known', 'prohibited'];

function stronger(a: HoldBasis, b: HoldBasis): HoldBasis {
  return BASIS_RANK[a] >= BASIS_RANK[b] ? a : b;
}

/** Non-overlapping spans, sorted; where spans overlap the strongest basis
 *  wins, so a known hold is never hidden behind an unknown one. */
/** Arrays `normalizeSpans` produced, so a key fed one of them as is skips
 *  normalizing it again. */
const NORMALIZED = new WeakSet<readonly Span[]>();

/** Six reusable buffers (a start and an end list per basis). Safe because
 *  `normalizeSpans` is synchronous and never re-entered. */
const SCRATCH: Float64Array[] = Array.from({ length: 6 }, () => new Float64Array(64));

function scratch(slot: number, size: number): Float64Array {
  if (SCRATCH[slot].length < size) SCRATCH[slot] = new Float64Array(Math.max(size, SCRATCH[slot].length * 2));
  return SCRATCH[slot].subarray(0, size);
}

export function normalizeSpans(spans: readonly Span[]): Span[] {
  const n = spans.length;
  if (n === 1 && spans[0].toMs > spans[0].fromMs) {
    const out = [{ fromMs: spans[0].fromMs, toMs: spans[0].toMs, basis: spans[0].basis }];
    NORMALIZED.add(out);
    return out;
  }
  const counts = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const s = spans[i];
    if (s.toMs > s.fromMs) counts[BASIS_INDEX[s.basis]]++;
  }
  const starts = counts.map((c, b) => scratch(b * 2, c));
  const ends = counts.map((c, b) => scratch(b * 2 + 1, c));
  const fill = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const s = spans[i];
    if (!(s.toMs > s.fromMs)) continue;
    const b = BASIS_INDEX[s.basis];
    starts[b][fill[b]] = s.fromMs;
    ends[b][fill[b]] = s.toMs;
    fill[b]++;
  }
  for (let b = 0; b < 3; b++) {
    starts[b].sort();
    ends[b].sort();
  }
  const si = [0, 0, 0];
  const ei = [0, 0, 0];
  const open = [0, 0, 0];
  const out: Span[] = [];
  const nextEvent = () => {
    let at = Number.POSITIVE_INFINITY;
    for (let b = 0; b < 3; b++) {
      if (si[b] < starts[b].length && starts[b][si[b]] < at) at = starts[b][si[b]];
      if (ei[b] < ends[b].length && ends[b][ei[b]] < at) at = ends[b][ei[b]];
    }
    return at;
  };
  let at = nextEvent();
  while (Number.isFinite(at)) {
    for (let b = 0; b < 3; b++) {
      while (si[b] < starts[b].length && starts[b][si[b]] === at) {
        open[b]++;
        si[b]++;
      }
      while (ei[b] < ends[b].length && ends[b][ei[b]] === at) {
        open[b]--;
        ei[b]++;
      }
    }
    const next = nextEvent();
    const b = open[2] > 0 ? 2 : open[1] > 0 ? 1 : open[0] > 0 ? 0 : -1;
    if (b >= 0) {
      const basis = BASES[b];
      const last = out[out.length - 1];
      if (last && last.toMs === at && last.basis === basis) last.toMs = next;
      else out.push({ fromMs: at, toMs: next, basis });
    }
    at = next;
  }
  NORMALIZED.add(out);
  return out;
}

/** The parts of `a` not covered by any of `b`. Both normalized. */
export function subtractSpans(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const s of a) {
    let pieces: Span[] = [{ ...s }];
    for (const c of b) {
      const next: Span[] = [];
      for (const p of pieces) {
        if (c.toMs <= p.fromMs || c.fromMs >= p.toMs) {
          next.push(p);
          continue;
        }
        if (c.fromMs > p.fromMs) next.push({ ...p, toMs: c.fromMs });
        if (c.toMs < p.toMs) next.push({ ...p, fromMs: c.toMs });
      }
      pieces = next;
      if (pieces.length === 0) break;
    }
    out.push(...pieces);
  }
  return out;
}

export function spansContain(spans: readonly Span[], atMs: number): HoldBasis | null {
  let basis: HoldBasis | null = null;
  for (const s of spans) {
    if (s.fromMs <= atMs && atMs < s.toMs)
      basis = basis === null ? s.basis : stronger(basis, s.basis);
  }
  return basis;
}

// ─── Projection ─────────────────────────────────────────────────────────

interface Buckets {
  subjects: Map<string, SubjectFact>;
  doses: TreatmentRecord[];
  stays: StayFact[];
  applications: GrazingApplication[];
  fieldOfBlock: Map<string, string | null>;
  attestations: GrazingAttestationInput[];
  production: ProductionFact[];
  status: StatusFact[];
  hay: HayFact[];
}

const subjectRef = (type: 'animal' | 'group', id: string) => `${type}:${id}`;

/** C-35 truncation: an open stay or course is read as closed at `nowMs`. */
function bucket(facts: readonly HoldFact[], nowMs: number): Buckets {
  const b: Buckets = {
    subjects: new Map(),
    doses: [],
    stays: [],
    applications: [],
    fieldOfBlock: new Map(),
    attestations: [],
    production: [],
    status: [],
    hay: []
  };
  for (const f of facts) {
    switch (f.kind) {
      case 'subject':
        b.subjects.set(subjectRef(f.subjectType, f.id), f);
        break;
      case 'dose': {
        const t = f.treatment;
        const ends = t.entries !== 'invalid' && t.entries.some((e) => e.kind === 'course-end');
        b.doses.push(
          t.courseOpen && !ends
            ? {
                ...t,
                courseOpen: false,
                courseEndAtMs: Math.max(t.administeredAtMs, t.courseEndAtMs ?? nowMs, nowMs)
              }
            : t
        );
        break;
      }
      case 'stay':
        b.stays.push(f.toMs === null ? { ...f, toMs: Math.max(f.fromMs, nowMs) } : f);
        break;
      case 'application':
        b.applications.push(f.application);
        break;
      case 'block-assignment':
        b.fieldOfBlock.set(f.blockId, f.fieldId);
        break;
      case 'attestation':
        b.attestations.push(f.attestation);
        break;
      case 'production':
        b.production.push(f);
        break;
      case 'status':
        b.status.push(f);
        break;
      case 'hay':
        b.hay.push(f);
        break;
    }
  }
  b.stays.sort((x, y) => x.fromMs - y.fromMs || x.id.localeCompare(y.id));
  return b;
}

function membershipStays(stays: readonly StayFact[]): MembershipStay[] {
  return stays
    .filter((s) => !s.deleted)
    .map((s) => ({
      fromMs: s.fromMs,
      toMs: s.toMs,
      fromGroupId: s.fromGroupId,
      toGroupId: s.toGroupId
    }));
}

function areaKeyOfBlock(b: Buckets, blockId: string): SubjectKey {
  const fieldId = b.fieldOfBlock.get(blockId);
  return fieldId ? `area:${fieldId}` : `block:${blockId}`;
}

interface Model {
  exposureCache: ExposureSpanCache;
  /** Normalized exposure of one group window, by group, window, reading and food. */
  windowSpans: Map<string, Span[]>;
  /** Normalized withdrawal holds of a group's doses over some windows. */
  groupDoseSpans: Map<string, Span[]>;
  /** Treatments recorded on a subject, by `type:id`. */
  dosesOf: (type: 'animal' | 'group', id: string) => TreatmentRecord[];
  staysOf: (type: 'animal' | 'group', id: string) => StayFact[];
  memberships: (animalId: string) => GroupMembership[];
  lineage: (groupId: string) => GroupMembership[];
  membersEver: (groupId: string) => string[];
  appsByField: Map<string, GrazingApplication[]>;
}

function model(b: Buckets, nowMs: number): Model {
  const byRef = new Map<string, StayFact[]>();
  for (const s of b.stays) {
    const k = subjectRef(s.subjectType, s.subjectId);
    const list = byRef.get(k) ?? [];
    list.push(s);
    byRef.set(k, list);
  }
  const staysOf = (type: 'animal' | 'group', id: string) => byRef.get(subjectRef(type, id)) ?? [];
  const memberCache = new Map<string, GroupMembership[]>();
  const memberships = (animalId: string) => {
    let m = memberCache.get(animalId);
    if (!m) {
      const current = b.subjects.get(subjectRef('animal', animalId))?.currentGroupId ?? null;
      m = membershipsFromStays(current, membershipStays(staysOf('animal', animalId))).map((w) =>
        w.toMs === null ? { ...w, toMs: Math.max(nowMs, w.fromMs ?? nowMs) } : w
      );
      memberCache.set(animalId, m);
    }
    return m;
  };
  const lineage = (groupId: string) =>
    lineageFromStays(
      membershipStays(staysOf('group', groupId)),
      (parent) => membershipStays(staysOf('group', parent)),
      groupId
    );
  const everIn = new Map<string, Set<string>>();
  const note = (groupId: string, animalId: string) => {
    const set = everIn.get(groupId) ?? new Set<string>();
    set.add(animalId);
    everIn.set(groupId, set);
  };
  for (const s of b.subjects.values()) {
    if (s.subjectType !== 'animal') continue;
    if (s.currentGroupId) note(s.currentGroupId, s.id);
    for (const m of memberships(s.id)) note(m.groupId, s.id);
  }
  const appsByField = new Map<string, GrazingApplication[]>();
  for (const a of b.applications) {
    const fieldId = b.fieldOfBlock.get(a.blockId);
    if (!fieldId) continue;
    const list = appsByField.get(fieldId) ?? [];
    list.push(a);
    appsByField.set(fieldId, list);
  }
  const doses = new Map<string, TreatmentRecord[]>();
  for (const t of b.doses) {
    const k = subjectRef(t.subjectType, t.subjectId);
    const list = doses.get(k) ?? [];
    list.push(t);
    doses.set(k, list);
  }
  return {
    exposureCache: newExposureSpanCache(),
    windowSpans: new Map(),
    groupDoseSpans: new Map(),
    dosesOf: (type, id) => doses.get(subjectRef(type, id)) ?? [],
    staysOf,
    memberships,
    lineage,
    membersEver: (groupId) => [...(everIn.get(groupId) ?? [])],
    appsByField
  };
}

function clip(stays: readonly StayFact[], w: GroupMembership): ExposureStay[] {
  const out: ExposureStay[] = [];
  for (const s of stays) {
    if (s.toMs !== null && s.toMs === s.fromMs) continue;
    const fromMs = w.fromMs === null ? s.fromMs : Math.max(s.fromMs, w.fromMs);
    const ends = [s.toMs, w.toMs].filter((v): v is number => v !== null);
    const toMs = ends.length ? Math.min(...ends) : null;
    if (toMs !== null && toMs <= fromMs) continue;
    out.push({ fieldId: s.fieldId, fromMs, toMs, ...(s.floor.length ? { floor: s.floor } : {}) });
  }
  return out;
}

const ALL: GroupMembership = { groupId: '', fromMs: null, toMs: null };

/** An animal's own exposure: its stays and its groups' stays while it was
 *  a member (the food gate's `exposureStays`). */
function animalExposureStays(m: Model, animalId: string, skipGroup?: string): ExposureStay[] {
  const out = clip(m.staysOf('animal', animalId), ALL);
  for (const w of m.memberships(animalId)) {
    if (w.groupId === skipGroup) continue;
    out.push(...clip(m.staysOf('group', w.groupId), w));
  }
  return out;
}

function lactatingOf(s: SubjectFact | undefined): boolean {
  if (!s) return true;
  return presumeLactating({ speciesProducts: s.speciesProducts, sex: s.sex });
}

function exposureInputFor(
  m: Model,
  ctx: ProjectionContext,
  b: Buckets,
  subject: SubjectFact | undefined,
  stays: ExposureStay[],
  food: Food
) {
  return {
    stays,
    applicationsByField: m.appsByField,
    attestations: b.attestations,
    subject: { speciesId: subject?.speciesId ?? null, lactating: lactatingOf(subject) },
    food,
    timeZone: ctx.timeZone,
    registryMaxIntervalDays: ctx.registryMaxIntervalDays
  };
}

function intersect(spans: readonly Span[], windows: readonly GroupMembership[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    for (const w of windows) {
      const fromMs = Math.max(s.fromMs, w.fromMs ?? Number.NEGATIVE_INFINITY);
      const toMs = Math.min(s.toMs, w.toMs ?? Number.POSITIVE_INFINITY);
      if (toMs > fromMs) out.push({ fromMs, toMs, basis: s.basis });
    }
  }
  return out;
}

/** The treatments that can reach a group: its own, its parents' and, for
 *  eggs and milk, its members' own and their other groups'. */
function groupDoses(
  m: Model,
  groupId: string,
  lineage: readonly GroupMembership[],
  members: readonly { animalId: string; memberships: readonly GroupMembership[] }[]
): TreatmentRecord[] {
  const seen = new Set<string>();
  const out: TreatmentRecord[] = [];
  const addAll = (list: readonly TreatmentRecord[]) => {
    for (const t of list) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  };
  addAll(m.dosesOf('group', groupId));
  for (const l of lineage) addAll(m.dosesOf('group', l.groupId));
  for (const member of members) addAll(animalDoses(m, member.animalId, member.memberships));
  return out;
}

/** The treatments that can reach an animal: its own and its groups'. */
function animalDoses(
  m: Model,
  animalId: string,
  memberships: readonly GroupMembership[]
): TreatmentRecord[] {
  const out = [...m.dosesOf('animal', animalId)];
  for (const g of new Set(memberships.map((w) => w.groupId))) out.push(...m.dosesOf('group', g));
  return out;
}

/** An animal's withdrawal holds, in chunks: its own doses, then each
 *  group's doses over its windows in that group. The group chunk depends
 *  only on the group and the windows, so flock members share it. */
function withdrawalAnimal(
  m: Model,
  b: Buckets,
  ctx: ProjectionContext,
  clears: Map<string, WithdrawalClear>,
  animalId: string,
  food: Food
): Span[][] {
  const memberships = m.memberships(animalId);
  const base = { food, plugins: ctx.plugins, timeZone: ctx.timeZone };
  const chunks: Span[][] = [
    treatmentHoldSpans(
      {
        ...base,
        subject: { type: 'animal', id: animalId, memberships },
        treatments: m.dosesOf('animal', animalId)
      },
      clears
    )
  ];
  const byGroup = new Map<string, GroupMembership[]>();
  for (const w of memberships) byGroup.set(w.groupId, [...(byGroup.get(w.groupId) ?? []), w]);
  for (const [groupId, windows] of byGroup) {
    const doses = m.dosesOf('group', groupId);
    if (doses.length === 0) continue;
    const key = `${groupId}|${food}|${windows.map((w) => `${w.fromMs}-${w.toMs}`).join(',')}`;
    let spans = m.groupDoseSpans.get(key);
    if (!spans) {
      spans = normalizeSpans(
        treatmentHoldSpans(
          { ...base, subject: { type: 'animal', id: '', memberships: windows }, treatments: doses },
          clears
        )
      );
      m.groupDoseSpans.set(key, spans);
    }
    chunks.push(spans);
  }
  return chunks;
}

/** Exposure from the stays of the animal itself and of every group it was
 *  in (except `skipGroup`), each group window computed once per projection
 *  and reading: flock members share their flock's stays. */
function memberExposure(
  m: Model,
  b: Buckets,
  ctx: ProjectionContext,
  animalId: string,
  reading: SubjectFact | undefined,
  food: Food,
  skipGroup?: string
): Span[] {
  if (m.appsByField.size === 0) return [];
  const own = m.staysOf('animal', animalId);
  const windows = m.memberships(animalId).filter((w) => w.groupId !== skipGroup);
  if (own.length === 0 && windows.length === 1) {
    return windowExposure(m, b, ctx, windows[0], reading, food);
  }
  const out: Span[] = exposureSpansFast(
    exposureInputFor(m, ctx, b, reading, clip(m.staysOf('animal', animalId), ALL), food),
    m.exposureCache
  );
  for (const w of windows) {
    for (const sp of windowExposure(m, b, ctx, w, reading, food)) out.push(sp);
  }
  return out;
}

/** One group window's exposure, normalized, computed once per projection. */
function windowExposure(
  m: Model,
  b: Buckets,
  ctx: ProjectionContext,
  w: GroupMembership,
  reading: SubjectFact | undefined,
  food: Food
): Span[] {
  const key = `${w.groupId}|${w.fromMs}|${w.toMs}|${reading?.speciesId ?? null}|${lactatingOf(reading)}|${food}`;
  let spans = m.windowSpans.get(key);
  if (!spans) {
    spans = normalizeSpans(
      exposureSpansFast(
        exposureInputFor(m, ctx, b, reading, clip(m.staysOf('group', w.groupId), w), food),
        m.exposureCache
      )
    );
    m.windowSpans.set(key, spans);
  }
  return spans;
}

function exposureAnimal(
  m: Model,
  b: Buckets,
  ctx: ProjectionContext,
  animalId: string,
  food: Food
): Span[] {
  return memberExposure(m, b, ctx, animalId, b.subjects.get(subjectRef('animal', animalId)), food);
}

/**
 * Every hold on the farm, per subject key and kind, plus the declarations
 * and stays a hold covers. `nowMs` closes open stays and courses.
 */
export function projectHolds(
  facts: readonly HoldFact[],
  nowMs: number,
  ctx: ProjectionContext
): HoldProjection {
  const b = bucket(facts, nowMs);
  const m = model(b, nowMs);
  const clears = verdictsFor(b.doses, ctx);
  const raw = new Map<string, (readonly Span[])[]>();
  const add = (key: SubjectKey, kind: HoldKind, spans: readonly Span[]) => {
    if (spans.length === 0) return;
    const k = holdMapKey(key, kind);
    const list = raw.get(k);
    if (list) list.push(spans);
    else raw.set(k, [spans]);
  };

  for (const s of b.subjects.values()) {
    const key = subjectRef(s.subjectType, s.id);
    for (const food of FOODS) {
      if (s.subjectType === 'animal') {
        for (const chunk of withdrawalAnimal(m, b, ctx, clears, s.id, food)) add(key, food, chunk);
        const exposed = exposureAnimal(m, b, ctx, s.id, food);
        add(key, food === 'meat' ? 'preSlaughter' : food, exposed);
        continue;
      }
      const lineage = m.lineage(s.id);
      const members = m.membersEver(s.id).map((animalId) => ({
        animalId,
        memberships: m.memberships(animalId)
      }));
      add(
        key,
        food,
        treatmentHoldSpans(
          {
            subject: { type: 'group', id: s.id, lineage, members },
            food,
            treatments: groupDoses(m, s.id, lineage, members),
            plugins: ctx.plugins,
            timeZone: ctx.timeZone
          },
          clears
        )
      );
      if (m.appsByField.size === 0) continue;
      const own = clip(m.staysOf('group', s.id), ALL);
      for (const l of lineage) own.push(...clip(m.staysOf('group', l.groupId), l));
      const groupSpans = exposureSpansFast(
        exposureInputFor(m, ctx, b, s, own, food),
        m.exposureCache
      );
      add(key, food === 'meat' ? 'preSlaughter' : food, groupSpans);
      if (food === 'meat') continue;
      for (const member of members) {
        const windows = member.memberships.filter((w) => w.groupId === s.id);
        if (windows.length === 0) continue;
        const spans = memberExposure(m, b, ctx, member.animalId, s, food, s.id);
        add(key, food, intersect(spans, windows));
      }
    }
  }

  const areaApps = new Map<SubjectKey, GrazingApplication[]>();
  for (const a of b.applications) {
    const key = areaKeyOfBlock(b, a.blockId);
    const list = areaApps.get(key) ?? [];
    list.push(a);
    areaApps.set(key, list);
  }
  for (const [key, apps] of areaApps) {
    const registryMax = Math.max(
      ctx.registryMaxIntervalDays,
      registryMaxIntervalDays(apps.map((a) => a.restrictions))
    );
    const look = Math.max(GRAZING_LOOKBACK_DAYS, registryMax);
    for (const app of apps) {
      if (!Number.isFinite(app.appliedAtMs)) continue;
      const base = {
        applications: [app],
        attestations: b.attestations,
        atMs: app.appliedAtMs,
        timeZone: ctx.timeZone,
        registryMaxIntervalDays: registryMax
      };
      const verdicts = [
        ['graze', evaluateGrazing({ ...base, subject: STRICTEST_SUBJECT })],
        ['hay', evaluateHayCut(base)]
      ] as const;
      for (const [kind, verdict] of verdicts) {
        for (const f of verdict.findings) {
          if (f.ref !== app.ref) continue;
          if (f.days !== null) {
            if (f.clearsAtMs !== null && f.clearsAtMs > app.appliedAtMs && f.days > 0) {
              add(key, kind, [{ fromMs: app.appliedAtMs, toMs: f.clearsAtMs, basis: 'known' }]);
            }
            continue;
          }
          add(key, kind, [
            {
              fromMs: app.appliedAtMs,
              toMs: app.appliedAtMs + look * DAY_MS + 1,
              basis: f.reason === 'GRAZING_PROHIBITED' ? 'prohibited' : 'unknown'
            }
          ]);
        }
      }
    }
  }

  const holds = new Map<string, Span[]>();
  for (const [k, chunks] of raw) {
    const only = chunks.length === 1 ? chunks[0] : null;
    const n = only && NORMALIZED.has(only) ? (only as Span[]) : normalizeSpans(chunks.flat());
    if (n.length) holds.set(k, n);
  }

  const covered = new Map<string, HoldBasis>();
  const coverAt = (id: string, keys: readonly string[], atMs: number) => {
    let basis: HoldBasis | null = null;
    for (const k of keys) {
      const hit = spansContain(holds.get(k) ?? [], atMs);
      if (hit) basis = basis === null ? hit : stronger(basis, hit);
    }
    if (basis) covered.set(id, basis);
  };
  for (const p of b.production) {
    if (!p.declaredUse || p.food === 'meat') continue;
    const key = subjectRef(p.subjectType, p.subjectId);
    coverAt(`log:${p.id}`, [holdMapKey(key, p.food)], p.occurredAtMs);
  }
  for (const s of b.status) {
    if (!s.declaresMeat) continue;
    const key = subjectRef(s.subjectType, s.subjectId);
    coverAt(
      `meat:${s.id}`,
      [holdMapKey(key, 'meat'), holdMapKey(key, 'preSlaughter')],
      s.occurredAtMs
    );
  }
  for (const h of b.hay) {
    const k = holdMapKey(areaKeyOfBlock(b, h.blockId), 'hay');
    const mow = h.datesMs[0];
    if (mow !== undefined) coverAt(`${h.source ?? 'hay'}:${h.id}`, [k], mow);
  }
  for (const s of b.stays) {
    const spans = holds.get(holdMapKey(`area:${s.fieldId}`, 'graze')) ?? [];
    const to = s.toMs ?? nowMs;
    let basis: HoldBasis | null = null;
    for (const sp of spans) {
      if (Math.max(sp.fromMs, s.fromMs) < Math.min(sp.toMs, to)) {
        basis = basis === null ? sp.basis : stronger(basis, sp.basis);
      }
    }
    if (basis) covered.set(`stay:${s.id}`, basis);
  }
  return { holds, covered };
}

// ─── Comparison ─────────────────────────────────────────────────────────

export interface Shortening {
  key: SubjectKey;
  kind: HoldKind;
  /** The held time that would go. */
  lost: Span[];
  /** The last moment of the hold before, and after, the write. */
  clearBefore: number;
  clearAfter: number | null;
}

export interface CoverageLoss {
  id: string;
  basis: HoldBasis;
}

export interface HoldDiff {
  holds: Shortening[];
  coverage: CoverageLoss[];
}

export interface ShorteningOptions {
  /**
   * An interactive owner filling in missing label data (C-01, C-27): time
   * held only because a withdrawal or grazing interval was unknown may
   * end. Known and prohibited holds still never shorten.
   */
  resolvesUnknown?: boolean;
}

/**
 * Every instant in a hold before and not after, for every key, over all of
 * time; plus every covered declaration or stay that is no longer covered.
 * A key missing from `after` counts as never held.
 */
export function shortenings(
  before: HoldProjection,
  after: HoldProjection,
  opts: ShorteningOptions = {}
): HoldDiff {
  const holds: Shortening[] = [];
  for (const [k, spans] of before.holds) {
    const next = after.holds.get(k) ?? [];
    let lost = subtractSpans(spans, next);
    if (opts.resolvesUnknown) lost = lost.filter((s) => s.basis !== 'unknown');
    if (lost.length === 0) continue;
    const { key, kind } = splitHoldMapKey(k);
    const lastBefore = spans[spans.length - 1].toMs;
    holds.push({
      key,
      kind,
      lost,
      clearBefore: lastBefore,
      clearAfter: next.length ? next[next.length - 1].toMs : null
    });
  }
  const coverage: CoverageLoss[] = [];
  for (const [id, basis] of before.covered) {
    if (after.covered.has(id)) continue;
    if (opts.resolvesUnknown && basis === 'unknown') continue;
    coverage.push({ id, basis });
  }
  holds.sort((a, b) => (a.key + a.kind).localeCompare(b.key + b.kind));
  coverage.sort((a, b) => a.id.localeCompare(b.id));
  return { holds, coverage };
}

export function isEmptyDiff(d: HoldDiff): boolean {
  return d.holds.length === 0 && d.coverage.length === 0;
}

/** C-35 §5: a void never touches a hold from a prohibited drug or an
 *  unknown label, or one with no end. */
export function diffIsVoidable(d: HoldDiff): boolean {
  for (const s of d.holds) {
    for (const l of s.lost) {
      if (l.basis !== 'known' || !Number.isFinite(l.toMs)) return false;
    }
  }
  return d.coverage.every((c) => c.basis === 'known');
}

/** A stable text of the diff, hashed by the server for `confirmShorten`. */
export function canonicalDiff(d: HoldDiff): string {
  const num = (n: number | null) => (n === null ? null : Number.isFinite(n) ? n : 'inf');
  return JSON.stringify({
    holds: d.holds.map((s) => ({
      key: s.key,
      kind: s.kind,
      lost: s.lost.map((l) => [num(l.fromMs), num(l.toMs), l.basis])
    })),
    coverage: d.coverage.map((c) => [c.id, c.basis])
  });
}

/** Spans on one key that start after `atMs` and no later than `nowMs`:
 *  a declaration dated before them crosses a hold already on file (§4c). */
export function holdStartsAfter(
  p: HoldProjection,
  keys: readonly string[],
  atMs: number,
  nowMs: number
): Span | null {
  let first: Span | null = null;
  for (const k of keys) {
    for (const s of p.holds.get(k) ?? []) {
      if (s.fromMs > atMs && s.fromMs <= nowMs && (!first || s.fromMs < first.fromMs)) first = s;
    }
  }
  return first;
}

export function heldAt(p: HoldProjection, keys: readonly string[], atMs: number): HoldBasis | null {
  let basis: HoldBasis | null = null;
  for (const k of keys) {
    const hit = spansContain(p.holds.get(k) ?? [], atMs);
    if (hit) basis = basis === null ? hit : stronger(basis, hit);
  }
  return basis;
}
