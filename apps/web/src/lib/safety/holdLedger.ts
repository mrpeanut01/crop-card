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
 * Speed (32G G1): the kernels run once per distinct input, not once per
 * subject. Within a projection, animals share their flock's dose spans and
 * stay-set exposure, eggs share milk's exposure when no stay has a stored
 * floor, and stays are only paired with applications whose lookback can
 * reach them. Across projections that share a `verdictCache` (the guard's
 * before and after, and later writes), kernel results are kept beside it,
 * keyed by the full content they read (treatments, applications, stays,
 * attestations, zone and registry maximum), so a hit is exactly what the
 * kernel would return; kept spans are frozen. The output equals the 0.7.1
 * ledger on every farm (`holdLedger.equivalence.test.ts`), for fact times
 * that are finite or null, as stored times always are.
 *
 * Pure: no DB, env or clock reads (the kept results are a cache).
 */

import {
  FOODS,
  computeWithdrawalClear,
  physicalWindow,
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
  withInheritedLineage,
  type MembershipStay
} from '$lib/animals/membership';
import {
  applicationWindowEndsMs,
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
  applicationIntervalDays,
  presumeLactating,
  type GrazingApplication,
  type GrazingAttestationInput,
  type GrazingVerdict
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
  /**
   * Whether the block's Area is grazing land (a pasture). Left out, it is
   * read as grazing land. An Area that is not grazing land still counts as
   * grazing land once any animal has stayed on it (a stay fact).
   */
  areaGrazeable?: boolean;
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
  /** Whether its use today is food or sale; a change back from discard
   *  re-declares it (the guard rechecks it like a new declaration). */
  declaresNow?: boolean;
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

/** One verdict per treatment for the whole projection. The cache key is
 *  the zone, the treatment and the plugin data its verdict reads, so a
 *  verdict is reused only while all three are unchanged. With a side
 *  cache, each treatment also gets a content number (null when two
 *  treatments share an id, since verdicts are looked up by id). */
function verdictsFor(
  doses: readonly TreatmentRecord[],
  ctx: ProjectionContext,
  side: SideCache | null
): { clears: Map<string, WithdrawalClear>; doseIds: Map<TreatmentRecord, number> | null } {
  const out = new Map<string, WithdrawalClear>();
  let doseIds: Map<TreatmentRecord, number> | null = side ? new Map() : null;
  const pluginJson = new Map<string, string>();
  const dataOf = (id: string) => {
    let j = pluginJson.get(id);
    if (j === undefined) {
      j = JSON.stringify(ctx.plugins(id) ?? null);
      // A content number in place of the plugin text when there is one.
      if (side) j = `p${internId(side, j)}`;
      pluginJson.set(id, j);
    }
    return j;
  };
  const zoneText = JSON.stringify(ctx.timeZone);
  for (const t of doses) {
    let clear: WithdrawalClear | undefined;
    let num = -1;
    if (side && ctx.verdictCache) {
      let tail = '';
      for (const id of pluginIdsOf(t)) tail += `\u0001${dataOf(id)}`;
      // The last verdict seen under this id, reused while the treatment
      // is the same data as then (a private copy, compared field by field
      // instead of building and hashing the key) and the rest of the key
      // is unchanged. Content numbers are never reused, so `num` still
      // names only that content after `ids` starts over.
      const seen = side.doses.get(t.id);
      if (seen && seen.tail === tail && seen.zone === zoneText && samePlainData(seen.data, t)) {
        clear = seen.clear;
        num = seen.num;
      } else {
        const key = `${zoneText}\u0001${JSON.stringify(t)}${tail}`;
        clear = ctx.verdictCache.get(key);
        if (!clear) {
          clear = computeWithdrawalClear(t, ctx.plugins, { timeZone: ctx.timeZone });
          ctx.verdictCache.set(key, clear);
        }
        num = internId(side, key);
        const data = plainCopy(t);
        if (data !== NOT_PLAIN)
          remember(side.doses, t.id, { data, tail, zone: zoneText, clear, num });
      }
    } else {
      let key = '';
      if (ctx.verdictCache) {
        key = `${zoneText}\u0001${JSON.stringify(t)}`;
        for (const id of pluginIdsOf(t)) key += `\u0001${dataOf(id)}`;
      }
      clear = ctx.verdictCache?.get(key);
      if (!clear) {
        clear = computeWithdrawalClear(t, ctx.plugins, { timeZone: ctx.timeZone });
        ctx.verdictCache?.set(key, clear);
      }
    }
    if (out.has(t.id)) doseIds = null;
    out.set(t.id, clear);
    if (doseIds) doseIds.set(t, num);
  }
  return { clears: out, doseIds };
}

export interface HoldProjection {
  /** `${key}|${kind}` → merged spans. */
  holds: Map<string, Span[]>;
  /** Declarations and stays a hold covers (the C-06 set), with how sure. */
  covered: Map<string, HoldBasis>;
  /** Blocks on file (from block-assignment facts). */
  blocks?: ReadonlySet<string>;
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
  if (SCRATCH[slot].length < size)
    SCRATCH[slot] = new Float64Array(Math.max(size, SCRATCH[slot].length * 2));
  return SCRATCH[slot];
}

/** Sorts the first `n` values ascending as `TypedArray#sort` does (minus
 *  zero before zero), by insertion while small. */
function sortPrefix(a: Float64Array, n: number): void {
  if (n > 24) {
    a.subarray(0, n).sort();
    return;
  }
  for (let i = 1; i < n; i++) {
    const v = a[i];
    let j = i - 1;
    while (j >= 0 && (a[j] > v || (v === 0 && a[j] === 0 && 1 / v < 0 && 1 / a[j] > 0))) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = v;
  }
}

export function normalizeSpans(spans: readonly Span[]): Span[] {
  const n = spans.length;
  if (n === 1 && spans[0].toMs > spans[0].fromMs) {
    const out = [{ fromMs: spans[0].fromMs, toMs: spans[0].toMs, basis: spans[0].basis }];
    NORMALIZED.add(out);
    return out;
  }
  let c0 = 0;
  let c1 = 0;
  let c2 = 0;
  let minFrom = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const s = spans[i];
    if (!(s.toMs > s.fromMs)) continue;
    if (s.fromMs < minFrom) minFrom = s.fromMs;
    const b = BASIS_INDEX[s.basis];
    if (b === 0) c0++;
    else if (b === 1) c1++;
    else c2++;
  }
  const out: Span[] = [];
  NORMALIZED.add(out);
  // The event sweep this replaced never started when the earliest start
  // was not finite, and so returned nothing; kept for identical output.
  if (minFrom === Number.NEGATIVE_INFINITY) return out;
  if (c0 + c1 + c2 === 0) return out;
  const s0 = scratch(0, c0);
  const e0 = scratch(1, c0);
  const s1 = scratch(2, c1);
  const e1 = scratch(3, c1);
  const s2 = scratch(4, c2);
  const e2 = scratch(5, c2);
  let f0 = 0;
  let f1 = 0;
  let f2 = 0;
  for (let i = 0; i < n; i++) {
    const s = spans[i];
    if (!(s.toMs > s.fromMs)) continue;
    const b = BASIS_INDEX[s.basis];
    if (b === 0) {
      s0[f0] = s.fromMs;
      e0[f0++] = s.toMs;
    } else if (b === 1) {
      s1[f1] = s.fromMs;
      e1[f1++] = s.toMs;
    } else {
      s2[f2] = s.fromMs;
      e2[f2++] = s.toMs;
    }
  }
  if (c0 === 0 && c2 === 0) {
    unionInto(s1, e1, c1, 'known', out);
    return out;
  }
  if (c1 === 0 && c2 === 0) {
    unionInto(s0, e0, c0, 'unknown', out);
    return out;
  }
  if (c0 === 0 && c1 === 0) {
    unionInto(s2, e2, c2, 'prohibited', out);
    return out;
  }
  const u0: Span[] = [];
  const u1: Span[] = [];
  const u2: Span[] = [];
  if (c0 > 0) unionInto(s0, e0, c0, 'unknown', u0);
  if (c1 > 0) unionInto(s1, e1, c1, 'known', u1);
  if (c2 > 0) unionInto(s2, e2, c2, 'prohibited', u2);
  overlay(u0, u1, u2, out);
  return out;
}

