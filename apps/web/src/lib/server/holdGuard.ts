/**
 * C-35: the single place a write is checked against the hold ledger.
 *
 * `guardedHoldWrite` runs a record endpoint's writes inside `writeRecord()`'s
 * transaction (replay receipt included), and around them:
 *
 * 1. loads every hold fact of the active Owner, tombstones included, and
 *    projects the farm's holds (`projectHolds`, pure);
 * 2. runs the writes;
 * 3. reloads and projects again, in the same transaction;
 * 4. refuses, rolling everything back, when a new or changed date is in the
 *    future or too far back (§1), when a declaration or terminal event is
 *    out of order (§4), or when anything held before is not held after (§2):
 *    `409 HOLD_WOULD_SHORTEN`. The only exception is an interactive owner
 *    voiding a fresh mistake with the confirmed diff (§5).
 *
 * Single replica plus SQLite's single writer: nothing can land between the
 * check and the write. New doses and applications get their hold
 * parameters stored here (`hold_params_json`), so a later data change can
 * only lengthen their holds.
 */

import { createHash } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { insertHoldCorrection } from '$lib/db/holdCorrections';
import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { listAllLocations } from '$lib/db/animalLocations';
import { listAllHealthEvents, listAllHealthTombstones } from '$lib/db/animalHealth';
import { listAllProductionLogs, listDeletedProductionLogs } from '$lib/db/animalProduction';
import { listAllStatusEvents, listUndoneStatusEvents } from '$lib/db/animalStatus';
import { listAllCuttings } from '$lib/db/hayCuttings';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listBlocks } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { readHoldParams, writeHoldParams } from '$lib/db/holdParams';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { prefsFor } from '$lib/db/userProfile';
import { MAX_FUTURE_SKEW_MS, isOutcomeStatus } from '$lib/animals/model';
import {
  DATE_RULE_COPY,
  crossingHoldMessage,
  holdShortenMessage,
  type HoldKindWord,
  type ShortenedHold
} from '$lib/animals/holdGuardCopy';
import { parseExposureFloor } from '$lib/safety/grazingExposure';
import type { PluginLookup, TreatmentRecord } from '$lib/safety/animalWithdrawal';
import {
  HOLD_FACT_KINDS,
  canonicalDiff,
  diffIsVoidable,
  heldAt,
  holdMapKey,
  holdStartsAfter,
  isDeclaration,
  isEmptyDiff,
  projectHolds,
  shortenings,
  type FactKind,
  type HoldDiff,
  type HoldFact,
  type HoldKind,
  type HoldProjection,
  type ProjectionContext
} from '$lib/safety/holdLedger';
import { RULES_VERSION } from '$lib/safety/version';
import type { PluginRegistry } from '$lib/plugins/registry';
import { getBaseRegistry, getDataKinds, getRegistry } from './registry';
import { healthPlugins, toTreatment, declaresMeat, type DoseHoldParams } from './animalRecords';
import {
  applicationHoldParams,
  grazingContextFrom,
  type ApplicationHoldParams
} from './areaGrazing';
import { AnimalRuleError } from './animals';
import { isInteractiveOwner } from './interactiveOwner';
import { writeRecord } from './recordWrite';
import type { AuthenticatedUser } from './auth';

const DAY_MS = 86_400_000;
export const DECLARATION_LOOKBACK_OWNER_MS = 7 * DAY_MS;
export const DECLARATION_LOOKBACK_HELPER_MS = DAY_MS;
export const OTHER_LOOKBACK_MS = 400 * DAY_MS;
/** A record dated within this of the transaction's start is dated "now":
 *  the endpoint read the clock for its default date a moment before the
 *  guard did. Open stays, courses and memberships close here. */
export const NOW_SLACK_MS = 60_000;

export interface GuardUser {
  id: string;
  role: AuthenticatedUser['role'];
  impersonating?: boolean;
}

