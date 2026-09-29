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
 * check and the write. The plugin view and the farm's zone are loaded before
 * the transaction and rechecked inside it (`currentPrepared`). New doses and applications get their hold
 * parameters stored here (`hold_params_json`), so a later data change can
 * only lengthen their holds.
 */

import { createHash } from 'node:crypto';
import { inArray, isNull, like } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { insertHoldCorrection } from '$lib/db/holdCorrections';
import { db } from '$lib/db/client';
import {
  animalHealthEvents,
  fungicideEvents,
  insecticideEvents,
  recordDeletions,
  sprayEvents
} from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, unscopedQueryNote } from '$lib/db/tenant';
import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { listAllLocations } from '$lib/db/animalLocations';
import { listAllHealthEvents, listAllHealthTombstones } from '$lib/db/animalHealth';
import { listAllProductionLogs, listDeletedProductionLogs } from '$lib/db/animalProduction';
import { listAllStatusEvents, listUndoneStatusEvents } from '$lib/db/animalStatus';
import { listAllCuttings } from '$lib/db/hayCuttings';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listBlocks } from '$lib/db/blocks';
import { getField, listGrazingAreaIds } from '$lib/db/fields';
import {
  extendDoseHoldParams,
  readHoldParams,
  tombstoneNeedsHoldParams,
  writeHoldParams
} from '$lib/db/holdParams';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { farmTimeZone, farmZoneSource, farmsOwnedBy, prefsFor } from '$lib/db/userProfile';
import { MAX_FUTURE_SKEW_MS, isOutcomeStatus } from '$lib/animals/model';
import {
  DATE_RULE_COPY,
  crossingHoldMessage,
  holdShortenMessage,
  type HoldKindWord,
  type ShortenedHold
} from '$lib/animals/holdGuardCopy';
import { parseExposureFloor } from '$lib/safety/grazingExposure';
import type { GrazingApplication } from '$lib/safety/grazingInterval';
import {
  parseWithdrawalEntries,
  productEntryPluginIds,
  type AnimalHealthProductData,
  type PluginLookup,
  type TreatmentRecord
} from '$lib/safety/animalWithdrawal';
import {
  HOLD_FACT_KINDS,
  canonicalDiff,
  diffIsVoidable,
  heldAt,
  holdMapKey,
  hayKeysOfBlock,
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
import {
  getBaseRegistry,
  getDataKinds,
  getRegistry,
  baseRegistryGeneration,
  ownerOverlayRevision,
  ownerRegistryNow
} from './registry';
import {
  healthPlugins,
  toTreatment,
  declaresMeat,
  parseDoseHoldParams,
  type DoseHoldParams
} from './animalRecords';
import {
  applicationHoldParams,
  grazingContextFrom,
  farmRegistryMaxDays,
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

/** What a helper that writes hold facts needs to run the guard itself. */
export interface HoldWriteContext {
  event: Pick<RequestEvent, 'locals' | 'request'>;
  user: GuardUser | null;
}

export interface HoldVoid {
  recordKind: string;
  recordId: string;
  /** Server-set `created_at` of the record being voided; null for an
   *  application saved before C-35, which can never be voided (§5). */
  createdAtMs: number | null;
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
  /** The write changes the farm's plugin copies: project the holds after
   *  it with the plugin view rebuilt from the overrides it wrote. */
  reloadRegistry?: boolean;
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
  /** The Owner's overlay revision read before `registry` was loaded. */
  overlayRevision: number;
  /** The shared library load `base` came from; null when it changed while
   *  preparing. */
  baseGeneration: number | null;
}

/** Verdicts keyed by treatment, plugin data and zone (see `projectHolds`).
 *  Tenant-neutral: a key holds the treatment itself, so nothing is shared
 *  between farms that is not already in the key. */
const VERDICTS: NonNullable<ProjectionContext['verdictCache']> = new Map();
const MAX_CACHED_VERDICTS = 50_000;

export async function prepareHoldGuard(timeZone: string): Promise<Prepared> {
  const overlayRevision = ownerOverlayRevision();
  const generationBefore = baseRegistryGeneration();
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
    timeZone,
    overlayRevision,
    baseGeneration: generationBefore === baseRegistryGeneration() ? generationBefore : null
  };
}

/**
 * Review round 8: the registry and zone are read before the transaction, so
 * another write can change them while the guard awaits. Inside the
 * transaction this rereads the farm's zone and, when the Owner's plugin
 * overlay moved on, rebuilds its view from the overrides on file, so the
 * before projection is the state the write actually lands on. Null when
 * the shared library itself was reloaded meanwhile: the caller prepares
 * again.
 */
function currentPrepared(p: Prepared): Prepared | null {
  if (p.baseGeneration === null || baseRegistryGeneration() !== p.baseGeneration) return null;
  const overlayRevision = ownerOverlayRevision();
  const timeZone = farmTimeZone();
  if (overlayRevision === p.overlayRevision && timeZone === p.timeZone) return p;
  return {
    ...p,
    timeZone,
    overlayRevision,
    registry: overlayRevision === p.overlayRevision ? p.registry : ownerRegistryNow(p.base)
  };
}

class StalePrepared extends Error {}
const MAX_PREPARE_ATTEMPTS = 3;

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
  const grazingAreas = listGrazingAreaIds();
  const liveBlocks = new Set<string>();
  for (const b of listBlocks({ plantings: 'none' })) {
    const fieldId = b.fieldId ?? null;
    liveBlocks.add(b.id);
    facts.push({
      kind: 'block-assignment',
      blockId: b.id,
      fieldId,
      areaGrazeable: fieldId ? grazingAreas.has(fieldId) : true
    });
  }
  // A deleted block's ground stays in its Area: its applications keep
  // counting there, so the ledger places the block where it was.
  for (const a of grazing.applications) {
    if (!a.formerFieldId || liveBlocks.has(a.blockId)) continue;
    liveBlocks.add(a.blockId);
    facts.push({
      kind: 'block-assignment',
      blockId: a.blockId,
      fieldId: a.formerFieldId,
      areaGrazeable: grazingAreas.has(a.formerFieldId)
    });
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
      declaresNow: !deleted && (l.use === 'food' || l.use === 'sale'),
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
  /** A declaration that is live now; a change into it is rechecked. */
  declaresNow?: boolean;
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
        declaresNow: f.declaresNow,
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
  const signature = (d: Dated) => `${[...d.kinds].sort().join(',')}|${d.declaresNow === true}`;
  const prior = new Map<string, { dates: number[]; kinds: string }>();
  for (const f of before) {
    const d = dated(f);
    if (!d) continue;
    const seen = prior.get(d.id);
    prior.set(d.id, {
      dates: [...(seen?.dates ?? []), ...d.dates],
      kinds: signature(d)
    });
  }
  const out: Written[] = [];
  for (const f of after) {
    const d = dated(f);
    if (!d) continue;
    const old = prior.get(d.id);
    // A record that becomes a declaration (eggs logged as discarded, then
    // changed to food, or changed back to food after a discard) is checked
    // at every date it carries, like a new one.
    const becameDeclaration =
      old !== undefined &&
      old.kinds !== signature(d) &&
      d.kinds.some(isDeclaration) &&
      d.declaresNow !== false;
    const newDates = becameDeclaration
      ? [...d.dates]
      : d.dates.filter((ms) => !old || !old.dates.includes(ms));
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
    return hayKeysOfBlock(fieldOfBlock.get(f.blockId), f.blockId).map((k) => holdMapKey(k, 'hay'));
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

function snapshotWriters(p: Prepared) {
  const doseParams = readHoldParams('animal-health');
  const appParams = new Set<string>();
  for (const source of ['spray', 'insecticide', 'fungicide'] as const) {
    for (const id of readHoldParams(source).keys()) appParams.add(`${source}:${id}`);
  }
  let written = 0;
  const productSnapshots = (ids: readonly string[]) => {
    const out: Record<string, AnimalHealthProductData | null> = {};
    for (const id of ids) out[id] = p.plugins(id) ?? null;
    return out;
  };
  const doseSnapshot = (t: TreatmentRecord) => {
    if (t.deletion) return;
    const entryIds = productEntryPluginIds(t);
    const stored = doseParams.get(t.id);
    if (stored === undefined) {
      const pluginId = t.productPluginId;
      const params: DoseHoldParams = {
        rulesVersion: RULES_VERSION,
        product: pluginId ? (p.plugins(pluginId) ?? null) : null
      };
      if (entryIds.length > 0) params.products = productSnapshots(entryIds);
      const json = JSON.stringify(params);
      writeHoldParams('animal-health', t.id, json);
      doseParams.set(t.id, json);
      written++;
      return;
    }
    const parsed = parseDoseHoldParams(stored);
    if (!parsed) return;
    const have = parsed.products ?? {};
    const missing = entryIds.filter((id) => !Object.prototype.hasOwnProperty.call(have, id));
    if (missing.length === 0) return;
    const json = JSON.stringify({
      ...parsed,
      products: { ...productSnapshots(missing), ...have }
    });
    extendDoseHoldParams(t.id, json);
    doseParams.set(t.id, json);
    written++;
  };
  const registryMax = farmRegistryMaxDays(p.registry, p.base);
  const appSnapshots = (facts: readonly HoldFact[], recordedAtMs: number | null) => {
    const byRef = new Map<string, GrazingApplication[]>();
    for (const f of facts) {
      if (f.kind !== 'application' || appParams.has(f.application.ref)) continue;
      const list = byRef.get(f.application.ref) ?? [];
      list.push(f.application);
      byRef.set(f.application.ref, list);
    }
    for (const [ref, apps] of byRef) {
      const source = ref.slice(0, ref.indexOf(':')) as 'spray' | 'insecticide' | 'fungicide';
      const id = ref.slice(ref.indexOf(':') + 1);
      const params: ApplicationHoldParams = applicationHoldParams(
        apps,
        RULES_VERSION,
        recordedAtMs,
        registryMax
      );
      writeHoldParams(source, id, JSON.stringify(params));
      appParams.add(ref);
      written++;
    }
  };
  /** Records saved before C-35 get the data on file now as their floor,
   *  with no save time (so they can never be voided). */
  const floorFor = (facts: readonly HoldFact[]) => {
    for (const f of facts) if (f.kind === 'dose') doseSnapshot(f.treatment);
    appSnapshots(facts, null);
  };
  return { doseSnapshot, appSnapshots, floorFor, count: () => written };
}

function storeHoldParams(
  p: Prepared,
  written: readonly Written[],
  before: readonly HoldFact[],
  after: readonly HoldFact[],
  nowMs: number
): void {
  const w = snapshotWriters(p);
  for (const f of after) if (f.kind === 'dose') w.doseSnapshot(f.treatment);
  w.appSnapshots(
    written.filter((x) => x.isNew).map((x) => x.fact),
    nowMs
  );
  w.floorFor(before);
}

/**
 * C-35 §2: gives every dose and application of the active farm that has no
 * hold-parameter snapshot yet (records saved before C-35) one from the data
 * on file now. Run before any change to the shared plugin library, so a
 * shared change can only lengthen those records' holds, like a farm copy.
 * Returns how many snapshots it wrote.
 */
export async function backfillHoldParams(nowMs = Date.now()): Promise<number> {
  const prepared = await prepareHoldGuard(farmTimeZone());
  return db.transaction(() => {
    const w = snapshotWriters(prepared);
    w.floorFor(loadHoldFacts(prepared, nowMs).facts);
    return w.count();
  });
}

/** Every farm that still has a record with no hold-parameter snapshot. */
function farmsMissingHoldParams(): string[] {
  unscopedQueryNote(
    'a shared plugin change affects every farm, so the snapshot backfill finds them all'
  );
  const ids = new Set<string>();
  for (const t of [sprayEvents, insecticideEvents, fungicideEvents, animalHealthEvents]) {
    for (const r of db
      .selectDistinct({ ownerId: t.ownerId })
      .from(t)
      .where(isNull(t.holdParamsJson))
      .all()) {
      ids.add(r.ownerId);
    }
  }
  for (const r of db
    .select({
      ownerId: animalHealthEvents.ownerId,
      json: animalHealthEvents.holdParamsJson,
      entries: animalHealthEvents.vetDirectedWithdrawal
    })
    .from(animalHealthEvents)
    .where(like(animalHealthEvents.vetDirectedWithdrawal, '%"product"%'))
    .all()) {
    if (!ids.has(r.ownerId) && entrySnapshotMissing(r.json, r.entries)) ids.add(r.ownerId);
  }
  for (const r of db
    .select({ ownerId: recordDeletions.ownerId, json: recordDeletions.snapshotJson })
    .from(recordDeletions)
    .where(inArray(recordDeletions.recordKind, ['spray', 'insecticide', 'fungicide']))
    .all()) {
    if (!ids.has(r.ownerId) && tombstoneNeedsHoldParams(r.json)) ids.add(r.ownerId);
  }
  return [...ids];
}

/** Whether a dose names a product in an owner entry whose label data has
 *  no snapshot yet. */
function entrySnapshotMissing(json: string | null, entries: string | null): boolean {
  const parsed = parseWithdrawalEntries(entries);
  if (parsed === 'invalid') return false;
  const have = parseDoseHoldParams(json)?.products ?? {};
  return parsed.some(
    (e) => e.kind === 'product' && !Object.prototype.hasOwnProperty.call(have, e.pluginId)
  );
}

/** `backfillHoldParams` on every farm that needs it. */
export async function backfillHoldParamsEverywhere(nowMs = Date.now()): Promise<number> {
  let total = 0;
  for (const ownerId of farmsMissingHoldParams()) {
    total += await runWithTenantAsync(ownerId, () => backfillHoldParams(nowMs));
  }
  return total;
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
  const fieldOf = new Map<string, string | null>();
  for (const f of loaded.facts)
    if (f.kind === 'block-assignment') fieldOf.set(f.blockId, f.fieldId);
  const areaHay = new Set(diff.holds.filter((s) => s.kind === 'hay').map((s) => s.key));
  // A block's own hay hold is shown through its Area's when both go.
  const shown = diff.holds.filter((s) => {
    if (s.kind !== 'hay' || !s.key.startsWith('block:')) return true;
    const fieldId = fieldOf.get(s.key.slice(6));
    return !(fieldId && areaHay.has(`area:${fieldId}`));
  });
  return shown.map((s) => ({
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
  const ownerTier = user
    ? isInteractiveOwner(event, { role: user.role, impersonating: user.impersonating === true })
    : false;
  for (let attempt = 1; ; attempt++) {
    const prepared = await prepareHoldGuard(farmTimeZone());
    try {
      return writeRecord(event, () => {
        const current = currentPrepared(prepared);
        if (!current) throw new StalePrepared();
        const nowMs = opts.nowMs ?? Date.now();
        const openUntil = nowMs - NOW_SLACK_MS;
        const before = loadHoldFacts(current, nowMs);
        const beforeProjection = projectHolds(before.facts, openUntil, before.ctx);
        const value = fn();
        if (value && typeof (value as { then?: unknown }).then === 'function') {
          throw new Error('guardedHoldWrite: the write must be synchronous');
        }
        const afterPrepared = opts.reloadRegistry
          ? { ...current, registry: ownerRegistryNow(current.base) }
          : current;
        const after = loadHoldFacts(afterPrepared, nowMs);
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
        storeHoldParams(current, written, before.facts, after.facts, nowMs);
        return value;
      });
    } catch (e) {
      if (e instanceof Refusal) throw e.error;
      if (e instanceof StalePrepared) {
        if (attempt < MAX_PREPARE_ATTEMPTS) continue;
        throw new AnimalRuleError(
          'PLUGINS_RELOADING',
          503,
          'The plugin library was just updated. Try saving again.'
        );
      }
      throw e;
    }
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
  const fresh = v && v.createdAtMs !== null ? nowMs - v.createdAtMs <= LOCK_WINDOW_MS : false;
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

/** For tests: the projection the guard compares, closing open facts at
 *  `nowMs - NOW_SLACK_MS` exactly as a guarded write started at `nowMs`. */
export async function projectAsGuard(timeZone: string, nowMs: number) {
  const prepared = await prepareHoldGuard(timeZone);
  const loaded = loadHoldFacts(prepared, nowMs);
  return projectHolds(loaded.facts, nowMs - NOW_SLACK_MS, loaded.ctx);
}

/**
 * C-35: whether moving the active farm's hold time zone from `fromZone` to
 * `toZone` would take away any held time a record can still be dated into,
 * or drop a record from a hold that covers it (§2). Holds are rounded up to
 * the farm's local midnight, so a zone further east ends them earlier; a
 * hold that ended in the past still counts while a write can be backdated
 * into the freed hours (`OTHER_LOOKBACK_MS` reaches furthest). The owner's
 * zone change is refused then.
 */
export async function zoneChangeShortensHolds(
  fromZone: string,
  toZone: string,
  nowMs = Date.now()
): Promise<boolean> {
  if (fromZone === toZone) return false;
  return zoneChangeShortensPrepared(await prepareZoneChange(fromZone, toZone), nowMs);
}

export interface PreparedZoneChange {
  from: Prepared;
  to: Prepared;
}

/** The async half of a zone-change check (plugin registries, per farm). */
export async function prepareZoneChange(
  fromZone: string,
  toZone: string
): Promise<PreparedZoneChange> {
  return { from: await prepareHoldGuard(fromZone), to: await prepareHoldGuard(toZone) };
}

/** The synchronous half: reads the active farm's hold facts now, so it can
 *  run inside the same transaction as the zone update (review round 5). */
export function zoneChangeShortensPrepared(p: PreparedZoneChange, nowMs = Date.now()): boolean {
  if (p.from.timeZone === p.to.timeZone) return false;
  const project = (prepared: Prepared) => {
    const loaded = loadHoldFacts(prepared, nowMs);
    return projectHolds(loaded.facts, nowMs - NOW_SLACK_MS, loaded.ctx);
  };
  const before = project(p.from);
  const after = project(p.to);
  const diff = shortenings(before, after);
  if (diff.coverage.length > 0) return true;
  const reach = nowMs - OTHER_LOOKBACK_MS - DAY_MS;
  return diff.holds.some((h) => h.lost.some((l) => l.toMs > reach));
}

export type OwnerZoneChange = 'saved' | 'shortens' | 'stale';

/**
 * C-35: saves an account's new time zone only if, on every farm the account
 * is the hold clock for, it takes no held time away. Registries are loaded
 * first; the checks and the update then run in one synchronous transaction,
 * so no hold written while the check was loading can slip past it (review
 * round 5). `stale` when the saved zone or the owned farms changed meanwhile.
 */
export async function changeOwnerZone(
  userId: string,
  fromZone: string,
  toZone: string,
  save: () => void,
  nowMs = Date.now()
): Promise<OwnerZoneChange> {
  const farms = fromZone === toZone ? [] : farmsOwnedBy(userId);
  const prepared = new Map<string, PreparedZoneChange>();
  for (const farmId of farms) {
    prepared.set(
      farmId,
      await runWithTenantAsync(farmId, () => prepareZoneChange(fromZone, toZone))
    );
  }
  return db.transaction((): OwnerZoneChange => {
    if (prefsFor(userId).timeZone !== fromZone) return 'stale';
    const now = fromZone === toZone ? [] : farmsOwnedBy(userId);
    for (const farmId of now) {
      const p = prepared.get(farmId);
      if (!p) return 'stale';
      const shortens = runWithTenant(
        farmId,
        () => farmZoneSource()?.userId === userId && zoneChangeShortensPrepared(p, nowMs)
      );
      if (shortens) return 'shortens';
    }
    save();
    return 'saved';
  });
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