/** The union of `[starts[i], ends[i])` for the first `n` entries on one
 *  basis, touching spans merged, appended to `out`. Sorts both in place. */
function unionInto(
  starts: Float64Array,
  ends: Float64Array,
  n: number,
  basis: HoldBasis,
  out: Span[]
) {
  sortPrefix(starts, n);
  sortPrefix(ends, n);
  let i = 0;
  let j = 0;
  let open = 0;
  let from = 0;
  while (j < n) {
    if (i < n && starts[i] <= ends[j]) {
      if (open++ === 0) from = starts[i];
      i++;
    } else {
      if (--open === 0) out.push({ fromMs: from, toMs: ends[j], basis });
      j++;
    }
  }
}

/** Three disjoint sorted span lists (unknown, known, prohibited) laid
 *  over each other: where they overlap the strongest basis wins, and runs
 *  of one basis merge. */
function overlay(l0: readonly Span[], l1: readonly Span[], l2: readonly Span[], out: Span[]) {
  const INF = Number.POSITIVE_INFINITY;
  const n0 = l0.length;
  const n1 = l1.length;
  const n2 = l2.length;
  let i0 = 0;
  let i1 = 0;
  let i2 = 0;
  let at = INF;
  if (n0 && l0[0].fromMs < at) at = l0[0].fromMs;
  if (n1 && l1[0].fromMs < at) at = l1[0].fromMs;
  if (n2 && l2[0].fromMs < at) at = l2[0].fromMs;
  let last: Span | null = null;
  while (at !== INF) {
    let basis = -1;
    let next = INF;
    while (i0 < n0 && l0[i0].toMs <= at) i0++;
    if (i0 < n0) {
      const s = l0[i0];
      if (s.fromMs <= at) {
        basis = 0;
        next = s.toMs;
      } else next = s.fromMs;
    }
    while (i1 < n1 && l1[i1].toMs <= at) i1++;
    if (i1 < n1) {
      const s = l1[i1];
      if (s.fromMs <= at) {
        basis = 1;
        if (s.toMs < next) next = s.toMs;
      } else if (s.fromMs < next) next = s.fromMs;
    }
    while (i2 < n2 && l2[i2].toMs <= at) i2++;
    if (i2 < n2) {
      const s = l2[i2];
      if (s.fromMs <= at) {
        basis = 2;
        if (s.toMs < next) next = s.toMs;
      } else if (s.fromMs < next) next = s.fromMs;
    }
    if (basis >= 0) {
      const name = BASES[basis];
      if (last !== null && last.toMs === at && last.basis === name) last.toMs = next;
      else {
        last = { fromMs: at, toMs: next, basis: name };
        out.push(last);
      }
    }
    at = next;
  }
}

/**
 * The union of two normalized span lists, normalized: at every moment the
 * stronger basis of the two, in maximal runs. A span that comes through
 * unchanged is reused, never copied, so neither input may be mutated
 * afterwards (nothing mutates a normalized list).
 */
function merge2(a: readonly Span[], b: readonly Span[]): Span[] {
  if (b.length === 0) return a as Span[];
  if (a.length === 0) return b as Span[];
  const INF = Number.POSITIVE_INFINITY;
  const na = a.length;
  const nb = b.length;
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  let at = a[0].fromMs < b[0].fromMs ? a[0].fromMs : b[0].fromMs;
  let last: Span | null = null;
  let lastOwned = false;
  while (at !== INF) {
    while (i < na && a[i].toMs <= at) i++;
    while (j < nb && b[j].toMs <= at) j++;
    let next = INF;
    let cover: Span | null = null;
    let rank = -1;
    if (i < na) {
      const x = a[i];
      if (x.fromMs <= at) {
        cover = x;
        rank = BASIS_RANK[x.basis];
        next = x.toMs;
      } else next = x.fromMs;
    }
    if (j < nb) {
      const y = b[j];
      if (y.fromMs <= at) {
        const r = BASIS_RANK[y.basis];
        if (r > rank) {
          cover = y;
          rank = r;
        }
        if (y.toMs < next) next = y.toMs;
      } else if (y.fromMs < next) next = y.fromMs;
    }
    if (cover !== null) {
      const basis = cover.basis;
      if (last !== null && last.toMs === at && last.basis === basis) {
        if (lastOwned) last.toMs = next;
        else {
          last = { fromMs: last.fromMs, toMs: next, basis };
          out[out.length - 1] = last;
          lastOwned = true;
        }
      } else if (cover.fromMs === at && cover.toMs === next) {
        last = cover;
        lastOwned = false;
        out.push(cover);
      } else {
        last = { fromMs: at, toMs: next, basis };
        lastOwned = true;
        out.push(last);
      }
    }
    at = next;
  }
  NORMALIZED.add(out);
  return out;
}

function hasNegInfStart(spans: readonly Span[]): boolean {
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.fromMs === Number.NEGATIVE_INFINITY && s.toMs > s.fromMs) return true;
  }
  return false;
}

/**
 * `normalizeSpans(chunks.flat())`, built from the chunks: lists already
 * normalized are merged as they are and only raw chunks are sorted. A
 * span starting at minus infinity takes the flat path, whose sweep never
 * starts and returns nothing.
 */
function mergeChunks(
  chunks: readonly (readonly Span[])[],
  memo?: WeakMap<readonly Span[], WeakMap<readonly Span[], Span[]>>
): Span[] {
  const n = chunks.length;
  if (n === 1 && NORMALIZED.has(chunks[0])) return chunks[0] as Span[];
  let acc: Span[] | null = null;
  let raw: (readonly Span[])[] | null = null;
  for (let i = 0; i < n; i++) {
    const c = chunks[i];
    if (!NORMALIZED.has(c)) {
      if (c.length === 0) continue;
      if (hasNegInfStart(c)) return normalizeSpans(chunks.flat());
      (raw ??= []).push(c);
      continue;
    }
    if (c.length > 0 && c[0].fromMs === Number.NEGATIVE_INFINITY) {
      return normalizeSpans(chunks.flat());
    }
    if (acc === null) acc = c as Span[];
    else if (memo && Object.isFrozen(acc) && Object.isFrozen(c)) {
      // Both lists outlive this projection, so their union is kept too.
      let byB = memo.get(acc);
      if (!byB) {
        byB = new WeakMap();
        memo.set(acc, byB);
      }
      let merged = byB.get(c);
      if (!merged) {
        merged = merge2(acc, c);
        if (!Object.isFrozen(merged)) merged = frozenSpans(merged);
        byB.set(c, merged);
      }
      acc = merged;
    } else acc = merge2(acc, c);
  }
  if (raw !== null) {
    const normalized = normalizeSpans(raw.length === 1 ? raw[0] : raw.flat());
    acc = acc === null ? normalized : merge2(acc, normalized);
  }
  if (acc === null) {
    acc = [];
    NORMALIZED.add(acc);
  }
  return acc;
}

/** The parts of normalized `spans` inside any of `windows` (each window
 *  intersected on its own, as the withdrawal kernel does). */
function intersectNormalized(
  spans: readonly Span[],
  windows: readonly GroupMembership[],
  out: Span[]
): void {
  for (const w of windows) {
    const wFrom = w.fromMs ?? Number.NEGATIVE_INFINITY;
    const wTo = w.toMs ?? Number.POSITIVE_INFINITY;
    for (const s of spans) {
      if (s.fromMs >= wTo) break;
      const fromMs = s.fromMs > wFrom ? s.fromMs : wFrom;
      const toMs = s.toMs < wTo ? s.toMs : wTo;
      if (toMs > fromMs) out.push({ fromMs, toMs, basis: s.basis });
    }
  }
}

/** A normalized list cut to some windows, normalized; kept across
 *  projections when the list itself is (frozen). */
function cutTo(
  m: Model,
  spans: Span[],
  windows: readonly GroupMembership[],
  windowsKey: string
): Span[] {
  const keep = m.side !== null && Object.isFrozen(spans);
  let byWindows = keep ? m.side!.cuts.get(spans) : undefined;
  const hit = byWindows?.get(windowsKey);
  if (hit) return hit;
  const cut: Span[] = [];
  intersectNormalized(spans, windows, cut);
  let out = normalizeSpans(cut);
  if (keep) {
    out = frozenSpans(out);
    if (!byWindows) {
      byWindows = new Map();
      m.side!.cuts.set(spans, byWindows);
    }
    byWindows.set(windowsKey, out);
  }
  return out;
}