export interface HoldVoid {
  recordKind: string;
  recordId: string;
  /** Server-set `created_at` of the record being voided. */
  createdAtMs: number;
  reason: string;
  /** The `diffHash` the owner saw and confirmed. */
  confirmShorten?: string | null;
}

export interface GuardOptions {
  /** Owner label data filling an unknown interval (C-01, C-27). */
  resolvesUnknown?: boolean;
  /** An owner void of a fresh mistake (§5). */
  void?: HoldVoid;
  /** The write carries a date the person chose, so the same record dated
   *  now is a way out (§6). */
  dated?: boolean;
  /** Test seam: the clock at the start of the transaction. */
  nowMs?: number;
}

interface Loaded {
  facts: HoldFact[];
  labels: Map<string, string>;
  ctx: ProjectionContext;
}

interface Prepared {
  /** Verdicts by treatment content, kept while the plugin data is the same. */
  verdictCache: NonNullable<ProjectionContext['verdictCache']>;
  plugins: PluginLookup;
  registry: PluginRegistry;
  base: PluginRegistry;
  speciesProducts: (speciesId: string) => readonly string[];
  timeZone: string;
}

/** Verdicts keyed by treatment, plugin data and zone (see `projectHolds`).
 *  Tenant-neutral: a key holds the treatment itself, so nothing is shared
 *  between farms that is not already in the key. */
const VERDICTS: NonNullable<ProjectionContext['verdictCache']> = new Map();
const MAX_CACHED_VERDICTS = 50_000;

export async function prepareHoldGuard(timeZone: string): Promise<Prepared> {
  const [plugins, registry, base, kinds] = await Promise.all([
    healthPlugins(),
    getRegistry(),
    getBaseRegistry(),
    getDataKinds()
  ]);
  if (VERDICTS.size > MAX_CACHED_VERDICTS) VERDICTS.clear();
  const verdictCache = VERDICTS;
  return {
    verdictCache,
    plugins,
    registry,
    base,
    speciesProducts: (id) => kinds.species.get(id)?.products ?? ['milk', 'eggs', 'meat'],
    timeZone
  };
}

function parseDoseParams(json: string | undefined): DoseHoldParams | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as DoseHoldParams;
  } catch {
    return null;
  }
}

