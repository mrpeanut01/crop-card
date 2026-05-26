/**
 * Phase 25 Sprint 2 (#155-162, #195) — unified records ledger loader.
 *
 * The Almanac /records design treats every event kind as a row in one
 * audit-trail ledger: spray, insecticide, fungicide, scout, harvest,
 * fertility, planting, decon. Each kind has its own table but the
 * displayed row shape is uniform. This loader is the single point that
 * joins them.
 *
 * Tenant isolation is preserved because every underlying repo funnels
 * through `tenantWhere`. We never SELECT cross-table here — instead we
 * stitch sorted lists from each kind, then merge-sort on `occurredAt`.
 *
 * The display `hash` is a 6-hex content digest, NOT the FR-09 hash chain
 * (which is future work — see CLAUDE.md follow-ups). It's intended to let
 * an inspector spot-check that two views of the same row carry the same
 * payload, and to give the audit table a stable per-row fingerprint.
 */

import { createHash } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { db } from './client';
import { equipment, equipmentLog, users } from './schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { withTenant } from './tenant';
import { listSprayEvents, evaluateLock as evaluateSprayLock } from './sprayEvents';
import { listInsecticideEvents } from './insecticideEvents';
import { listFungicideEvents } from './fungicideEvents';
import { listScoutObservations } from './scoutObservations';
import { listHarvestEvents } from './harvestEvents';
import { listBlocks } from './blocks';
import { fertilityApplications } from './schema';
import type { FertilityApplication } from './fertility';

// Pure constants live in recordKinds.ts so Svelte components can import
// them without dragging this file's server-only transitive imports
// (sprayEvents → server/superadmin) into the client bundle.
export {
  KIND_LABEL,
  KIND_TONE,
  LOCK_WINDOW_MS,
  RECORD_KINDS,
  type RecordKind
} from './recordKinds';
import { LOCK_WINDOW_MS, RECORD_KINDS, type RecordKind } from './recordKinds';

export interface UnifiedRecord {
  /** Composite id: `${kind}:${rowId}` so it stays unique when one table has the same uuid as another (cannot happen in practice but keeps drill-down URLs unambiguous). */
  id: string;
  kind: RecordKind;
  /** The underlying row id within its kind's table. */
  rowId: string;
  occurredAt: number;
  blockId?: string;
  blockLabel?: string;
  cropPluginId?: string;
  performedById?: string;
  performerLabel?: string;
  /** One-line operator-readable summary. */
  detail: string;
  /** 6-hex content digest for the displayed row (not the FR-09 hash chain). */
  hash: string;
  /** True when the record is past its 48-hour edit window (or has been hard-locked). */
  locked: boolean;
  lockedAt?: number;
  /** Surfaced for the rates-overridden indicator on spray events. */
  customRateOverride?: boolean;
}

export interface UnifiedFilters {
  kinds?: RecordKind[];
  blockId?: string;
  fromMs?: number;
  toMs?: number;
  /** Soft cap on rows per kind before merge. */
  perKindLimit?: number;
}

function shortHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 6);
}

function isLocked(occurredAt: number, lockedAt: number | undefined, now: number): boolean {
  if (lockedAt) return true;
  return now - occurredAt >= LOCK_WINDOW_MS;
}

function resolvePerformers(ids: string[]): Map<string, string> {
  const unique = Array.from(new Set(ids.filter((s): s is string => Boolean(s))));
  if (unique.length === 0) return new Map();
  const rows = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, unique))
    .all();
  // No tenant filter — users table is global identity. Show the full
  // email; the audit ledger is for inspectors + owner-role users who
  // already know the operators on the farm, and the local-part alone is
  // ambiguous when helpers share first names.
  return new Map(rows.map((r) => [r.id, r.email]));
}

interface DeconEvent {
  id: string;
  occurredAt: number;
  equipmentId: string;
  equipmentLabel: string;
  performedById?: string;
  notes?: string;
}