/** The basis of the one span of a normalized list containing `atMs`. */
function containsSorted(spans: readonly Span[], atMs: number): HoldBasis | null {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid].toMs <= atMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo < spans.length && spans[lo].fromMs <= atMs) return spans[lo].basis;
  return null;
}

/** The strongest basis of a normalized list over `[fromMs, toMs)`. */
function overlapsSorted(spans: readonly Span[], fromMs: number, toMs: number): HoldBasis | null {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid].toMs <= fromMs) lo = mid + 1;
    else hi = mid;
  }
  let basis: HoldBasis | null = null;
  for (let k = lo; k < spans.length; k++) {
    const sp = spans[k];
    if (!(sp.fromMs < toMs)) break;
    if (Math.max(sp.fromMs, fromMs) < Math.min(sp.toMs, toMs)) {
      basis = basis === null ? sp.basis : stronger(basis, sp.basis);
    }
  }
  return basis;
}

/**
 * The parts of `a` not covered by a span of `b` at least as strong. Both
 * normalized. A part `b` still holds on a weaker basis counts as gone and
 * keeps its old basis: a prohibited hold that turns unknown has lost its
 * prohibition, and an unknown hold can later be resolved away.
 */
export function subtractSpans(a: readonly Span[], b: readonly Span[]): Span[] {
  if (!sortedDisjoint(b)) return subtractSpansSlow(a, b);
  const out: Span[] = [];
  for (const s of a) {
    if (!(s.toMs > s.fromMs)) {
      for (const p of subtractSpansSlow([s], b)) out.push(p);
      continue;
    }
    const rank = BASIS_RANK[s.basis];
    // `b` is sorted and its spans never overlap, so cutting `s` by every
    // span of `b` at least as strong, in order, leaves these pieces.
    let lo = 0;
    let hi = b.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (b[mid].toMs <= s.fromMs) lo = mid + 1;
      else hi = mid;
    }
    let cur = s.fromMs;
    for (let k = lo; k < b.length; k++) {
      const c = b[k];
      if (c.fromMs >= s.toMs) break;
      if (BASIS_RANK[c.basis] < rank) continue;
      if (c.fromMs > cur) out.push({ ...s, fromMs: cur, toMs: c.fromMs });
      if (c.toMs > cur) cur = c.toMs;
      if (cur >= s.toMs) break;
    }
    if (cur < s.toMs) out.push({ ...s, fromMs: cur, toMs: s.toMs });
  }
  return out;
}

function sortedDisjoint(spans: readonly Span[]): boolean {
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (!(s.fromMs < s.toMs)) return false;
    if (i > 0 && !(spans[i - 1].toMs <= s.fromMs)) return false;
  }
  return true;
}

function subtractSpansSlow(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const s of a) {
    let pieces: Span[] = [{ ...s }];
    for (const c of b) {
      if (BASIS_RANK[c.basis] < BASIS_RANK[s.basis]) continue;
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

/**
 * Grazing and haying verdicts of single applications, kept beside a
 * context's `verdictCache` (the guard keeps one for every farm) so the
 * before and after projections of a write, and later writes, reuse them.
 * Keyed by the zone, every attestation on file, the registry maximum and
 * the application itself: everything the verdict reads, so nothing is
 * shared that is not already in the key.
 */
interface SideCache {
  area: Map<string, readonly [GrazingVerdict, GrazingVerdict]>;
  /** `areaHolds` by everything it reads. */
  areaHolds: Map<string, { k: SubjectKey; kind: HoldKind; spans: Span[] }[]>;
  reach: Map<string, number>;
  profiles: Map<string, unknown>;
  /** `verdictsFor`'s last verdict and content number per treatment id,
   *  with the key's parts it was made from. */
  doses: Map<
    string,
    { data: unknown; tail: string; zone: string; clear: WithdrawalClear; num: number }
  >;
  /** `appId`'s last content number per application ref, with its data. */
  apps: Map<string, { data: unknown; id: string }>;
  /** Content text to a number never reused for other content. */
  ids: Map<string, number>;
  nextId: number;
  /** Frozen normalized spans: exposure of a stay set, withdrawal chunks. */
  spans: Map<string, Span[]>;
  /** Frozen withdrawal spans by food (`byFoodCache`). */
  byFood: Map<string, Partial<Record<Food, Span[]>>>;
  /** Spans held by `spans` and `byFood`. */
  spanCount: number;
  /** `merge2` by its two inputs; only frozen inputs are ever met again. */
  merges: WeakMap<readonly Span[], WeakMap<readonly Span[], Span[]>>;
  /** `cutTo` by the frozen list and the windows. */
  cuts: WeakMap<readonly Span[], Map<string, Span[]>>;
}
const SIDE_CACHES = new WeakMap<object, SideCache>();
const MAX_SIDE_ENTRIES = 50_000;
const MAX_SIDE_SPANS = 300_000;

function internId(side: SideCache, text: string): number {
  let id = side.ids.get(text);
  if (id === undefined) {
    if (side.ids.size >= MAX_SIDE_ENTRIES) side.ids.clear();
    id = side.nextId++;
    side.ids.set(text, id);
  }
  return id;
}

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MAX_SIDE_ENTRIES) map.clear();
  map.set(key, value);
}

/** Spans kept across projections are frozen, so no reader can change
 *  what a later projection is handed. */
function frozenSpans(spans: Span[]): Span[] {
  for (const s of spans) Object.freeze(s);
  return Object.freeze(spans) as Span[];
}

/** Frozen spans about to be held by the side cache's maps, counted
 *  against a total so the cache stays small; past it, those maps start
 *  over (a projection still using an entry keeps its own reference). */
function keptSpans(side: SideCache, spans: Span[]): Span[] {
  side.spanCount += spans.length;
  if (side.spanCount > MAX_SIDE_SPANS) {
    side.spans.clear();
    side.byFood.clear();
    side.areaHolds.clear();
    side.spanCount = spans.length;
  }
  return frozenSpans(spans);
}

const NOT_PLAIN: unique symbol = Symbol('not plain');

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A deep copy of JSON-like data (primitives, arrays, plain objects), or
 *  NOT_PLAIN when anything else is in it. */
function plainCopy(v: unknown): unknown {
  if (v === null || typeof v !== 'object') {
    return typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint'
      ? NOT_PLAIN
      : v;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) return NOT_PLAIN;
      const c = plainCopy(v[i]);
      if (c === NOT_PLAIN) return NOT_PLAIN;
      out.push(c);
    }
    return out;
  }
  if (!isPlainObject(v) || Object.getOwnPropertySymbols(v).length > 0) return NOT_PLAIN;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    const c = plainCopy((v as Record<string, unknown>)[k]);
    if (c === NOT_PLAIN) return NOT_PLAIN;
    out[k] = c;
  }
  return out;
}

/** `b` is the same data as `a`, a `plainCopy`: the same keys in the same
 *  order, `Object.is` leaves, nothing but arrays and plain objects. */