/** Every hold fact of the active Owner, through the tenant-scoped repos. */
export function loadHoldFacts(
  p: Prepared,
  nowMs: number,
  verdictCache: ProjectionContext['verdictCache'] = p.verdictCache
): Loaded {
  const facts: HoldFact[] = [];
  const labels = new Map<string, string>();
  const species = new Map<string, { speciesId: string; sex: string | null }>();
  for (const a of listAnimals({ status: 'all' })) {
    species.set(`animal:${a.id}`, { speciesId: a.speciesId, sex: a.sex });
    labels.set(`animal:${a.id}`, a.name ?? (a.tag ? `Tag ${a.tag}` : 'An animal'));
    facts.push({
      kind: 'subject',
      subjectType: 'animal',
      id: a.id,
      speciesId: a.speciesId,
      sex: a.sex,
      currentGroupId: a.groupId,
      speciesProducts: p.speciesProducts(a.speciesId)
    });
  }
  for (const g of listAnimalGroups({ status: 'all' })) {
    species.set(`group:${g.id}`, { speciesId: g.speciesId, sex: null });
    labels.set(`group:${g.id}`, g.name);
    facts.push({
      kind: 'subject',
      subjectType: 'group',
      id: g.id,
      speciesId: g.speciesId,
      sex: null,
      currentGroupId: null,
      speciesProducts: p.speciesProducts(g.speciesId)
    });
  }
  const speciesOf = (type: string, id: string) =>
    species.get(`${type}:${id}`) ?? { speciesId: 'unknown', sex: null };
  const live = listAllHealthEvents();
  const seen = new Set(live.map((e) => e.id));
  for (const e of live) {
    facts.push({ kind: 'dose', treatment: toTreatment(e, speciesOf(e.subjectType, e.subjectId)) });
  }
  for (const t of listAllHealthTombstones()) {
    if (seen.has(t.recordId)) continue;
    seen.add(t.recordId);
    facts.push({
      kind: 'dose',
      treatment: toTreatment(t.event, speciesOf(t.event.subjectType, t.event.subjectId), {
        dosed: t.dosed
      })
    });
  }
  for (const s of listAllLocations()) {
    if (s.voidedAt !== null) continue;
    facts.push({
      kind: 'stay',
      id: s.id,
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      fieldId: s.fieldId,
      fromMs: s.fromMs,
      toMs: s.toMs,
      fromGroupId: s.fromGroupId,
      toGroupId: s.toGroupId,
      floor: parseExposureFloor(s.exposureFloor),
      deleted: s.deletedAt !== null
    });
  }
  const grazing = grazingContextFrom(p.registry, p.base, nowMs, {
    fromAtMs: Number.NEGATIVE_INFINITY
  });
  for (const a of grazing.applications) facts.push({ kind: 'application', application: a });
  for (const t of grazing.attestations) facts.push({ kind: 'attestation', attestation: t });
  for (const b of listBlocks({ plantings: 'none' })) {
    facts.push({ kind: 'block-assignment', blockId: b.id, fieldId: b.fieldId ?? null });
  }
  const logs = listAllProductionLogs();
  const liveLogs = new Set(logs.map((l) => l.id));
  const deletedLogs = listDeletedProductionLogs().filter((l) => !liveLogs.has(l.id));
  for (const [l, deleted] of [
    ...logs.map((l) => [l, false] as const),
    ...deletedLogs.map((l) => [l, true] as const)
  ]) {
    if (l.kind !== 'eggs' && l.kind !== 'milk') continue;
    const declared = l.declaredUse ?? (l.use === 'food' || l.use === 'sale' ? l.use : null);
    facts.push({
      kind: 'production',
      id: l.id,
      subjectType: l.subjectType,
      subjectId: l.subjectId,
      food: l.kind,
      declaredUse: declared,
      occurredAtMs: l.occurredAt,
      deleted
    });
  }
  const statuses = listAllStatusEvents();
  const liveStatus = new Set(statuses.map((e) => e.id));
  for (const [e, deleted] of [
    ...statuses.map((e) => [e, false] as const),
    ...listUndoneStatusEvents()
      .filter((e) => !liveStatus.has(e.id))
      .map((e) => [e, true] as const)
  ]) {
    facts.push({
      kind: 'status',
      id: e.id,
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      status: e.status,
      declaresMeat: declaresMeat(e),
      occurredAtMs: e.occurredAt,
      deleted
    });
  }
  for (const c of listAllCuttings()) {
    const dates = [c.mowAt, c.tedAt, c.rakeAt, c.baleAt, c.storedAt].filter(
      (d): d is number => typeof d === 'number'
    );
    facts.push({ kind: 'hay', source: 'hay', id: c.id, blockId: c.blockId, datesMs: dates });
  }
  for (const h of listHarvestEvents()) {
    if (!h.rulesVersion) continue;
    facts.push({
      kind: 'hay',
      source: 'harvest',
      id: h.id,
      blockId: h.blockId,
      datesMs: [h.occurredAt]
    });
  }
  return {
    facts,
    labels,
    ctx: {
      plugins: p.plugins,
      timeZone: p.timeZone,
      registryMaxIntervalDays: grazing.registryMaxIntervalDays,
      verdictCache
    }
  };
}

// ─── Fact identity and dates ────────────────────────────────────────────

interface Dated {
  id: string;
  kinds: readonly FactKind[];
  dates: number[];
  fact: HoldFact;
}

