/**
 * Phase 30G: the Card a /records row expands into. Reads go through the
 * tenant-scoped repos only, so a row id from another Owner finds nothing.
 * Spray-kind, scout and harvest records get a read-only record card; hay,
 * fertility and planting records show their Planting Card; decon shows the
 * sprayer's Equipment Card.
 */

import { and, eq } from 'drizzle-orm';
import { buildEquipmentCard, buildPlantingCard } from '$lib/cards/build';
import {
  buildHarvestRecordCard,
  buildIrrigationRecordCard,
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
import { getFungicideEvent } from '$lib/db/fungicideEvents';
import { getCutting } from '$lib/db/hayCuttings';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listDispositionsForHarvests, type HarvestDisposition } from '$lib/db/harvestDispositions';
import { dispositionLine } from '$lib/harvest/dispositions';
import { formatInstant } from '$lib/prefs';
import { getInsecticideEvent } from '$lib/db/insecticideEvents';
import { LOCK_WINDOW_MS, RECORD_KINDS, type RecordKind } from '$lib/db/recordKinds';
import { equipmentLog, fertilityApplications, users } from '$lib/db/schema';
import { getIrrigationEvent } from '$lib/db/irrigation';
import { getField } from '$lib/db/fields';
import { getScoutObservation } from '$lib/db/scoutObservations';
import { getSprayEvent } from '$lib/db/sprayEvents';
import { listSprayers } from '$lib/db/sprayers';
import { withTenant } from '$lib/db/tenant';
import { identityLabel } from '$lib/identity';
import type { Prefs } from '$lib/prefs';
import { t, type MessageKey } from '$lib/i18n';
import { buildFarmSnapshot, toCropPlugin, toSprayProduct } from './cardSnapshot';
import { getRegistry } from './registry';
import { lateLabel } from '$lib/records/lateLabel';
import { hayDaysLate } from '$lib/records/hayExport.server';
import { observationLine } from '$lib/records/metricLabel';
import { cropDisplayName } from '$lib/i18n/cropName';

/** G2-06: the hay record card's "Saved N days after its date" line. */
export function hayLateNotice(
  cuttingNumber: number,
  label: string,
  locale?: string | null
): string {
  return t(locale, 'cards.record.hayLate', { n: cuttingNumber, label });
}

function withNotice(card: CardModel, notice: string): CardModel {
  return { ...card, notices: [...(card.notices ?? []), notice] };
}

/** Phase 33B (B-36): the harvest record card lists where it went,
 *  read-only. No money: the card is shown to helpers too. */
function withWhereItWent(card: CardModel, went: HarvestDisposition[], prefs: Prefs): CardModel {
  return {
    ...card,
    sections: [
      ...card.sections,
      {
        title: t(prefs.locale, 'cards.record.whereItWent'),
        items: went.map((d) => dispositionLine(d, formatInstant(d.occurredAt, prefs, 'date'))),
        provenance: 'manual'
      }
    ]
  };
}

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
  return card ? [frameLiveCard(card, recordKind, rowId, opts.prefs.locale)] : [];
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
    const ev = getSprayEvent(rowId);
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
    const ev = kind === 'insecticide' ? getInsecticideEvent(rowId) : getFungicideEvent(rowId);
    if (!ev) return null;
    const sprayer = ev.sprayerId ? listSprayers().find((s) => s.id === ev.sprayerId) : undefined;
    const loc = opts.prefs.locale;
    const seen =
      'scoutObservation' in ev && ev.scoutObservation
        ? observationLine(
            ev.scoutObservation.pest,
            ev.scoutObservation.metric,
            ev.scoutObservation.value,
            null,
            loc
          )
        : 'diseaseObservation' in ev && ev.diseaseObservation
          ? observationLine(
              ev.diseaseObservation.disease,
              ev.diseaseObservation.metric,
              ev.diseaseObservation.value,
              null,
              loc
            )
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
    const ev = getScoutObservation(rowId);
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
    const went = listDispositionsForHarvests([ev.id]).get(ev.id) ?? [];
    const planting = plantingId ? listPlantingsForCardsByIds([plantingId])[0] : undefined;
    const english = planting
      ? planting.varietyDisplayName
      : ((await getRegistry()).get(ev.cropPluginId)?.plugin.displayName ?? ev.cropPluginId);
    const card = buildHarvestRecordCard(
      {
        rowId,
        occurredAt: ev.occurredAt,
        blockLabel: blockLabels().get(ev.blockId) ?? null,
        cropLabel: cropDisplayName(ev.cropPluginId, english, ctx.prefs.locale),
        quantity: ev.quantity ?? null,
        lotNumber: ev.lotNumber ?? null,
        moisturePct: ev.moisturePct ?? null,
        plantingId: planting ? planting.id : null,
        locked: isLocked(ev.occurredAt, ev.lockedAt, now)
      },
      cardOpts
    );
    return {
      cards: [went.length ? withWhereItWent(card, went, ctx.prefs) : card],
      origin
    };
  }

  if (kind === 'hay') {
    const c = getCutting(rowId);
    if (!c) return null;
    const at = c.mowAt ?? c.baleAt ?? c.storedAt ?? c.createdAt;
    const plantingId = c.cropId ?? plantingIdForRecord(c.blockId, c.cropPluginId, at);
    const late = lateLabel(c.recordedLate, hayDaysLate(c), ctx.prefs.locale);
    const cards = await plantingCard(plantingId, kind, rowId, ctx);
    return {
      cards: late
        ? cards.map((card) =>
            withNotice(card, hayLateNotice(c.cuttingNumber, late, ctx.prefs.locale))
          )
        : cards,
      origin
    };
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
    return { cards: card ? [frameLiveCard(card, kind, rowId, opts.prefs.locale)] : [], origin };
  }

  return null;
}

const METHOD_LABEL: Record<string, MessageKey> = {
  drip: 'cards.water.method.drip',
  soaker: 'cards.water.method.soaker',
  sprinkler: 'cards.water.method.sprinkler',
  hand: 'cards.water.method.hand',
  flood: 'cards.water.method.flood',
  other: 'cards.water.method.other'
};

/** Phase 32E (E4-14): a watering log's card. Null when the active Owner has no such log. */
export function buildIrrigationRecordCards(
  rowId: string,
  opts: { prefs: Prefs; now?: number; origin?: string | null }
): RecordCards | null {
  const ev = getIrrigationEvent(rowId);
  if (!ev) return null;
  const now = opts.now ?? Date.now();
  const card = buildIrrigationRecordCard(
    {
      rowId,
      occurredAt: ev.occurredAt,
      areaLabel: getField(ev.fieldId)?.name ?? null,
      bedLabel: ev.blockId ? (blockLabels().get(ev.blockId) ?? null) : null,
      inches: ev.inches,
      gallons: ev.gallons,
      durationMin: ev.durationMin,
      method: ev.method
        ? METHOD_LABEL[ev.method]
          ? t(opts.prefs.locale, METHOD_LABEL[ev.method])
          : ev.method
        : null,
      notes: ev.notes,
      performerLabel: performer(ev.performedById)
    },
    { prefs: opts.prefs, now }
  );
  return { cards: [card], origin: opts.origin ?? null };
}
