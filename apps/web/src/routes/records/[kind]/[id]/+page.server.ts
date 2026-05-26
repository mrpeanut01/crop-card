/**
 * Sprint 2 (#160, #195) — drill-down detail page for any record kind.
 *
 * URL: /records/{spray|insecticide|fungicide|scout|harvest|fertility|planting|decon}/{rowId}
 *
 * Per-kind tables don't all expose a `getById` helper today, so this
 * loader queries via the existing `list*` pipelines (which are tenant-
 * scoped) and filters in-process. Cross-tenant isolation is preserved.
 *
 * #195 — locked rows render with a visible lock banner; editable rows
 *        get a "back to /spray" CTA so the operator can correct the row
 *        before the 48h FR-09 window closes.
 */

import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { listSprayEvents, evaluateLock as evaluateSprayLock } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listBlocks } from '$lib/db/blocks';
import { listSprayers } from '$lib/server/sprayers';
import { db } from '$lib/db/client';
import { equipment, equipmentLog, fertilityApplications, users } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { RECORD_KINDS, LOCK_WINDOW_MS, type RecordKind } from '$lib/db/recordsUnified';

function isLocked(occurredAt: number, lockedAt: number | undefined, now: number): boolean {
  if (lockedAt) return true;
  return now - occurredAt >= LOCK_WINDOW_MS;
}

function performerEmail(userId: string | null | undefined): string | null {
  if (!userId) return null;
  // Users is a global identity table; safe to query without a tenant
  // filter. The id was already produced by a tenant-scoped repo on the
  // way in, so the disclosure is only of an id the caller has access to.
  const row = db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();
  return row?.email ?? null;
}