function doseDates(t: TreatmentRecord): number[] {
  const out = [t.administeredAtMs];
  if (t.courseEndAtMs !== null) out.push(t.courseEndAtMs);
  if (t.entries !== 'invalid') {
    for (const e of t.entries) if (e.kind === 'course-end') out.push(e.endedAtMs);
  }
  return out;
}

function dated(f: HoldFact): Dated | null {
  const kinds = HOLD_FACT_KINDS[f.kind];
  switch (f.kind) {
    case 'dose':
      return { id: `dose:${f.treatment.id}`, kinds, dates: doseDates(f.treatment), fact: f };
    case 'stay':
      return {
        id: `stay:${f.id}`,
        kinds,
        dates: f.toMs === null ? [f.fromMs] : [f.fromMs, f.toMs],
        fact: f
      };
    case 'application':
      return {
        id: `app:${f.application.ref}|${f.application.productPluginId ?? ''}`,
        kinds,
        dates: [f.application.appliedAtMs],
        fact: f
      };
    case 'production':
      return {
        id: `log:${f.id}`,
        kinds: f.declaredUse ? kinds : [],
        dates: [f.occurredAtMs],
        fact: f
      };
    case 'status':
      return {
        id: `status:${f.id}`,
        kinds: f.declaresMeat ? kinds : ['status-outcome'],
        dates: [f.occurredAtMs],
        fact: f
      };
    case 'hay':
      return { id: `${f.source ?? 'hay'}:${f.id}`, kinds, dates: [...f.datesMs], fact: f };
    case 'subject':
    case 'block-assignment':
    case 'attestation':
      return null;
  }
}

interface Written {
  fact: HoldFact;
  kinds: readonly FactKind[];
  /** Dates this write put on the record. */
  newDates: number[];
  isNew: boolean;
}

function writtenFacts(before: readonly HoldFact[], after: readonly HoldFact[]): Written[] {
  const prior = new Map<string, number[]>();
  for (const f of before) {
    const d = dated(f);
    if (d) prior.set(d.id, [...(prior.get(d.id) ?? []), ...d.dates]);
  }
  const out: Written[] = [];
  for (const f of after) {
    const d = dated(f);
    if (!d) continue;
    const old = prior.get(d.id);
    const newDates = d.dates.filter((ms) => !old || !old.includes(ms));
    if (newDates.length === 0 && old) continue;
    out.push({ fact: f, kinds: d.kinds, newDates, isNew: !old });
  }
  return out;
}

// ─── §1 date checks ─────────────────────────────────────────────────────

function dateRefusal(
  written: readonly Written[],
  nowMs: number,
  ownerTier: boolean
): AnimalRuleError | null {
  for (const w of written) {
    for (const ms of w.newDates) {
      if (ms > nowMs + MAX_FUTURE_SKEW_MS) {
        return new AnimalRuleError('IN_THE_FUTURE', 400, DATE_RULE_COPY.IN_THE_FUTURE);
      }
    }
  }
  for (const w of written) {
    const declares = w.kinds.some(isDeclaration);
    const window = declares
      ? ownerTier
        ? DECLARATION_LOOKBACK_OWNER_MS
        : DECLARATION_LOOKBACK_HELPER_MS
      : OTHER_LOOKBACK_MS;
    for (const ms of w.newDates) {
      if (ms < nowMs - window) {
        return new AnimalRuleError(
          'BACKDATE_TOO_FAR',
          422,
          declares ? DATE_RULE_COPY.BACKDATE_DECLARATION : DATE_RULE_COPY.BACKDATE_OTHER,
          { windowDays: Math.round(window / DAY_MS), declaration: declares }
        );
      }
    }
  }
  return null;
}

// ─── §4 declarations and lifecycle order ────────────────────────────────