function listDeconEvents(filters: {
  fromMs?: number;
  toMs?: number;
  limit?: number;
}): DeconEvent[] {
  const conds = [eq(equipmentLog.kind, 'decon')];
  if (filters.fromMs !== undefined)
    conds.push(gte(equipmentLog.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined) conds.push(lte(equipmentLog.occurredAt, new Date(filters.toMs)));
  let q = db
    .select({
      id: equipmentLog.id,
      occurredAt: equipmentLog.occurredAt,
      equipmentId: equipmentLog.equipmentId,
      performedById: equipmentLog.performedById,
      notes: equipmentLog.notes,
      equipmentLabel: equipment.label
    })
    .from(equipmentLog)
    .leftJoin(equipment, eq(equipment.id, equipmentLog.equipmentId))
    .where(withTenant(equipmentLog, and(...conds)))
    .$dynamic();
  q = q.orderBy(desc(equipmentLog.occurredAt));
  if (filters.limit) q = q.limit(filters.limit);
  return q.all().map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt.getTime(),
    equipmentId: row.equipmentId,
    equipmentLabel: row.equipmentLabel ?? row.equipmentId,
    performedById: row.performedById ?? undefined,
    notes: row.notes ?? undefined
  }));
}

interface PlantingRow {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number;
}

function listPlantingRecords(filters: {
  blockId?: string;
  fromMs?: number;
  toMs?: number;
}): PlantingRow[] {
  // Plantings live on `crops`. Surface every planting whose `plantingDate`
  // falls in the window; treat plantingDate as the event timestamp.
  const all = listBlocks();
  const rows: PlantingRow[] = [];
  for (const b of all) {
    if (filters.blockId && b.id !== filters.blockId) continue;
    for (const p of b.plantings) {
      if (p.plantingDate == null) continue;
      if (filters.fromMs !== undefined && p.plantingDate < filters.fromMs) continue;
      if (filters.toMs !== undefined && p.plantingDate > filters.toMs) continue;
      rows.push({
        id: p.id,
        blockId: p.blockId,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        plantingDate: p.plantingDate
      });
    }
  }
  return rows.sort((a, b) => b.plantingDate - a.plantingDate);
}

