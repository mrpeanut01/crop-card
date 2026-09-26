/**
 * Phase 30G: the Card a /records row expands into. Reads go through the
 * tenant-scoped repos only, so a row id from another Owner finds nothing.
 * Spray-kind and scout records get a read-only record card; harvest, hay,
 * fertility and planting records show their Planting Card; decon shows the
 * sprayer's Equipment Card.
 */

import { and, eq } from 'drizzle-orm';
import { buildEquipmentCard, buildPlantingCard } from '$lib/cards/build';
import {
  buildScoutRecordCard,
  buildSprayRecordCard,
  frameLiveCard,
  type SprayRecordProduct
} from '$lib/cards/build/record';
import type { CardModel } from '$lib/cards/model';
import type { FarmSnapshot } from '$lib/cards/snapshot';
import { listBlocks } from '$lib/db/blocks';
import { listPlantingsForCardsByIds, plantingIdForRecord } from '$lib/db/cardSnapshot';
import { db } from '$lib/db/client';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listCuttings } from '$lib/db/hayCuttings';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { LOCK_WINDOW_MS, RECORD_KINDS, type RecordKind } from '$lib/db/recordKinds';
import { equipmentLog, fertilityApplications, users } from '$lib/db/schema';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listSprayers } from '$lib/db/sprayers';
import { withTenant } from '$lib/db/tenant';
import { identityLabel } from '$lib/identity';
import type { Prefs } from '$lib/prefs';
import { buildFarmSnapshot, toCropPlugin, toSprayProduct } from './cardSnapshot';
import { getRegistry } from './registry';

const LOOKUP_LIMIT = 10_000;

export interface RecordCards {
  cards: CardModel[];
  origin: string | null;
}

export function isRecordKind(value: string): value is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(value);
}

function isLocked(occurredAt: number, lockedAt: number | undefined, now: number): boolean {
  return lockedAt !== undefined || now - occurredAt >= LOCK_WINDOW_MS;
}

function performer(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const row = db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row ? identityLabel(row) : null;
}

function blockLabels(): Map<string, string> {
  return new Map(listBlocks().map((b) => [b.id, b.blockLabel ?? b.name]));
}

async function productsFor(
  products: Array<{
    pluginId: string;
    displayName?: string;
    rate?: { amount: number; unit: string };
  }>
): Promise<SprayRecordProduct[]> {
  const registry = await getRegistry();
  return products.map((p) => {
    const rec = registry.get(p.pluginId);
    const label = rec ? toSprayProduct(rec.plugin) : null;
    return {
      pluginId: p.pluginId,
      displayName: p.displayName ?? label?.displayName ?? p.pluginId,
      rate: p.rate ?? null,
      label
    };
  });
}

async function withPlanting(snapshot: FarmSnapshot, plantingId: string): Promise<FarmSnapshot> {
  if (snapshot.plantings.some((p) => p.id === plantingId)) return snapshot;
  const extra = listPlantingsForCardsByIds([plantingId]);
  if (!extra.length) return snapshot;
  const registry = await getRegistry();
  const cropPlugins = { ...snapshot.cropPlugins };
  for (const p of extra) {
    const rec = registry.get(p.cropPluginId);
    const plugin = rec ? toCropPlugin(rec.plugin) : null;
    if (plugin) cropPlugins[p.cropPluginId] = plugin;
  }
  return { ...snapshot, plantings: [...snapshot.plantings, ...extra], cropPlugins };
}

async function plantingCard(
  plantingId: string | null,
  recordKind: RecordKind,
  rowId: string,
  opts: { prefs: Prefs; now: number; origin: string | null }
): Promise<CardModel[]> {
  if (!plantingId) return [];
  const snapshot = await withPlanting(
    await buildFarmSnapshot({ now: opts.now, origin: opts.origin }),
    plantingId
  );
  const card = buildPlantingCard(snapshot, plantingId, { prefs: opts.prefs, now: opts.now });
  return card ? [frameLiveCard(card, recordKind, rowId)] : [];
}