function declarationKeys(f: HoldFact, fieldOfBlock: Map<string, string | null>): string[] {
  if (f.kind === 'production' && f.declaredUse) {
    return [holdMapKey(`${f.subjectType}:${f.subjectId}`, f.food)];
  }
  if (f.kind === 'status' && f.declaresMeat) {
    const key = `${f.subjectType}:${f.subjectId}`;
    return [holdMapKey(key, 'meat'), holdMapKey(key, 'preSlaughter')];
  }
  if (f.kind === 'hay') {
    const fieldId = fieldOfBlock.get(f.blockId);
    return [holdMapKey(fieldId ? `area:${fieldId}` : `block:${f.blockId}`, 'hay')];
  }
  return [];
}

function openerName(facts: readonly HoldFact[], atMs: number): string {
  for (const f of facts) {
    if (f.kind === 'dose' && f.treatment.administeredAtMs === atMs) {
      return f.treatment.productName?.trim() || f.treatment.productPluginId || 'A treatment';
    }
    if (f.kind === 'application' && f.application.appliedAtMs === atMs) {
      return f.application.productName;
    }
  }
  return 'A hold';
}

function subjectOfKey(key: string): string {
  return key.slice(0, key.lastIndexOf('|'));
}

function orderRefusal(
  loaded: Loaded,
  after: HoldProjection,
  written: readonly Written[],
  nowMs: number
): AnimalRuleError | null {
  const fieldOfBlock = new Map<string, string | null>();
  for (const f of loaded.facts)
    if (f.kind === 'block-assignment') fieldOfBlock.set(f.blockId, f.fieldId);
  for (const w of written) {
    const keys = declarationKeys(w.fact, fieldOfBlock);
    if (keys.length === 0 || w.newDates.length === 0) continue;
    for (const atMs of w.newDates) {
      const held = heldAt(after, keys, atMs);
      if (held) {
        return new AnimalRuleError(
          'HOLD_ACTIVE',
          422,
          'A hold on file covers that date, so this cannot be saved as food, for sale or cut for hay. Save as discarded instead.',
          { resubmitAs: 'discard', basis: held }
        );
      }
      const crossing = holdStartsAfter(after, keys, atMs, nowMs);
      if (crossing) {
        const subjectKey = subjectOfKey(keys[0]);
        const label = loaded.labels.get(subjectKey) ?? areaLabel(subjectKey) ?? 'these animals';
        return new AnimalRuleError(
          'OUT_OF_ORDER',
          409,
          crossingHoldMessage(
            openerName(loaded.facts, crossing.fromMs),
            label,
            crossing.fromMs,
            loaded.ctx.timeZone
          ),
          { resubmitAs: 'discard' }
        );
      }
    }
  }
  return terminalRefusal(loaded, written);
}