export const load: PageServerLoad = async ({ params }) => {
  const kind = params.kind as RecordKind;
  if (!(RECORD_KINDS as readonly string[]).includes(kind)) {
    throw error(404, `unknown record kind: ${params.kind}`);
  }
  const rowId = params.id;
  const now = Date.now();

  const blockLabelById = new Map(listBlocks().map((b) => [b.id, b.blockLabel ?? b.name]));
  const sprayerLabelById = new Map(listSprayers().map((s) => [s.id, s.label]));

  let detail: Record<string, unknown> | null = null;
  let locked = false;
  let lockedAt: number | undefined;
  let occurredAt = 0;
  let performerLabel: string | null = null;

  if (kind === 'spray') {
    const ev = listSprayEvents({ limit: 10_000 }).find((e) => e.id === rowId);
    if (!ev) throw error(404, 'spray record not found');
    occurredAt = ev.occurredAt;
    lockedAt = ev.lockedAt ?? evaluateSprayLock(ev);
    locked = isLocked(occurredAt, lockedAt, now);
    performerLabel = performerEmail(ev.performedById);
    detail = {
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      sprayerLabel: sprayerLabelById.get(ev.sprayerId) ?? ev.sprayerId,
      products: ev.products,
      conditions: ev.conditions,
      rulesVersion: ev.rulesVersion,
      pluginHashes: ev.pluginHashes,
      customRateOverride: ev.customRateOverride
    };
  } else if (kind === 'insecticide') {
    const ev = listInsecticideEvents({ limit: 10_000 }).find((e) => e.id === rowId);
    if (!ev) throw error(404, 'insecticide record not found');
    occurredAt = ev.occurredAt;
    lockedAt = ev.lockedAt;
    locked = isLocked(occurredAt, lockedAt, now);
    performerLabel = performerEmail(ev.performedById);
    detail = {
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      products: ev.products,
      scoutObservation: ev.scoutObservation,
      conditions: ev.conditions,
      rulesVersion: ev.rulesVersion,
      reEntryClearAt: ev.reEntryClearAt,
      preHarvestClearAt: ev.preHarvestClearAt
    };
  } else if (kind === 'fungicide') {
    const ev = listFungicideEvents({ limit: 10_000 }).find((e) => e.id === rowId);
    if (!ev) throw error(404, 'fungicide record not found');
    occurredAt = ev.occurredAt;
    lockedAt = ev.lockedAt;
    locked = isLocked(occurredAt, lockedAt, now);
    performerLabel = performerEmail(ev.performedById);
    detail = {
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      products: ev.products,
      diseaseObservation: ev.diseaseObservation,
      conditions: ev.conditions,
      rulesVersion: ev.rulesVersion,
      reEntryClearAt: ev.reEntryClearAt,
      preHarvestClearAt: ev.preHarvestClearAt
    };
  } else if (kind === 'scout') {
    const ev = listScoutObservations({ limit: 10_000 }).find((e) => e.id === rowId);
    if (!ev) throw error(404, 'scout record not found');
    occurredAt = ev.occurredAt;
    locked = isLocked(occurredAt, undefined, now);
    performerLabel = performerEmail(ev.performedById);
    detail = {
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      pest: ev.pest,
      metric: ev.metric,
      value: ev.value,
      notes: ev.notes
    };
  } else if (kind === 'harvest') {
    const ev = listHarvestEvents().find((e) => e.id === rowId);
    if (!ev) throw error(404, 'harvest record not found');
    occurredAt = ev.occurredAt;
    locked = isLocked(occurredAt, undefined, now);
    detail = {
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      cropPluginId: ev.cropPluginId,
      quantity: ev.quantity,
      lotNumber: ev.lotNumber
    };
  } else if (kind === 'fertility') {
    const row = db
      .select()
      .from(fertilityApplications)
      .where(withTenant(fertilityApplications, eq(fertilityApplications.id, rowId)))
      .get();
    if (!row) throw error(404, 'fertility record not found');
    occurredAt = row.occurredAt.getTime();
    locked = isLocked(occurredAt, undefined, now);
    performerLabel = performerEmail(row.performedById);
    detail = {
      blockLabel: blockLabelById.get(row.blockId) ?? row.blockId,
      source: row.source,
      ratePerAcre: row.ratePerAcreHundredths / 100,
      rateUnit: row.rateUnit,
      nLbPerAcre: row.nDeliveredHundredths / 100,
      pLbPerAcre: row.pDeliveredHundredths / 100,
      kLbPerAcre: row.kDeliveredHundredths / 100,
      notes: row.notes
    };
  } else if (kind === 'planting') {
    const planting = listBlocks()
      .flatMap((b) => b.plantings)
      .find((p) => p.id === rowId);
    if (!planting || planting.plantingDate == null) throw error(404, 'planting record not found');
    occurredAt = planting.plantingDate;
    locked = isLocked(occurredAt, undefined, now);
    detail = {
      blockLabel: blockLabelById.get(planting.blockId) ?? planting.blockId,
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      quantityPlanted: planting.quantityPlanted,
      quantityUnit: planting.quantityUnit
    };
  } else if (kind === 'decon') {
    const row = db
      .select({
        id: equipmentLog.id,
        occurredAt: equipmentLog.occurredAt,
        equipmentId: equipmentLog.equipmentId,
        performedById: equipmentLog.performedById,
        notes: equipmentLog.notes,
        payloadJson: equipmentLog.payloadJson,
        equipmentLabel: equipment.label
      })
      .from(equipmentLog)
      .leftJoin(equipment, eq(equipment.id, equipmentLog.equipmentId))
      .where(withTenant(equipmentLog, eq(equipmentLog.id, rowId)))
      .get();
    if (!row) throw error(404, 'decon record not found');
    occurredAt = row.occurredAt.getTime();
    locked = isLocked(occurredAt, undefined, now);
    performerLabel = performerEmail(row.performedById);
    detail = {
      equipmentLabel: row.equipmentLabel ?? row.equipmentId,
      notes: row.notes,
      payloadJson: row.payloadJson
    };
  }

  return {
    kind,
    rowId,
    occurredAt,
    locked,
    lockedAt,
    performerLabel,
    detail
  };
};