function samePlainData(a: unknown, b: unknown): boolean {
  if (a === null || typeof a !== 'object') return Object.is(a, b);
  if (b === null || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!(i in b) || !samePlainData(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b) || !isPlainObject(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length || Object.getOwnPropertySymbols(b).length > 0) return false;
  for (let i = 0; i < ka.length; i++) {
    const k = ka[i];
    if (k !== kb[i]) return false;
    if (!samePlainData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

function sideCache(ctx: ProjectionContext): SideCache | null {
  if (!ctx.verdictCache) return null;
  let c = SIDE_CACHES.get(ctx.verdictCache);
  if (!c) {
    c = {
      area: new Map(),
      areaHolds: new Map(),
      reach: new Map(),
      profiles: new Map(),
      doses: new Map(),
      apps: new Map(),
      ids: new Map(),
      nextId: 0,
      spans: new Map(),
      byFood: new Map(),
      spanCount: 0,
      merges: new WeakMap(),
      cuts: new WeakMap()
    };
    SIDE_CACHES.set(ctx.verdictCache, c);
  }
  return c;
}

interface Buckets {
  subjects: Map<string, SubjectFact>;
  doses: TreatmentRecord[];
  stays: StayFact[];
  applications: GrazingApplication[];
  fieldOfBlock: Map<string, string | null>;
  /** Areas that are not grazing land and no animal ever stayed on. */
  notGrazed: Set<string>;
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
    notGrazed: new Set(),
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
        if (f.fieldId && f.areaGrazeable === false) b.notGrazed.add(f.fieldId);
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
  for (const f of facts) {
    if (f.kind === 'block-assignment' && f.fieldId && f.areaGrazeable !== false) {
      b.notGrazed.delete(f.fieldId);
    }
  }
  for (const s of b.stays) b.notGrazed.delete(s.fieldId);
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

/**
 * Where a block's applications hold hay: the block itself always, and its
 * Area too when the Area is grazing land (C-21 counts every block in it).
 * The block's own key never moves with a reassignment, and ends with the
 * block, since nothing can be cut from a deleted block.
 */
export function hayKeysOfBlock(fieldId: string | null | undefined, blockId: string): SubjectKey[] {
  return fieldId ? [`area:${fieldId}`, `block:${blockId}`] : [`block:${blockId}`];
}

/** `applicationIntervalDays`, through the side cache (the attestations
 *  are part of `env`). */
function intervalDays(m: Model, b: Buckets, a: GrazingApplication): number {
  const key = m.side ? `i${m.env}|${m.appId(a)}` : '';
  let d = m.side?.reach.get(key);
  if (d === undefined) {
    d = applicationIntervalDays(a, b.attestations);
    if (m.side) remember(m.side.reach, key, d);
  }
  return d;
}

function grazedArea(b: Buckets, key: SubjectKey): boolean {
  return !(key.startsWith('area:') && b.notGrazed.has(key.slice(5)));
}

interface Model {
  exposureCache: ExposureSpanCache;
  /** Normalized withdrawal holds of a group's doses over some windows,
   *  by food. */
  groupDoseSpans: Map<string, Partial<Record<Food, Span[]>>>;
  /** Treatments recorded on a subject, by `type:id`. */
  dosesOf: (type: 'animal' | 'group', id: string) => TreatmentRecord[];
  staysOf: (type: 'animal' | 'group', id: string) => StayFact[];
  memberships: (animalId: string) => GroupMembership[];
  lineage: (groupId: string) => GroupMembership[];
  membersEver: (groupId: string) => string[];
  appsByField: Map<string, GrazingApplication[]>;
  /** Each application's lookback window end (`applicationWindowEndsMs`). */
  reach: Map<GrazingApplication, number>;
  /** `groupDosesText` per group. */
  groupDoseTexts: Map<string, string>;
  /** `stayText` per stay as the kernel reads it. */
  stayTexts: WeakMap<ClippedStay, string>;
  /** `fieldAppsText` per Area. */
  fieldAppTexts: Map<string, string>;
  /** A stay no window cuts, as the kernel reads it, once. */
  wholeStays: Map<StayFact, ClippedStay>;
  /** `relevantApps` per stay. */
  relevant: Map<StayFact, readonly GrazingApplication[]>;
  /** The stay set of each group window, by window key. */
  windowStays: Map<string, StaySet>;
  /** Distinct stay sets per group, so equal ones share their exposure. */
  staySets: Map<string, StaySet[]>;
  /** `merge2` of two normalized lists, by the lists. */
  mergeMemo: WeakMap<readonly Span[], WeakMap<readonly Span[], Span[]>>;
  /** Content numbers of the treatments (`verdictsFor`). */
  doseIds: Map<TreatmentRecord, number> | null;
  plans: Map<string, AnimalPlan>;
  readingKeys: WeakMap<SubjectFact, string>;
  /** Content caches kept beside the context's verdict cache, if any. */
  side: SideCache | null;
  /** The zone, attestations and registry maximum, as a content number. */
  env: string;
  /** An application's content number as text (side cache only). */
  appId: (app: GrazingApplication) => string;
}

function byType<V>(
  maps: { animal: Map<string, V>; group: Map<string, V> },
  type: string
): Map<string, V> | null {
  return type === 'animal' ? maps.animal : type === 'group' ? maps.group : null;
}

function model(b: Buckets, nowMs: number, ctx: ProjectionContext): Model {
  const byRef = { animal: new Map<string, StayFact[]>(), group: new Map<string, StayFact[]>() };
  for (const s of b.stays) {
    const byId = byType(byRef, s.subjectType);
    if (!byId) continue;
    const list = byId.get(s.subjectId);
    if (list) list.push(s);
    else byId.set(s.subjectId, [s]);
  }
  const staysOf = (type: 'animal' | 'group', id: string) => byRef[type].get(id) ?? [];
  const lineageCache = new Map<string, GroupMembership[]>();
  const lineage = (groupId: string) => {
    let l = lineageCache.get(groupId);
    if (!l) {
      l = lineageFromStays(
        membershipStays(staysOf('group', groupId)),
        (parent) => membershipStays(staysOf('group', parent)),
        groupId
      );
      lineageCache.set(groupId, l);
    }
    return l;
  };
  const plainCache = new Map<string, GroupMembership[]>();
  const plainMemberships = (animalId: string) => {
    let m = plainCache.get(animalId);
    if (!m) {
      const current = b.subjects.get(subjectRef('animal', animalId))?.currentGroupId ?? null;
      m = membershipsFromStays(current, membershipStays(staysOf('animal', animalId))).map((w) =>
        w.toMs === null ? { ...w, toMs: Math.max(nowMs, w.fromMs ?? nowMs) } : w
      );
      plainCache.set(animalId, m);
    }
    return m;
  };
  const memberCache = new Map<string, GroupMembership[]>();
  const memberships = (animalId: string) => {
    let m = memberCache.get(animalId);
    if (!m) {
      m = withInheritedLineage(plainMemberships(animalId), lineage);
      memberCache.set(animalId, m);
    }
    return m;
  };
  const everIn = new Map<string, Set<string>>();
  const note = (groupId: string, animalId: string) => {
    const set = everIn.get(groupId) ?? new Set<string>();
    set.add(animalId);
    everIn.set(groupId, set);
  };
  for (const s of b.subjects.values()) {
    if (s.subjectType !== 'animal') continue;
    if (s.currentGroupId) note(s.currentGroupId, s.id);
    for (const m of plainMemberships(s.id)) note(m.groupId, s.id);
  }
  const appsByField = new Map<string, GrazingApplication[]>();
  for (const a of b.applications) {
    const fieldId = b.fieldOfBlock.get(a.blockId);
    if (!fieldId) continue;
    const list = appsByField.get(fieldId) ?? [];
    list.push(a);
    appsByField.set(fieldId, list);
  }
  const doses = {
    animal: new Map<string, TreatmentRecord[]>(),
    group: new Map<string, TreatmentRecord[]>()
  };
  for (const t of b.doses) {
    const byId = byType(doses, t.subjectType);
    if (!byId) continue;
    const list = byId.get(t.subjectId);
    if (list) list.push(t);
    else byId.set(t.subjectId, [t]);
  }
  const side = sideCache(ctx);
  // Content numbers stand in for long texts in the side cache keys: the
  // zone, attestations and registry maximum (env), and each application.
  const env = side
    ? `e${internId(side, JSON.stringify([ctx.timeZone, b.attestations, ctx.registryMaxIntervalDays]))}`
    : '';
  const appIds = new Map<GrazingApplication, string>();
  const appId = (app: GrazingApplication) => {
    let id = appIds.get(app);
    if (id === undefined) {
      if (side) {
        const seen = side.apps.get(app.ref);
        if (seen && samePlainData(seen.data, app)) id = seen.id;
        else {
          id = `a${internId(side, JSON.stringify(app))}`;
          const data = plainCopy(app);
          if (data !== NOT_PLAIN) remember(side.apps, app.ref, { data, id });
        }
      } else id = '';
      appIds.set(app, id);
    }
    return id;
  };
  const exposureCache = newExposureSpanCache();
  if (side) {
    exposureCache.shared = {
      env,
      appKey: appId,
      profiles: side.profiles,
      maxEntries: MAX_SIDE_ENTRIES
    };
  }
  return {
    exposureCache,
    side,
    env,
    appId,
    groupDoseSpans: new Map(),
    dosesOf: (type, id) => doses[type].get(id) ?? [],
    staysOf,
    memberships,
    lineage,
    membersEver: (groupId) => [...(everIn.get(groupId) ?? [])],
    appsByField,
    reach: new Map(),
    relevant: new Map(),
    wholeStays: new Map(),
    stayTexts: new WeakMap(),
    groupDoseTexts: new Map(),
    fieldAppTexts: new Map(),
    windowStays: new Map(),
    staySets: new Map(),
    plans: new Map(),
    readingKeys: new WeakMap(),
    mergeMemo: side ? side.merges : new WeakMap(),
    doseIds: null
  };
}

/** A stay cut to a membership window, with the stay it came from. */
interface ClippedStay extends ExposureStay {
  src: StayFact;
}

function clip(m: Model, stays: readonly StayFact[], w: GroupMembership): ClippedStay[] {
  const out: ClippedStay[] = [];
  for (const s of stays) {
    if (s.toMs !== null && s.toMs === s.fromMs) continue;
    const fromMs = w.fromMs === null ? s.fromMs : Math.max(s.fromMs, w.fromMs);
    const toMs = s.toMs === null ? w.toMs : w.toMs === null ? s.toMs : Math.min(s.toMs, w.toMs);
    if (toMs !== null && toMs <= fromMs) continue;
    if (fromMs === s.fromMs && toMs === s.toMs) {
      let whole = m.wholeStays.get(s);
      if (!whole) {
        whole = {
          fieldId: s.fieldId,
          fromMs,
          toMs,
          ...(s.floor.length ? { floor: s.floor } : {}),
          src: s
        };
        m.wholeStays.set(s, whole);
      }
      out.push(whole);
      continue;
    }
    out.push({
      fieldId: s.fieldId,
      fromMs,
      toMs,
      ...(s.floor.length ? { floor: s.floor } : {}),
      src: s
    });
  }
  return out;
}

const ALL: GroupMembership = { groupId: '', fromMs: null, toMs: null };

function lactatingOf(s: SubjectFact | undefined): boolean {
  if (!s) return true;
  return presumeLactating({ speciesProducts: s.speciesProducts, sex: s.sex });
}

function exposureInputFor(
  m: Model,
  ctx: ProjectionContext,
  b: Buckets,
  subject: SubjectFact | undefined,
  stays: ClippedStay[],
  food: Food,
  appsByField: ReadonlyMap<string, readonly GrazingApplication[]> = appsReaching(m, ctx, b, stays)
) {
  return {
    stays,
    applicationsByField: appsByField,
    attestations: b.attestations,
    subject: { speciesId: subject?.speciesId ?? null, lactating: lactatingOf(subject) },
    food,
    timeZone: ctx.timeZone,
    registryMaxIntervalDays: ctx.registryMaxIntervalDays
  };
}

/**
 * The applications each stay's Area can get a hold from: those applied
 * before the stay ends whose lookback window reaches its start. Every
 * other pair yields nothing in `exposureSpansFast`, so leaving it out
 * changes no span (a stay with a stored floor keeps all its Area's).
 */
function appsReaching(
  m: Model,
  ctx: ProjectionContext,
  b: Buckets,
  stays: readonly ClippedStay[]
): ReadonlyMap<string, readonly GrazingApplication[]> {
  const out = new Map<string, readonly GrazingApplication[]>();
  for (const st of stays) {
    const apps = relevantApps(m, ctx, b, st.src);
    if (apps.length === 0) continue;
    const have = out.get(st.fieldId);
    if (!have) out.set(st.fieldId, apps);
    else if (have !== apps) {
      const merged = [...have];
      for (const app of apps) if (!merged.includes(app)) merged.push(app);
      out.set(st.fieldId, merged);
    }
  }
  return out;
}

/** The applications on a stay's Area applied before it ended whose
 *  lookback window reaches its start, once per stay and projection (a
 *  clipped stay only narrows this); every application for a stay with a
 *  stored floor. */
function relevantApps(
  m: Model,
  ctx: ProjectionContext,
  b: Buckets,
  stay: StayFact
): readonly GrazingApplication[] {
  let list = m.relevant.get(stay);
  if (list) return list;
  const apps = m.appsByField.get(stay.fieldId) ?? [];
  if (stay.floor.length > 0) list = apps;
  else {
    const found: GrazingApplication[] = [];
    list = found;
    const to = stay.toMs ?? Number.POSITIVE_INFINITY;
    for (const app of apps) {
      if (!(app.appliedAtMs < to)) continue;
      let reach = m.reach.get(app);
      if (reach === undefined) {
        const contentKey = m.side ? `r${m.env}|${m.appId(app)}` : '';
        reach = m.side?.reach.get(contentKey);
        if (reach === undefined) {
          reach = applicationWindowEndsMs(
            {
              attestations: b.attestations,
              registryMaxIntervalDays: ctx.registryMaxIntervalDays,
              timeZone: ctx.timeZone
            },
            app
          );
          if (m.side) {
            if (m.side.reach.size >= MAX_SIDE_ENTRIES) m.side.reach.clear();
            m.side.reach.set(contentKey, reach);
          }
        }
        m.reach.set(app, reach);
      }
      if (reach >= stay.fromMs) found.push(app);
    }
  }
  m.relevant.set(stay, list);
  return list;
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

/** The treatments that can reach a group's own holds: its own and its
 *  parents'. */
function groupDoses(
  m: Model,
  groupId: string,
  lineage: readonly GroupMembership[]
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
  return out;
}

/** What an animal's projection reads about it, worked out once. */
interface AnimalPlan {
  memberships: GroupMembership[];
  /** Its windows in each group, with a key for the group's dose spans
   *  and the group's treatments. */
  byGroup: {
    groupId: string;
    windows: GroupMembership[];
    key: string;
    doses: TreatmentRecord[];
    /** Its `groupDoseSpans` entry, once looked up. */
    byFood?: Partial<Record<Food, Span[]>>;
  }[];
  /** Its own treatments. */
  own: TreatmentRecord[];
  /** Its physical windows, with the window's key. */
  physical: KeyedWindow[];
  ownStays: StayFact[];
  /** Its withdrawal chunks (`withdrawalAnimal`) by food, once. */
  withdrawal: Partial<Record<Food, Span[][]>>;
  /** Its own treatments' normalized spans by food (`byFoodCache`). */
  ownSpans?: Partial<Record<Food, Span[]>>;
}

interface KeyedWindow {
  w: GroupMembership;
  key: string;
  /** Its `windowStays` entry, once looked up. */
  set?: StaySet;
}

function windowKey(w: GroupMembership): string {
  return `${w.groupId}|${w.fromMs}|${w.toMs}`;
}

function animalPlan(m: Model, animalId: string): AnimalPlan {
  let plan = m.plans.get(animalId);
  if (plan) return plan;
  const memberships = m.memberships(animalId);
  const grouped = new Map<string, GroupMembership[]>();
  for (const w of memberships) {
    const list = grouped.get(w.groupId);
    if (list) list.push(w);
    else grouped.set(w.groupId, [w]);
  }
  const byGroup: AnimalPlan['byGroup'] = [];
  for (const [groupId, windows] of grouped) {
    byGroup.push({
      groupId,
      windows,
      doses: m.dosesOf('group', groupId),
      key: `${groupId}|${windows.map((w) => `${w.fromMs}-${w.toMs}-${w.inheritedUntilMs ?? ''}`).join(',')}`
    });
  }
  plan = {
    memberships,
    byGroup,
    physical: memberships.map((x) => {
      const w = physicalWindow(x);
      return { w, key: windowKey(w) };
    }),
    ownStays: m.staysOf('animal', animalId),
    own: m.dosesOf('animal', animalId),
    withdrawal: {}
  };
  m.plans.set(animalId, plan);
  return plan;
}

/**
 * `treatmentHoldSpans` normalized, through the side cache when every
 * treatment has a content number: the spans depend only on the subject
 * text (`subjectText`, everything of the subject the kernel reads), the
 * food and the treatments with their verdicts, which the content numbers
 * stand for.
 */
function holdSpansCached(
  m: Model,
  food: Food,
  input: () => Parameters<typeof treatmentHoldSpans>[0],
  clears: Map<string, WithdrawalClear>,
  subjectText: string,
  doseText: string
): Span[] {
  const key = holdSpansKey(m, food, subjectText, doseText);
  const hit = key === null ? undefined : m.side!.spans.get(key);
  if (hit) return hit;
  let spans = normalizeSpans(treatmentHoldSpans(input(), clears));
  if (key !== null) {
    spans = keptSpans(m.side!, spans);
    remember(m.side!.spans, key, spans);
  }
  return spans;
}

function holdSpansKey(m: Model, food: Food, subjectText: string, doseText: string): string | null {
  return m.side && m.doseIds ? `w${m.env}|${food}|${subjectText}|${doseText}` : null;
}

/** `dosesText` of a group's own treatments, once per projection. */
function groupDosesText(m: Model, groupId: string, doses: readonly TreatmentRecord[]): string {
  let t = m.groupDoseTexts.get(groupId);
  if (t === undefined) {
    t = dosesText(m, doses);
    m.groupDoseTexts.set(groupId, t);
  }
  return t;
}

/** The treatments' content numbers, as text (side cache only). */
function dosesText(m: Model, doses: readonly TreatmentRecord[]): string {
  const ids = m.doseIds;
  if (!m.side || !ids) return '';
  let t = '';
  for (const d of doses) t += `${ids.get(d)},`;
  return t;
}

function windowsText(windows: readonly GroupMembership[]): string {
  let t = '';
  for (const w of windows) {
    t += `${JSON.stringify(w.groupId)},${w.fromMs},${w.toMs},${w.inheritedUntilMs};`;
  }
  return t;
}

/** An animal's withdrawal holds, in chunks: its own doses, then each
 *  group's doses over its windows in that group. The group chunk depends
 *  only on the group and the windows, so flock members share it. Every
 *  chunk is normalized. */
function withdrawalAnimal(
  m: Model,
  ctx: ProjectionContext,
  clears: Map<string, WithdrawalClear>,
  animalId: string,
  food: Food
): Span[][] {
  const plan = animalPlan(m, animalId);
  const chunks: Span[][] = [];
  const own = plan.own;
  const keep = m.side !== null && m.doseIds !== null;
  if (own.length > 0) {
    // Own doses are all direct, so the memberships are never read.
    const byFood = (plan.ownSpans ??= byFoodCache(
      m,
      () => `animal:${JSON.stringify(animalId)}|${dosesText(m, own)}`
    ));
    let spans = byFood[food];
    if (!spans) {
      spans = normalizeSpans(
        treatmentHoldSpans(
          {
            food,
            plugins: ctx.plugins,
            timeZone: ctx.timeZone,
            subject: { type: 'animal', id: animalId, memberships: plan.memberships },
            treatments: own
          },
          clears
        )
      );
      if (keep) spans = keptSpans(m.side!, spans);
      byFood[food] = spans;
    }
    chunks.push(spans);
  }
  for (const g of plan.byGroup) {
    const doses = g.doses;
    if (doses.length === 0) continue;
    let byFood = (g.byFood ??= m.groupDoseSpans.get(g.key));
    if (!byFood) {
      byFood = byFoodCache(
        m,
        () => `windows:${windowsText(g.windows)}|${groupDosesText(m, g.groupId, doses)}`
      );
      m.groupDoseSpans.set(g.key, byFood);
      g.byFood = byFood;
    }
    let spans = byFood[food];
    if (!spans) {
      spans = normalizeSpans(
        treatmentHoldSpans(
          {
            food,
            plugins: ctx.plugins,
            timeZone: ctx.timeZone,
            subject: { type: 'animal', id: '', memberships: g.windows },
            treatments: doses
          },
          clears
        )
      );
      if (keep) spans = keptSpans(m.side!, spans);
      byFood[food] = spans;
    }
    chunks.push(spans);
  }
  return chunks;
}

/**
 * Normalized withdrawal spans by food for one subject and set of
 * treatments: through the side cache when every treatment has a content
 * number (`text` then names everything else the kernel reads), else for
 * this projection only.
 */
function byFoodCache(m: Model, text: () => string): Partial<Record<Food, Span[]>> {
  if (!m.side || !m.doseIds) return {};
  const key = `w${m.env}|${text()}`;
  let byFood = m.side.byFood.get(key);
  if (!byFood) {
    byFood = {};
    remember(m.side.byFood, key, byFood);
  }
  return byFood;
}

/** Exposure from the stays of the animal itself and of every group it was
 *  in (except `skipGroup`), each group window computed once per projection
 *  and reading: flock members share their flock's stays. */
function memberExposure(
  m: Model,
  b: Buckets,
  ctx: ProjectionContext,
  plan: AnimalPlan,
  reading: SubjectFact | undefined,
  food: Food,
  skipGroup?: string
): Span[] {
  if (m.appsByField.size === 0) return [];
  const windows =
    skipGroup === undefined
      ? plan.physical
      : plan.physical.filter((x) => x.w.groupId !== skipGroup);
  if (plan.ownStays.length === 0) {
    if (windows.length === 0) return [];
    if (windows.length === 1) return windowExposure(m, b, ctx, windows[0], reading, food);
  }
  const out: Span[] = exposureSpansFast(
    exposureInputFor(m, ctx, b, reading, clip(m, plan.ownStays, ALL), food),
    m.exposureCache
  );
  for (const w of windows) {
    for (const sp of windowExposure(m, b, ctx, w, reading, food)) out.push(sp);
  }
  return out;
}

/** Eggs read exactly as milk when no stay carries a stored floor (the
 *  floor is the only part of the exposure kernel that reads the food
 *  for anything but meat), so the two share one computation. */
function exposureFood(food: Food, floors: boolean): Food {
  return food === 'eggs' && !floors ? 'milk' : food;
}

function hasFloors(stays: readonly ExposureStay[]): boolean {
  for (const s of stays) if (s.floor && s.floor.length > 0) return true;
  return false;
}

function readingKey(m: Model, reading: SubjectFact | undefined): string {
  if (!reading) return `${JSON.stringify(null)}|true`;
  let k = m.readingKeys.get(reading);
  if (k === undefined) {
    k = `${JSON.stringify(reading.speciesId)}|${lactatingOf(reading)}`;
    m.readingKeys.set(reading, k);
  }
  return k;
}

/** Clipped stays of a group with the applications they can meet, and
 *  their normalized exposure by reading and food. */
interface StaySet {
  stays: ClippedStay[];
  /** The applications each stay can meet (`appsReaching`), once needed. */
  apps?: ReadonlyMap<string, readonly GrazingApplication[]>;
  floors: boolean;
  /** Exposure by `readingKey`, then by food. */
  spans: Map<string, Partial<Record<Food, Span[]>>>;
  /** `staySetId`, once. */
  id?: string;
}

function sameStays(a: readonly ClippedStay[], b: readonly ClippedStay[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.src !== y.src || x.fromMs !== y.fromMs || x.toMs !== y.toMs) return false;
  }
  return true;
}

/** The group's stay set equal to `stays`, made once. */
function staySet(
  m: Model,
  ctx: ProjectionContext,
  b: Buckets,
  groupId: string,
  stays: ClippedStay[]
): StaySet {
  let list = m.staySets.get(groupId);
  if (!list) {
    list = [];
    m.staySets.set(groupId, list);
  }
  for (const set of list) if (sameStays(set.stays, stays)) return set;
  const set: StaySet = { stays, floors: hasFloors(stays), spans: new Map() };
  list.push(set);
  return set;
}

/** A stay set's exposure for one reading and food, normalized, once; with
 *  a side cache, once for the same content across projections. */
function setExposure(
  m: Model,
  b: Buckets,
  ctx: ProjectionContext,
  set: StaySet,
  reading: SubjectFact | undefined,
  food: Food
): Span[] {
  const f = exposureFood(food, set.floors);
  const rk = readingKey(m, reading);
  let byFood = set.spans.get(rk);
  if (!byFood) {
    byFood = {};
    set.spans.set(rk, byFood);
  }
  let spans = byFood[f];
  if (spans) return spans;
  const key = `${rk}|${f}`;
  const side = m.side;
  const contentKey = side ? `x${m.env}|${key}|${staySetId(m, set)}` : '';
  spans = side?.spans.get(contentKey);
  if (!spans) {
    spans = normalizeSpans(
      exposureSpansFast(
        exposureInputFor(
          m,
          ctx,
          b,
          reading,
          set.stays,
          f,
          (set.apps ??= appsReaching(m, ctx, b, set.stays))
        ),
        m.exposureCache
      )
    );
    if (side) {
      spans = keptSpans(side, spans);
      remember(side.spans, contentKey, spans);
    }
  }
  byFood[f] = spans;
  return spans;
}

/** Everything about a stay set the exposure kernel reads (each stay's
 *  Area, times and stored floor, and the applications it is given), as a
 *  content number. */
function staySetId(m: Model, set: StaySet): string {
  if (set.id !== undefined) return set.id;
  if (!m.side) return (set.id = '');
  let t = '';
  const fields: string[] = [];
  for (const st of set.stays) {
    t += stayText(m, st);
    if (!fields.includes(st.fieldId)) fields.push(st.fieldId);
  }
  // Every application on the stays' Areas: the ones the kernel is given
  // are picked from these by the stays and `env` alone.
  t += '#';
  for (const fieldId of fields) t += fieldAppsText(m, fieldId);
  set.id = `s${internId(m.side, t)}`;
  return set.id;
}

function stayText(m: Model, st: ClippedStay): string {
  let t = m.stayTexts.get(st);
  if (t === undefined) {
    t = `${JSON.stringify(st.fieldId)},${st.fromMs},${st.toMs},${st.floor && st.floor.length ? JSON.stringify(st.floor) : ''};`;
    m.stayTexts.set(st, t);
  }
  return t;
}

function fieldAppsText(m: Model, fieldId: string): string {
  let t = m.fieldAppTexts.get(fieldId);
  if (t === undefined) {
    t = `${JSON.stringify(fieldId)}:`;
    for (const app of m.appsByField.get(fieldId) ?? []) t += `${m.appId(app)},`;
    t = m.side ? `f${internId(m.side, t)};` : `${t};`;
    m.fieldAppTexts.set(fieldId, t);
  }
  return t;
}

/** One group window's exposure, normalized, computed once per projection. */
function windowExposure(
  m: Model,
  b: Buckets,
  ctx: ProjectionContext,
  kw: KeyedWindow,
  reading: SubjectFact | undefined,
  food: Food
): Span[] {
  let ws = (kw.set ??= m.windowStays.get(kw.key));
  if (!ws) {
    ws = staySet(m, ctx, b, kw.w.groupId, clip(m, m.staysOf('group', kw.w.groupId), kw.w));
    m.windowStays.set(kw.key, ws);
    kw.set = ws;
  }
  return setExposure(m, b, ctx, ws, reading, food);
}

/** The grazing and haying holds one Area's (or one Area-less block's)
 *  applications put on it and on its blocks, normalized, in the order the
 *  keys first get a span. */
function areaHolds(
  m: Model,
  b: Buckets,
  ctx: ProjectionContext,
  key: SubjectKey,
  apps: readonly GrazingApplication[],
  grazed: boolean,
  registryMax: number
): { k: SubjectKey; kind: HoldKind; spans: Span[] }[] {
  const side = m.side;
  const look = Math.max(GRAZING_LOOKBACK_DAYS, registryMax);
  const found = new Map<string, { k: SubjectKey; kind: HoldKind; spans: Span[] }>();
  for (const app of apps) {
    if (!Number.isFinite(app.appliedAtMs)) continue;
    const verdictKey = side ? `v${m.env}|${registryMax}|${m.appId(app)}` : '';
    let pair = side?.area.get(verdictKey);
    if (!pair) {
      const base = {
        applications: [app],
        attestations: b.attestations,
        atMs: app.appliedAtMs,
        timeZone: ctx.timeZone,
        registryMaxIntervalDays: registryMax
      };
      pair = [evaluateGrazing({ ...base, subject: STRICTEST_SUBJECT }), evaluateHayCut(base)];
      if (side) remember(side.area, verdictKey, pair);
    }
    const verdicts = [
      ['graze', pair[0]],
      ['hay', pair[1]]
    ] as const;
    const blockKey = `block:${app.blockId}`;
    // A block in no Area holds no grazing: animals are only ever moved
    // onto Areas, so no gate could read it (review round 5).
    for (const [kind, verdict] of verdicts) {
      const keys =
        kind === 'hay'
          ? grazed && key !== blockKey
            ? [key, blockKey]
            : [blockKey]
          : grazed && key !== blockKey
            ? [key]
            : [];
      if (keys.length === 0) continue;
      for (const f of verdict.findings) {
        if (f.ref !== app.ref) continue;
        let span: Span | null;
        if (f.days !== null) {
          span =
            f.clearsAtMs !== null && f.clearsAtMs > app.appliedAtMs && f.days > 0
              ? { fromMs: app.appliedAtMs, toMs: f.clearsAtMs, basis: 'known' }
              : null;
        } else {
          span = {
            fromMs: app.appliedAtMs,
            toMs: app.appliedAtMs + look * DAY_MS + 1,
            basis: f.reason === 'GRAZING_PROHIBITED' ? 'prohibited' : 'unknown'
          };
        }
        if (!span) continue;
        for (const k of keys) {
          const id = holdMapKey(k, kind);
          const entry = found.get(id);
          if (entry) entry.spans.push(span);
          else found.set(id, { k, kind, spans: [span] });
        }
      }
    }
  }
  const out: { k: SubjectKey; kind: HoldKind; spans: Span[] }[] = [];
  for (const entry of found.values()) {
    const spans = normalizeSpans(entry.spans);
    out.push({ k: entry.k, kind: entry.kind, spans: side ? keptSpans(side, spans) : spans });
  }
  return out;
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
  const m = model(b, nowMs, ctx);
  const { clears, doseIds } = verdictsFor(b.doses, ctx, m.side);
  m.doseIds = doseIds;
  // Chunks per hold key, in the order keys first get a span (the order
  // of `holds`), with each subject's keys held in its own slots.
  type Entry = { k: string; chunks: (readonly Span[])[]; spans?: Span[] };
  const order: Entry[] = [];
  let slots: Partial<Record<HoldKind, Entry>> = {};
  let slotsKey = '';
  const areaSlots = new Map<string, typeof slots>();
  const add = (key: SubjectKey, kind: HoldKind, spans: readonly Span[]) => {
    if (spans.length === 0) return;
    if (key !== slotsKey) {
      slots = areaSlots.get(key) ?? {};
      areaSlots.set(key, slots);
      slotsKey = key;
    }
    const entry = slots[kind];
    if (entry) entry.chunks.push(spans);
    else {
      const created = { k: holdMapKey(key, kind), chunks: [spans] };
      slots[kind] = created;
      order.push(created);
    }
  };

  const withdrawalOf = (animalId: string, food: Food): Span[][] => {
    const plan = animalPlan(m, animalId);
    return (plan.withdrawal[food] ??= withdrawalAnimal(m, ctx, clears, animalId, food));
  };

  for (const s of b.subjects.values()) {
    const key = subjectRef(s.subjectType, s.id);
    if (s.subjectType === 'animal') {
      const plan = animalPlan(m, s.id);
      for (const food of FOODS) {
        for (const chunk of withdrawalOf(s.id, food)) add(key, food, chunk);
        add(key, food === 'meat' ? 'preSlaughter' : food, memberExposure(m, b, ctx, plan, s, food));
      }
      continue;
    }
    const lineage = m.lineage(s.id);
    const groupTreatments = groupDoses(m, s.id, lineage);
    const groupText = `group:${JSON.stringify(s.id)}:${windowsText(lineage)}`;
    const groupTreatmentsText = dosesText(m, groupTreatments);
    const members: { animalId: string; windows: GroupMembership[]; windowsKey: string }[] = [];
    for (const animalId of m.membersEver(s.id)) {
      const windows = m
        .memberships(animalId)
        .filter((w) => w.groupId === s.id)
        .map(physicalWindow);
      if (windows.length === 0) continue;
      members.push({
        animalId,
        windows,
        windowsKey: windows.map((x) => `${x.fromMs},${x.toMs}`).join(';')
      });
    }
    let gs: StaySet | null = null;
    for (const food of FOODS) {
      // The group's own and lineage treatments, then (for eggs and milk)
      // each member's withdrawal while it was in this group: the reach
      // rules of `treatmentHoldSpans` for a group, with each member's
      // spans taken from its own (shared) withdrawal projection.
      const own = holdSpansCached(
        m,
        food,
        () => ({
          subject: { type: 'group', id: s.id, lineage, members: [] },
          food,
          treatments: groupTreatments,
          plugins: ctx.plugins,
          timeZone: ctx.timeZone
        }),
        clears,
        groupText,
        groupTreatmentsText
      );
      if (food === 'meat') add(key, food, own);
      else {
        // Members in this group over the same windows share one union of
        // their withdrawal, cut to those windows once.
        const byWindows = new Map<
          string,
          { windows: GroupMembership[]; shared: Span[][]; raw: Span[] }
        >();
        for (const member of members) {
          const w = withdrawalOf(member.animalId, food);
          let entry = byWindows.get(member.windowsKey);
          if (!entry) {
            entry = { windows: member.windows, shared: [], raw: [] };
            byWindows.set(member.windowsKey, entry);
          }
          for (const chunk of w) {
            if (chunk.length === 0) continue;
            if (NORMALIZED.has(chunk)) {
              if (!entry.shared.includes(chunk)) entry.shared.push(chunk);
            } else for (const sp of chunk) entry.raw.push(sp);
          }
        }
        const chunks: Span[][] = [own];
        byWindows.forEach((entry, windowsKey) => {
          if (entry.shared.length === 0 && entry.raw.length === 0) return;
          if (entry.raw.length) entry.shared.push(entry.raw);
          chunks.push(cutTo(m, mergeChunks(entry.shared, m.mergeMemo), entry.windows, windowsKey));
        });
        add(key, food, chunks.length === 1 ? own : mergeChunks(chunks, m.mergeMemo));
      }
      if (m.appsByField.size === 0) continue;
      if (!gs) {
        const stays = clip(m, m.staysOf('group', s.id), ALL);
        for (const l of lineage) stays.push(...clip(m, m.staysOf('group', l.groupId), l));
        gs = staySet(m, ctx, b, s.id, stays);
      }
      const groupSpans = setExposure(m, b, ctx, gs, s, food);
      add(key, food === 'meat' ? 'preSlaughter' : food, groupSpans);
      if (food === 'meat') continue;
      for (const member of members) {
        const spans = memberExposure(m, b, ctx, animalPlan(m, member.animalId), s, food, s.id);
        if (spans.length > 0) add(key, food, intersect(spans, member.windows));
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
  const side = m.side;
  for (const [key, apps] of areaApps) {
    const grazed = grazedArea(b, key);
    let registryMax = ctx.registryMaxIntervalDays;
    for (const a of apps) {
      const d = intervalDays(m, b, a);
      if (d > registryMax) registryMax = d;
    }
    // An Area's grazing and haying holds depend only on its applications,
    // whether it is grazing land, the registry maximum and `env`.
    let groupKey = '';
    if (side) {
      groupKey = `g${m.env}|${registryMax}|${grazed}|${JSON.stringify(key)}|`;
      for (const app of apps) groupKey += `${m.appId(app)},`;
      const kept = side.areaHolds.get(groupKey);
      if (kept) {
        for (const o of kept) add(o.k, o.kind, o.spans);
        continue;
      }
    }
    const made = areaHolds(m, b, ctx, key, apps, grazed, registryMax);
    if (side) remember(side.areaHolds, groupKey, made);
    for (const o of made) add(o.k, o.kind, o.spans);
  }

  const holds = new Map<string, Span[]>();
  for (const entry of order) {
    const n = mergeChunks(entry.chunks, m.mergeMemo);
    if (n.length) {
      holds.set(entry.k, n);
      entry.spans = n;
    }
  }

  const covered = new Map<string, HoldBasis>();
  // Each subject's merged holds by kind, looked up without building keys.
  const subjectHolds = new Map<string, Map<string, Partial<Record<HoldKind, Span[]>>>>();
  for (const s of b.subjects.values()) {
    const slotsOf = areaSlots.get(subjectRef(s.subjectType, s.id));
    if (!slotsOf) continue;
    let byId = subjectHolds.get(s.subjectType);
    if (!byId) {
      byId = new Map();
      subjectHolds.set(s.subjectType, byId);
    }
    const kinds: Partial<Record<HoldKind, Span[]>> = {};
    for (const kind of HOLD_KINDS) {
      const entry = slotsOf[kind];
      if (entry?.spans) kinds[kind] = entry.spans;
    }
    byId.set(s.id, kinds);
  }
  const heldOn = (type: string, id: string, kind: HoldKind, atMs: number): HoldBasis | null => {
    const spans = subjectHolds.get(type)?.get(id)?.[kind];
    return spans ? containsSorted(spans, atMs) : null;
  };
  for (const p of b.production) {
    if (!p.declaredUse || p.food === 'meat') continue;
    const hit = heldOn(p.subjectType, p.subjectId, p.food, p.occurredAtMs);
    if (hit) covered.set(`log:${p.id}`, hit);
  }
  for (const s of b.status) {
    if (!s.declaresMeat) continue;
    const meat = heldOn(s.subjectType, s.subjectId, 'meat', s.occurredAtMs);
    const pre = heldOn(s.subjectType, s.subjectId, 'preSlaughter', s.occurredAtMs);
    const basis = meat && pre ? stronger(meat, pre) : (meat ?? pre);
    if (basis) covered.set(`meat:${s.id}`, basis);
  }
  for (const h of b.hay) {
    const mow = h.datesMs[0];
    if (mow === undefined) continue;
    let basis: HoldBasis | null = null;
    for (const k of hayKeysOfBlock(b.fieldOfBlock.get(h.blockId), h.blockId)) {
      const spans = holds.get(holdMapKey(k, 'hay'));
      const hit = spans ? containsSorted(spans, mow) : null;
      if (hit) basis = basis === null ? hit : stronger(basis, hit);
    }
    if (basis) covered.set(`${h.source ?? 'hay'}:${h.id}`, basis);
  }
  const grazeOf = new Map<string, Span[] | undefined>();
  for (const s of b.stays) {
    let spans = grazeOf.get(s.fieldId);
    if (!grazeOf.has(s.fieldId)) {
      spans = holds.get(holdMapKey(`area:${s.fieldId}`, 'graze'));
      grazeOf.set(s.fieldId, spans);
    }
    if (!spans) continue;
    const basis = overlapsSorted(spans, s.fromMs, s.toMs ?? nowMs);
    if (basis) covered.set(`stay:${s.id}`, basis);
  }
  return { holds, covered, blocks: new Set(b.fieldOfBlock.keys()) };
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
 * Every instant in a hold before and not after, or held after only on a
 * weaker basis, for every key, over all of time; plus every covered
 * declaration or stay that is no longer covered, or covered more weakly.
 * A key missing from `after` counts as never held.
 */
export function shortenings(
  before: HoldProjection,
  after: HoldProjection,
  opts: ShorteningOptions = {}
): HoldDiff {
  const holds: Shortening[] = [];
  for (const [k, spans] of before.holds) {
    if (blockDeleted(k, before, after)) continue;
    const next = after.holds.get(k) ?? [];
    // The same normalized list on both sides (a kept projection result)
    // loses nothing.
    if (next === spans && sortedDisjoint(spans)) continue;
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
    const now = after.covered.get(id);
    if (now !== undefined && BASIS_RANK[now] >= BASIS_RANK[basis]) continue;
    if (opts.resolvesUnknown && basis === 'unknown') continue;
    coverage.push({ id, basis });
  }
  holds.sort((a, b) => (a.key + a.kind).localeCompare(b.key + b.kind));
  coverage.sort((a, b) => a.id.localeCompare(b.id));
  return { holds, coverage };
}

/** A block's own holds end with the block: nothing can be cut from, or
 *  grazed on, a block that is gone (its Area's holds still count). */
function blockDeleted(k: string, before: HoldProjection, after: HoldProjection): boolean {
  if (!k.startsWith('block:')) return false;
  const id = splitHoldMapKey(k).key.slice(6);
  return before.blocks?.has(id) === true && after.blocks?.has(id) === false;
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