/** §4b: slaughter, sale and death come last for an animal. */
function terminalRefusal(loaded: Loaded, written: readonly Written[]): AnimalRuleError | null {
  const statusByAnimal = new Map<string, { at: number; status: string; id: string }[]>();
  for (const f of loaded.facts) {
    if (f.kind !== 'status' || f.deleted || f.subjectType !== 'animal') continue;
    const list = statusByAnimal.get(f.subjectId) ?? [];
    list.push({ at: f.occurredAtMs, status: f.status, id: f.id });
    statusByAnimal.set(f.subjectId, list);
  }
  const terminalOf = (animalId: string) => {
    const list = statusByAnimal.get(animalId);
    if (!list?.length) return null;
    const last = list.reduce((a, b) => (b.at >= a.at ? b : a));
    return isOutcomeStatus(last.status) ? last : null;
  };
  const directDates = (animalId: string, exceptStatus?: string): number[] => {
    const out: number[] = [];
    for (const f of loaded.facts) {
      if (
        f.kind === 'dose' &&
        f.treatment.subjectType === 'animal' &&
        f.treatment.subjectId === animalId
      ) {
        if (f.treatment.deletion?.dosed === false) continue;
        out.push(...doseDates(f.treatment));
      } else if (
        f.kind === 'stay' &&
        f.subjectType === 'animal' &&
        f.subjectId === animalId &&
        !f.deleted
      ) {
        out.push(f.fromMs);
      } else if (
        f.kind === 'production' &&
        !f.deleted &&
        f.subjectType === 'animal' &&
        f.subjectId === animalId
      ) {
        out.push(f.occurredAtMs);
      } else if (
        f.kind === 'status' &&
        !f.deleted &&
        f.subjectType === 'animal' &&
        f.subjectId === animalId &&
        f.id !== exceptStatus
      ) {
        out.push(f.occurredAtMs);
      }
    }
    return out;
  };
  for (const w of written) {
    const f = w.fact;
    if (f.kind === 'status' && f.subjectType === 'animal' && isOutcomeStatus(f.status) && w.isNew) {
      const later = directDates(f.subjectId, f.id).filter((d) => d > f.occurredAtMs);
      if (later.length) {
        return new AnimalRuleError(
          'OUT_OF_ORDER',
          409,
          `Something is already on record for this animal on ${dayOf(Math.max(...later), loaded.ctx.timeZone)}, after this date, so it was still here then. Date it on or after that record.`
        );
      }
      continue;
    }
    let animalId: string | null = null;
    if (f.kind === 'dose' && f.treatment.subjectType === 'animal') animalId = f.treatment.subjectId;
    else if (f.kind === 'stay' && f.subjectType === 'animal' && w.isNew) animalId = f.subjectId;
    else if (f.kind === 'production' && f.subjectType === 'animal') animalId = f.subjectId;
    if (!animalId) continue;
    const terminal = terminalOf(animalId);
    if (!terminal) continue;
    const late = w.newDates.filter((d) => d > terminal.at);
    if (late.length) {
      return new AnimalRuleError(
        'OUT_OF_ORDER',
        409,
        `This animal is recorded as ${terminal.status.replace(/-/g, ' ')} on ${dayOf(terminal.at, loaded.ctx.timeZone)}. Nothing can be dated after that.`
      );
    }
  }
  return null;
}

function dayOf(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(ms));
}

function areaLabel(key: string): string | null {
  if (key.startsWith('area:')) return getField(key.slice(5))?.name ?? 'This Area';
  if (key.startsWith('block:')) return 'This block';
  return null;
}

// ─── §3 snapshots of new doses and applications ─────────────────────────

function storeHoldParams(p: Prepared, written: readonly Written[], nowMs: number): void {
  const doseParams = readHoldParams('animal-health');
  const appsByRef = new Map<string, HoldFact[]>();
  for (const w of written) {
    if (!w.isNew) continue;
    const f = w.fact;
    if (f.kind === 'dose' && !doseParams.has(f.treatment.id) && !f.treatment.deletion) {
      const pluginId = f.treatment.productPluginId;
      const params: DoseHoldParams = {
        rulesVersion: RULES_VERSION,
        product: pluginId ? (p.plugins(pluginId) ?? null) : null
      };
      writeHoldParams('animal-health', f.treatment.id, JSON.stringify(params));
    }
    if (f.kind === 'application') {
      const list = appsByRef.get(f.application.ref) ?? [];
      list.push(f);
      appsByRef.set(f.application.ref, list);
    }
  }
  for (const [ref, facts] of appsByRef) {
    const source = ref.slice(0, ref.indexOf(':')) as 'spray' | 'insecticide' | 'fungicide';
    const id = ref.slice(ref.indexOf(':') + 1);
    const apps = facts.flatMap((f) => (f.kind === 'application' ? [f.application] : []));
    const params: ApplicationHoldParams = applicationHoldParams(apps, RULES_VERSION, nowMs);
    writeHoldParams(source, id, JSON.stringify(params));
  }
}

// ─── §6 the refusal ─────────────────────────────────────────────────────

const KIND_WORDS: Record<HoldKind, HoldKindWord> = {
  meat: 'meat',
  milk: 'milk',
  eggs: 'eggs',
  preSlaughter: 'preSlaughter',
  graze: 'graze',
  hay: 'hay'
};