function listFertilityApplicationsAll(filters: {
  blockId?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}): FertilityApplication[] {
  const conds = [];
  if (filters.blockId) conds.push(eq(fertilityApplications.blockId, filters.blockId));
  if (filters.fromMs !== undefined)
    conds.push(gte(fertilityApplications.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined)
    conds.push(lte(fertilityApplications.occurredAt, new Date(filters.toMs)));
  let q = db
    .select()
    .from(fertilityApplications)
    .where(withTenant(fertilityApplications, conds.length ? and(...conds) : undefined))
    .$dynamic();
  q = q.orderBy(desc(fertilityApplications.occurredAt));
  if (filters.limit) q = q.limit(filters.limit);
  return q.all().map((row) => ({
    id: row.id,
    blockId: row.blockId,
    cropId: row.cropId ?? undefined,
    occurredAt: row.occurredAt.getTime(),
    source: row.source,
    stockItemId: row.stockItemId ?? undefined,
    ratePerAcre: row.ratePerAcreHundredths / 100,
    rateUnit: row.rateUnit,
    nLbPerAcre: row.nDeliveredHundredths / 100,
    pLbPerAcre: row.pDeliveredHundredths / 100,
    kLbPerAcre: row.kDeliveredHundredths / 100,
    performedById: row.performedById ?? undefined,
    notes: row.notes ?? undefined
  }));
}

export function listUnifiedRecords(filters: UnifiedFilters = {}): UnifiedRecord[] {
  const now = Date.now();
  const kinds = new Set<RecordKind>(filters.kinds ?? RECORD_KINDS);
  const perKindLimit = filters.perKindLimit ?? 500;
  const out: UnifiedRecord[] = [];

  const blockLabelById = new Map(listBlocks().map((b) => [b.id, b.blockLabel ?? b.name]));
  const performerIds: string[] = [];

  if (kinds.has('spray')) {
    const events = listSprayEvents({
      blockId: filters.blockId,
      fromMs: filters.fromMs,
      toMs: filters.toMs,
      limit: perKindLimit
    });
    for (const e of events) {
      performerIds.push(e.performedById);
      const products = e.products.map((p) => p.pluginId).join(', ');
      out.push({
        id: `spray:${e.id}`,
        kind: 'spray',
        rowId: e.id,
        occurredAt: e.occurredAt,
        blockId: e.blockId,
        blockLabel: blockLabelById.get(e.blockId),
        performedById: e.performedById,
        detail: products
          ? `${products} · ${e.conditions.windMph}mph / ${e.conditions.tempF}°F`
          : 'spray event',
        hash: shortHash({
          k: 'spray',
          id: e.id,
          o: e.occurredAt,
          p: e.products,
          r: e.rulesVersion
        }),
        locked: isLocked(e.occurredAt, e.lockedAt, now),
        lockedAt:
          e.lockedAt ?? (isLocked(e.occurredAt, undefined, now) ? evaluateSprayLock(e) : undefined),
        customRateOverride: e.customRateOverride
      });
    }
  }

  if (kinds.has('insecticide')) {
    const events = listInsecticideEvents({
      blockId: filters.blockId,
      fromMs: filters.fromMs,
      toMs: filters.toMs,
      limit: perKindLimit
    });
    for (const e of events) {
      performerIds.push(e.performedById);
      const products = e.products.map((p) => p.displayName ?? p.pluginId).join(', ');
      out.push({
        id: `insecticide:${e.id}`,
        kind: 'insecticide',
        rowId: e.id,
        occurredAt: e.occurredAt,
        blockId: e.blockId,
        blockLabel: blockLabelById.get(e.blockId),
        performedById: e.performedById,
        detail: e.scoutObservation
          ? `${products} · ${e.scoutObservation.pest} ${e.scoutObservation.metric}=${e.scoutObservation.value}`
          : products || 'insecticide event',
        hash: shortHash({ k: 'insecticide', id: e.id, o: e.occurredAt, p: e.products }),
        locked: isLocked(e.occurredAt, e.lockedAt, now),
        lockedAt: e.lockedAt
      });
    }
  }

  if (kinds.has('fungicide')) {
    const events = listFungicideEvents({
      blockId: filters.blockId,
      fromMs: filters.fromMs,
      toMs: filters.toMs,
      limit: perKindLimit
    });
    for (const e of events) {
      performerIds.push(e.performedById);
      const products = e.products.map((p) => p.displayName ?? p.pluginId).join(', ');
      out.push({
        id: `fungicide:${e.id}`,
        kind: 'fungicide',
        rowId: e.id,
        occurredAt: e.occurredAt,
        blockId: e.blockId,
        blockLabel: blockLabelById.get(e.blockId),
        performedById: e.performedById,
        detail: e.diseaseObservation
          ? `${products} · ${e.diseaseObservation.disease} ${e.diseaseObservation.metric}=${e.diseaseObservation.value}`
          : products || 'fungicide event',
        hash: shortHash({ k: 'fungicide', id: e.id, o: e.occurredAt, p: e.products }),
        locked: isLocked(e.occurredAt, e.lockedAt, now),
        lockedAt: e.lockedAt
      });
    }
  }

  if (kinds.has('scout')) {
    const events = listScoutObservations({
      blockId: filters.blockId,
      fromMs: filters.fromMs,
      limit: perKindLimit
    });
    for (const e of events) {
      performerIds.push(e.performedById);
      out.push({
        id: `scout:${e.id}`,
        kind: 'scout',
        rowId: e.id,
        occurredAt: e.occurredAt,
        blockId: e.blockId,
        blockLabel: blockLabelById.get(e.blockId),
        performedById: e.performedById,
        detail: `${e.pest} · ${e.metric}=${e.value}`,
        hash: shortHash({ k: 'scout', id: e.id, o: e.occurredAt, pest: e.pest, v: e.value }),
        // Scout observations are not subject to the FR-09 lock window — but the audit ledger still shows lock state, so we mark them locked once outside the 48h grace period for consistency.
        locked: isLocked(e.occurredAt, undefined, now)
      });
    }
  }

  if (kinds.has('harvest')) {
    const events = listHarvestEvents({
      blockId: filters.blockId,
      fromMs: filters.fromMs,
      toMs: filters.toMs
    });
    for (const e of events.slice(0, perKindLimit)) {
      out.push({
        id: `harvest:${e.id}`,
        kind: 'harvest',
        rowId: e.id,
        occurredAt: e.occurredAt,
        blockId: e.blockId,
        blockLabel: blockLabelById.get(e.blockId),
        cropPluginId: e.cropPluginId,
        detail: e.quantity
          ? `${e.cropPluginId} · ${e.quantity}${e.lotNumber ? ` · lot ${e.lotNumber}` : ''}`
          : e.cropPluginId,
        hash: shortHash({ k: 'harvest', id: e.id, o: e.occurredAt, q: e.quantity }),
        locked: isLocked(e.occurredAt, undefined, now)
      });
    }
  }

  if (kinds.has('fertility')) {
    const events = listFertilityApplicationsAll({
      blockId: filters.blockId,
      fromMs: filters.fromMs,
      toMs: filters.toMs,
      limit: perKindLimit
    });
    for (const e of events) {
      if (e.performedById) performerIds.push(e.performedById);
      const npk = [
        e.nLbPerAcre ? `N ${e.nLbPerAcre.toFixed(0)}` : null,
        e.pLbPerAcre ? `P ${e.pLbPerAcre.toFixed(0)}` : null,
        e.kLbPerAcre ? `K ${e.kLbPerAcre.toFixed(0)}` : null
      ]
        .filter(Boolean)
        .join(' / ');
      out.push({
        id: `fertility:${e.id}`,
        kind: 'fertility',
        rowId: e.id,
        occurredAt: e.occurredAt,
        blockId: e.blockId,
        blockLabel: blockLabelById.get(e.blockId),
        performedById: e.performedById,
        detail: `${e.source} · ${e.ratePerAcre} ${e.rateUnit}${npk ? ` · ${npk}` : ''}`,
        hash: shortHash({ k: 'fertility', id: e.id, o: e.occurredAt, npk }),
        locked: isLocked(e.occurredAt, undefined, now)
      });
    }
  }

  if (kinds.has('planting')) {
    const rows = listPlantingRecords({
      blockId: filters.blockId,
      fromMs: filters.fromMs,
      toMs: filters.toMs
    });
    for (const p of rows.slice(0, perKindLimit)) {
      out.push({
        id: `planting:${p.id}`,
        kind: 'planting',
        rowId: p.id,
        occurredAt: p.plantingDate,
        blockId: p.blockId,
        blockLabel: blockLabelById.get(p.blockId),
        cropPluginId: p.cropPluginId,
        detail: `${p.varietyDisplayName} (${p.cropPluginId})`,
        hash: shortHash({ k: 'planting', id: p.id, o: p.plantingDate, c: p.cropPluginId }),
        locked: isLocked(p.plantingDate, undefined, now)
      });
    }
  }

  if (kinds.has('decon')) {
    const events = listDeconEvents({
      fromMs: filters.fromMs,
      toMs: filters.toMs,
      limit: perKindLimit
    });
    for (const e of events) {
      if (e.performedById) performerIds.push(e.performedById);
      out.push({
        id: `decon:${e.id}`,
        kind: 'decon',
        rowId: e.id,
        occurredAt: e.occurredAt,
        performedById: e.performedById,
        detail: `${e.equipmentLabel}${e.notes ? ` · ${e.notes.slice(0, 80)}` : ''}`,
        hash: shortHash({ k: 'decon', id: e.id, o: e.occurredAt }),
        locked: isLocked(e.occurredAt, undefined, now)
      });
    }
  }

  // Performer labels — single batched lookup across every kind we touched.
  const labelByUserId = resolvePerformers(performerIds);
  for (const r of out) {
    if (r.performedById) r.performerLabel = labelByUserId.get(r.performedById);
  }

  out.sort((a, b) => b.occurredAt - a.occurredAt);
  return out;
}

export interface UnifiedRecordSummary {
  total: number;
  locked: number;
  ytd: number;
  oldestMs: number | null;
  /** Retention horizon = the latest occurredAt + 2 years (NFR-05). */
  retentionUntilMs: number | null;
  /** Per-kind row counts for the filter chip badges. */
  countsByKind: Record<RecordKind, number>;
}

export function summarizeUnifiedRecords(rows: UnifiedRecord[]): UnifiedRecordSummary {
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const countsByKind = Object.fromEntries(RECORD_KINDS.map((k) => [k, 0])) as Record<
    RecordKind,
    number
  >;
  let locked = 0;
  let ytd = 0;
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const r of rows) {
    countsByKind[r.kind] += 1;
    if (r.locked) locked += 1;
    if (r.occurredAt >= yearStart) ytd += 1;
    if (oldest === null || r.occurredAt < oldest) oldest = r.occurredAt;
    if (newest === null || r.occurredAt > newest) newest = r.occurredAt;
  }
  const retentionMs = 2 * 365 * 24 * 60 * 60 * 1000;
  return {
    total: rows.length,
    locked,
    ytd,
    oldestMs: oldest,
    retentionUntilMs: newest === null ? null : newest + retentionMs,
    countsByKind
  };
}
