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

import { nutrientFromStorage } from '$lib/fertility/applicationMath';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { evaluateLock as evaluateSprayLock, getSprayEvent } from '$lib/db/sprayEvents';
import { getInsecticideEvent } from '$lib/db/insecticideEvents';
import type { PollinatorAttestation } from '$lib/records/pollinatorAttestation';
import { getFungicideEvent } from '$lib/db/fungicideEvents';
import { getScoutObservation } from '$lib/db/scoutObservations';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { getCutting } from '$lib/db/hayCuttings';
import { listBlocks } from '$lib/db/blocks';
import { listSprayers } from '$lib/server/sprayers';
import { db } from '$lib/db/client';
import { equipment, equipmentLog, fertilityApplications, users } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { RECORD_KINDS, LOCK_WINDOW_MS, type RecordKind } from '$lib/db/recordsUnified';
import { requireUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { toSprayProduct } from '$lib/server/cardSnapshot';
import { prefsFor } from '$lib/db/userProfile';
import { createT, t, type MessageKey } from '$lib/i18n';
import { cropDisplayName } from '$lib/i18n/cropName';
import { harvestDetailLines } from '$lib/harvest/details';
import { identityLabel } from '$lib/identity';
import { formatCalendarDate, formatQuantity } from '$lib/prefs';
import {
  deconDetail,
  fertilityDetail,
  harvestDetail,
  hayDetail,
  plantingDetail,
  scoutDetail,
  sprayDetail,
  type DetailProduct,
  type RecordDetailView
} from '$lib/records/recordDetail';

const HAY_STATUS_KEY: Record<string, MessageKey> = {
  aborted: 'hayui.status.aborted',
  baling: 'hayui.status.baling',
  complete: 'hayui.status.complete',
  mowing: 'hayui.status.mowing',
  raking: 'hayui.status.raking',
  tedding: 'hayui.status.tedding'
};

function isLocked(occurredAt: number, lockedAt: number | undefined, now: number): boolean {
  if (lockedAt) return true;
  return now - occurredAt >= LOCK_WINDOW_MS;
}

function performerEmail(userId: string | null | undefined): string | null {
  if (!userId) return null;
  // Users is a global identity table; safe to query without a tenant
  // filter. The id was already produced by a tenant-scoped repo on the
  // way in, so the disclosure is only of an id the caller has access to.
  const row = db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row ? identityLabel(row) : null;
}

export const load: PageServerLoad = async (event) => {
  const { params } = event;
  const user = requireUser(event);
  const kind = params.kind as RecordKind;
  if (!(RECORD_KINDS as readonly string[]).includes(kind)) {
    throw error(404, `unknown record kind: ${params.kind}`);
  }
  const rowId = params.id;
  const now = Date.now();
  const prefs = { ...prefsFor(user.id), locale: event.locals.locale };
  const registry = await getRegistry();

  const blocks = listBlocks();
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const blockLabel = (id: string) => {
    const b = blockById.get(id);
    return b ? (b.blockLabel ?? b.name) : t(prefs.locale, 'records.field.deletedBlock');
  };
  const sprayerLabelById = new Map(listSprayers().map((s) => [s.id, s.label]));
  const products = (
    list: Array<{
      pluginId: string;
      displayName?: string;
      rate?: { amount: number; unit: string };
    }>
  ): DetailProduct[] =>
    list.map((p) => {
      const rec = registry.get(p.pluginId);
      const label = rec ? toSprayProduct(rec.plugin) : null;
      return {
        pluginId: p.pluginId,
        name: p.displayName ?? rec?.plugin.displayName ?? p.pluginId,
        epaRegistrationNumber: label ? label.epaRegistrationNumber : undefined,
        rate: p.rate
      };
    });
  const cropLabel = (pluginId: string, cropId?: string | null) => {
    const planting = cropId
      ? blocks.flatMap((b) => b.plantings).find((p) => p.id === cropId)
      : undefined;
    const english =
      planting?.varietyDisplayName ?? registry.get(pluginId)?.plugin.displayName ?? pluginId;
    return cropDisplayName(pluginId, english, prefs.locale);
  };

  let view: RecordDetailView | null = null;
  let locked = false;
  let lockedAt: number | undefined;
  let occurredAt = 0;
  let performerLabel: string | null = null;
  let pollinator: PollinatorAttestation | null = null;

  if (kind === 'spray') {
    const ev = getSprayEvent(rowId);
    if (!ev) throw error(404, 'spray record not found');
    occurredAt = ev.occurredAt;
    lockedAt = ev.lockedAt ?? evaluateSprayLock(ev);
    locked = isLocked(occurredAt, lockedAt, now);
    performerLabel = performerEmail(ev.performedById);
    view = sprayDetail(
      {
        blockLabel: blockLabel(ev.blockId),
        blockAcres: blockById.get(ev.blockId)?.acres ?? null,
        sprayerLabel: sprayerLabelById.get(ev.sprayerId) ?? null,
        products: products(ev.products),
        conditions: ev.conditions,
        customRateOverride: ev.customRateOverride,
        notes: ev.notes,
        rulesVersion: ev.rulesVersion,
        pluginHashes: ev.pluginHashes
      },
      prefs
    );
  } else if (kind === 'insecticide') {
    const ev = getInsecticideEvent(rowId);
    if (!ev) throw error(404, 'insecticide record not found');
    occurredAt = ev.occurredAt;
    lockedAt = ev.lockedAt;
    locked = isLocked(occurredAt, lockedAt, now);
    performerLabel = performerEmail(ev.performedById);
    pollinator = {
      bloomStatus: ev.bloomStatus,
      bloomStatusSource: ev.bloomStatusSource,
      attestedNoForagers: ev.attestedNoForagers,
      pollinatorVerdict: ev.pollinatorVerdict
    };
    view = sprayDetail(
      {
        blockLabel: blockLabel(ev.blockId),
        blockAcres: blockById.get(ev.blockId)?.acres ?? null,
        sprayerLabel: ev.sprayerId ? (sprayerLabelById.get(ev.sprayerId) ?? null) : null,
        products: products(ev.products),
        conditions: ev.conditions,
        observation: ev.scoutObservation
          ? {
              subject: ev.scoutObservation.pest,
              metric: ev.scoutObservation.metric,
              value: ev.scoutObservation.value
            }
          : null,
        reEntryClearAt: ev.reEntryClearAt,
        preHarvestClearAt: ev.preHarvestClearAt,
        rulesVersion: ev.rulesVersion
      },
      prefs
    );
  } else if (kind === 'fungicide') {
    const ev = getFungicideEvent(rowId);
    if (!ev) throw error(404, 'fungicide record not found');
    occurredAt = ev.occurredAt;
    lockedAt = ev.lockedAt;
    locked = isLocked(occurredAt, lockedAt, now);
    performerLabel = performerEmail(ev.performedById);
    view = sprayDetail(
      {
        blockLabel: blockLabel(ev.blockId),
        blockAcres: blockById.get(ev.blockId)?.acres ?? null,
        sprayerLabel: ev.sprayerId ? (sprayerLabelById.get(ev.sprayerId) ?? null) : null,
        products: products(ev.products),
        conditions: ev.conditions,
        observation: ev.diseaseObservation
          ? {
              subject: ev.diseaseObservation.disease,
              metric: ev.diseaseObservation.metric,
              value: ev.diseaseObservation.value
            }
          : null,
        reEntryClearAt: ev.reEntryClearAt,
        preHarvestClearAt: ev.preHarvestClearAt,
        rulesVersion: ev.rulesVersion
      },
      prefs
    );
  } else if (kind === 'scout') {
    const ev = getScoutObservation(rowId);
    if (!ev) throw error(404, 'scout record not found');
    occurredAt = ev.occurredAt;
    locked = isLocked(occurredAt, undefined, now);
    performerLabel = performerEmail(ev.performedById);
    view = scoutDetail(
      {
        blockLabel: blockLabel(ev.blockId),
        pest: ev.pest,
        metric: ev.metric,
        value: ev.value,
        notes: ev.notes
      },
      prefs
    );
  } else if (kind === 'harvest') {
    const ev = listHarvestEvents().find((e) => e.id === rowId);
    if (!ev) throw error(404, 'harvest record not found');
    occurredAt = ev.occurredAt;
    lockedAt = ev.lockedAt;
    locked = isLocked(occurredAt, lockedAt, now);
    performerLabel = performerEmail(ev.performedById);
    view = harvestDetail(
      {
        blockLabel: blockLabel(ev.blockId),
        cropLabel: cropLabel(ev.cropPluginId, ev.cropId),
        cropPluginId: ev.cropPluginId,
        quantity: ev.quantity,
        lotNumber: ev.lotNumber,
        moisturePct: ev.moisturePct,
        detailLines: harvestDetailLines(
          ev.details,
          createT(prefs.locale),
          (v, q) => formatQuantity(v, q, prefs),
          (ymd) => formatCalendarDate(ymd, 'date', {}, prefs.locale)
        )
      },
      prefs
    );
  } else if (kind === 'hay') {
    const c = getCutting(rowId);
    if (!c) throw error(404, 'hay record not found');
    occurredAt = c.mowAt ?? c.baleAt ?? c.storedAt ?? c.createdAt;
    locked = isLocked(occurredAt, undefined, now);
    performerLabel = performerEmail(c.performedById);
    const statusKey = HAY_STATUS_KEY[c.status];
    view = hayDetail(
      {
        blockLabel: blockLabel(c.blockId),
        cropLabel: cropLabel(c.cropPluginId, c.cropId),
        cropPluginId: c.cropPluginId,
        cuttingNumber: c.cuttingNumber,
        statusLabel: statusKey ? t(prefs.locale, statusKey) : c.status,
        baleType: c.baleType,
        balesQuantity: c.balesQuantity,
        baleMoisturePct: c.baleMoisturePct,
        rulesVersion: c.rulesVersion,
        notes: c.notes
      },
      prefs
    );
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
    view = fertilityDetail(
      {
        blockLabel: blockLabel(row.blockId),
        source: row.source,
        ratePerAcre: row.ratePerAcreHundredths / 100,
        rateUnit: row.rateUnit,
        nLbPerAcre: nutrientFromStorage(row.nDeliveredHundredths),
        pLbPerAcre: nutrientFromStorage(row.pDeliveredHundredths),
        kLbPerAcre: nutrientFromStorage(row.kDeliveredHundredths),
        notes: row.notes
      },
      prefs
    );
  } else if (kind === 'planting') {
    const planting = blocks.flatMap((b) => b.plantings).find((p) => p.id === rowId);
    if (!planting || planting.plantingDate == null) throw error(404, 'planting record not found');
    occurredAt = planting.plantingDate;
    locked = isLocked(occurredAt, undefined, now);
    view = plantingDetail(
      {
        blockLabel: blockLabel(planting.blockId),
        cropLabel: cropDisplayName(
          planting.cropPluginId,
          planting.varietyDisplayName,
          prefs.locale
        ),
        cropPluginId: planting.cropPluginId,
        quantityPlanted: planting.quantityPlanted,
        quantityUnit: planting.quantityUnit
      },
      prefs
    );
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
      .leftJoin(equipment, and(eq(equipment.id, equipmentLog.equipmentId), withTenant(equipment)))
      .where(withTenant(equipmentLog, eq(equipmentLog.id, rowId)))
      .get();
    if (!row) throw error(404, 'decon record not found');
    occurredAt = row.occurredAt.getTime();
    locked = isLocked(occurredAt, undefined, now);
    performerLabel = performerEmail(row.performedById);
    view = deconDetail(
      {
        equipmentLabel: row.equipmentLabel ?? row.equipmentId,
        notes: row.notes,
        payloadJson: row.payloadJson
      },
      prefs
    );
  }
  if (!view) throw error(404, 'record not found');

  return {
    kind,
    rowId,
    occurredAt,
    locked,
    lockedAt,
    performerLabel,
    rows: view.rows,
    technical: view.technical,
    pollinator,
    canEdit: canMutate(user.role)
  };
};