function coverageLabel(id: string, loaded: Loaded): string {
  const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  for (const f of loaded.facts) {
    if (kind === 'log' && f.kind === 'production' && f.id === rest) {
      return `${f.food === 'eggs' ? 'Eggs' : 'Milk'} logged ${dayOf(f.occurredAtMs, loaded.ctx.timeZone)}`;
    }
    if (kind === 'meat' && f.kind === 'status' && f.id === rest) {
      return `Meat recorded ${dayOf(f.occurredAtMs, loaded.ctx.timeZone)}`;
    }
    if ((kind === 'hay' || kind === 'harvest') && f.kind === 'hay' && f.id === rest) {
      return `Hay cut ${f.datesMs[0] ? dayOf(f.datesMs[0], loaded.ctx.timeZone) : ''}`.trim();
    }
    if (kind === 'stay' && f.kind === 'stay' && f.id === rest) {
      return `Grazing from ${dayOf(f.fromMs, loaded.ctx.timeZone)}`;
    }
  }
  return 'A saved record';
}

export function diffHashOf(diff: HoldDiff): string {
  return createHash('sha256').update(canonicalDiff(diff)).digest('hex');
}

function describe(diff: HoldDiff, loaded: Loaded): ShortenedHold[] {
  return diff.holds.map((s) => ({
    subject: s.key,
    subjectLabel: loaded.labels.get(s.key) ?? areaLabel(s.key) ?? 'These animals',
    kind: KIND_WORDS[s.kind],
    clearBefore: Number.isFinite(s.clearBefore) ? s.clearBefore : null,
    clearAfter: s.clearAfter !== null && Number.isFinite(s.clearAfter) ? s.clearAfter : null
  }));
}

function shortenRefusal(
  diff: HoldDiff,
  loaded: Loaded,
  opts: {
    todayVersionPasses: boolean;
    canVoid: boolean;
    askOwner: boolean;
    code?: string;
    status?: number;
    message?: string;
  }
): AnimalRuleError {
  const holds = describe(diff, loaded);
  const coverage = diff.coverage.map((c) => ({ id: c.id, label: coverageLabel(c.id, loaded) }));
  const body = {
    holds,
    coverage,
    diffHash: diffHashOf(diff),
    todayVersionPasses: opts.todayVersionPasses,
    canVoid: opts.canVoid,
    askOwner: opts.askOwner
  };
  return new AnimalRuleError(
    opts.code ?? 'HOLD_WOULD_SHORTEN',
    opts.status ?? 409,
    opts.message ?? holdShortenMessage(body, loaded.ctx.timeZone),
    body
  );
}

// ─── The guard ──────────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(readonly error: AnimalRuleError) {
    super(error.message);
  }
}

export interface GuardResult<T> {
  value: T;
  diff: HoldDiff;
}

/**
 * Runs `fn` (synchronous DB writes) inside one transaction with the hold
 * guard around it. Throws `AnimalRuleError` on a refusal, with everything
 * rolled back. `user` is null only for system writes.
 */