/** Null when no such record is visible to the active Owner. */
export async function buildRecordCards(
  kind: RecordKind,
  rowId: string,
  opts: { prefs: Prefs; now?: number; origin?: string | null }
): Promise<RecordCards | null> {
  const now = opts.now ?? Date.now();
  const origin = opts.origin ?? null;
  const ctx = { prefs: opts.prefs, now, origin };
  const cardOpts = { prefs: opts.prefs, now };

  if (kind === 'spray') {
    const ev = listSprayEvents({ limit: LOOKUP_LIMIT }).find((e) => e.id === rowId);
    if (!ev) return null;
    const sprayer = listSprayers().find((s) => s.id === ev.sprayerId);
    const card = buildSprayRecordCard(
      {
        recordKind: 'spray',
        rowId,
        occurredAt: ev.occurredAt,
        blockLabel: blockLabels().get(ev.blockId) ?? null,
        sprayerLabel: sprayer?.label ?? null,
        products: await productsFor(ev.products),
        conditions: {
          windMph: ev.conditions.windMph,
          tempF: ev.conditions.tempF,
          provenance: ev.conditions.conditionsProvenance ?? 'default'
        },
        observation: null,
        reEntryClearAt: null,
        preHarvestClearAt: null,
        rulesVersion: ev.rulesVersion,
        performerLabel: performer(ev.performedById),
        locked: isLocked(ev.occurredAt, ev.lockedAt, now),
        customRateOverride: ev.customRateOverride ?? false
      },
      cardOpts
    );
    return { cards: [card], origin };
  }

  if (kind === 'insecticide' || kind === 'fungicide') {
    const ev =
      kind === 'insecticide'
        ? listInsecticideEvents({ limit: LOOKUP_LIMIT }).find((e) => e.id === rowId)
        : listFungicideEvents({ limit: LOOKUP_LIMIT }).find((e) => e.id === rowId);
    if (!ev) return null;
    const sprayer = ev.sprayerId ? listSprayers().find((s) => s.id === ev.sprayerId) : undefined;
    const seen =
      'scoutObservation' in ev && ev.scoutObservation
        ? `${ev.scoutObservation.pest} · ${ev.scoutObservation.metric} = ${ev.scoutObservation.value}`
        : 'diseaseObservation' in ev && ev.diseaseObservation
          ? `${ev.diseaseObservation.disease} · ${ev.diseaseObservation.metric} = ${ev.diseaseObservation.value}`
          : null;
    const card = buildSprayRecordCard(
      {
        recordKind: kind,
        rowId,
        occurredAt: ev.occurredAt,
        blockLabel: blockLabels().get(ev.blockId) ?? null,
        sprayerLabel: sprayer?.label ?? null,
        products: await productsFor(ev.products),
        conditions: {
          windMph: ev.conditions.windMph,
          tempF: ev.conditions.tempF,
          provenance: null
        },
        observation: seen,
        reEntryClearAt: ev.reEntryClearAt ?? null,
        preHarvestClearAt: ev.preHarvestClearAt ?? null,
        rulesVersion: ev.rulesVersion,
        performerLabel: performer(ev.performedById),
        locked: isLocked(ev.occurredAt, ev.lockedAt, now),
        customRateOverride: false
      },
      cardOpts
    );
    return { cards: [card], origin };
  }

  if (kind === 'scout') {
    const ev = listScoutObservations({ limit: LOOKUP_LIMIT }).find((e) => e.id === rowId);
    if (!ev) return null;
    const planting = ev.cropId ? listPlantingsForCardsByIds([ev.cropId])[0] : undefined;
    const card = buildScoutRecordCard(
      {
        rowId,
        occurredAt: ev.occurredAt,
        blockLabel: blockLabels().get(ev.blockId) ?? null,
        plantingLabel: planting?.varietyDisplayName ?? null,
        pest: ev.pest,
        metric: ev.metric,
        value: ev.value,
        notes: ev.notes ?? null,
        performerLabel: performer(ev.performedById),
        locked: isLocked(ev.occurredAt, undefined, now)
      },
      cardOpts
    );
    return { cards: [card], origin };
  }

  if (kind === 'harvest') {
    const ev = listHarvestEvents().find((e) => e.id === rowId);
    if (!ev) return null;
    const plantingId = ev.cropId ?? plantingIdForRecord(ev.blockId, ev.cropPluginId, ev.occurredAt);
    return { cards: await plantingCard(plantingId, kind, rowId, ctx), origin };
  }

  if (kind === 'hay') {
    const c = listCuttings({ limit: LOOKUP_LIMIT }).find((x) => x.id === rowId);
    if (!c) return null;
    const at = c.mowAt ?? c.baleAt ?? c.storedAt ?? c.createdAt;
    const plantingId = c.cropId ?? plantingIdForRecord(c.blockId, c.cropPluginId, at);
    return { cards: await plantingCard(plantingId, kind, rowId, ctx), origin };
  }

  if (kind === 'planting') {
    if (!listPlantingsForCardsByIds([rowId]).length) return null;
    return { cards: await plantingCard(rowId, kind, rowId, ctx), origin };
  }

  if (kind === 'fertility') {
    const row = db
      .select({ cropId: fertilityApplications.cropId })
      .from(fertilityApplications)
      .where(withTenant(fertilityApplications, eq(fertilityApplications.id, rowId)))
      .get();
    if (!row) return null;
    return { cards: await plantingCard(row.cropId ?? null, kind, rowId, ctx), origin };
  }

  if (kind === 'decon') {
    const row = db
      .select({ equipmentId: equipmentLog.equipmentId })
      .from(equipmentLog)
      .where(
        withTenant(equipmentLog, and(eq(equipmentLog.id, rowId), eq(equipmentLog.kind, 'decon')))
      )
      .get();
    if (!row) return null;
    const snapshot = await buildFarmSnapshot({ now, origin });
    const card = buildEquipmentCard(snapshot, row.equipmentId, cardOpts);
    return { cards: card ? [frameLiveCard(card, kind, rowId)] : [], origin };
  }

  return null;
}