export async function guardedHoldWrite<T>(
  event: Pick<RequestEvent, 'locals' | 'request'>,
  user: GuardUser | null,
  fn: () => T,
  opts: GuardOptions = {}
): Promise<T> {
  const timeZone = prefsFor(user?.id).timeZone;
  const prepared = await prepareHoldGuard(timeZone);
  const ownerTier = user
    ? isInteractiveOwner(event, { role: user.role, impersonating: user.impersonating === true })
    : false;
  try {
    return writeRecord(event, () => {
      const nowMs = opts.nowMs ?? Date.now();
      const openUntil = nowMs - NOW_SLACK_MS;
      const before = loadHoldFacts(prepared, nowMs);
      const beforeProjection = projectHolds(before.facts, openUntil, before.ctx);
      const value = fn();
      const after = loadHoldFacts(prepared, nowMs);
      const written = writtenFacts(before.facts, after.facts);
      const dates = dateRefusal(written, nowMs, ownerTier);
      if (dates) throw new Refusal(dates);
      const afterProjection = projectHolds(after.facts, openUntil, after.ctx);
      const order = orderRefusal(after, afterProjection, written, nowMs);
      if (order) throw new Refusal(order);
      const diff = shortenings(beforeProjection, afterProjection, {
        resolvesUnknown: opts.resolvesUnknown === true && ownerTier
      });
      if (!isEmptyDiff(diff)) {
        const refusal = voidOrRefuse(diff, before, user, ownerTier, opts, nowMs);
        if (refusal) throw new Refusal(refusal);
      }
      storeHoldParams(prepared, written, nowMs);
      return value;
    });
  } catch (e) {
    if (e instanceof Refusal) throw e.error;
    throw e;
  }
}

function voidOrRefuse(
  diff: HoldDiff,
  loaded: Loaded,
  user: GuardUser | null,
  ownerTier: boolean,
  opts: GuardOptions,
  nowMs: number
): AnimalRuleError | null {
  const v = opts.void;
  const fresh = v ? nowMs - v.createdAtMs <= LOCK_WINDOW_MS : false;
  const voidable = diffIsVoidable(diff);
  const base = {
    todayVersionPasses: opts.dated === true,
    canVoid: ownerTier && fresh && voidable,
    askOwner: !ownerTier
  };
  if (!v) return shortenRefusal(diff, loaded, base);
  if (!ownerTier) {
    return new AnimalRuleError(
      'OWNER_ONLY',
      403,
      'Only the owner, signed in on their own account, can void an entry that shortens a hold.'
    );
  }
  if (!voidable) {
    return shortenRefusal(diff, loaded, {
      ...base,
      code: 'HOLD_NOT_VOIDABLE',
      status: 403,
      message: DATE_RULE_COPY.HOLD_NOT_VOIDABLE
    });
  }
  if (!fresh) {
    return shortenRefusal(diff, loaded, {
      ...base,
      code: 'VOID_TOO_LATE',
      status: 409,
      message: DATE_RULE_COPY.VOID_TOO_LATE
    });
  }
  const hash = diffHashOf(diff);
  if (!v.confirmShorten) return shortenRefusal(diff, loaded, base);
  if (v.confirmShorten !== hash) {
    return shortenRefusal(diff, loaded, {
      ...base,
      code: 'HOLD_DIFF_STALE',
      status: 409,
      message: DATE_RULE_COPY.HOLD_DIFF_STALE
    });
  }
  insertHoldCorrection({
    recordKind: v.recordKind,
    recordId: v.recordId,
    userId: user?.id ?? null,
    reason: v.reason,
    diffJson: canonicalDiff(diff),
    diffHash: hash,
    createdAt: nowMs
  });
  return null;
}

/** For tests and the perf budget: one projection of the active farm. */
export async function projectActiveFarm(timeZone: string, nowMs = Date.now()) {
  const prepared = await prepareHoldGuard(timeZone);
  const loaded = loadHoldFacts(prepared, nowMs);
  return { loaded, projection: projectHolds(loaded.facts, nowMs, loaded.ctx) };
}

export type Guarded<T> = { ok: true; value: T } | { ok: false; response: Response };

/** `guardedHoldWrite` for endpoints that answer a refusal directly. */
export async function tryGuardedHoldWrite<T>(
  event: Pick<RequestEvent, 'locals' | 'request'>,
  user: GuardUser | null,
  fn: () => T,
  opts: GuardOptions = {}
): Promise<Guarded<T>> {
  try {
    return { ok: true, value: await guardedHoldWrite(event, user, fn, opts) };
  } catch (e) {
    if (e instanceof AnimalRuleError) return { ok: false, response: e.toResponse() };
    throw e;
  }
}
