/**
 * Demo farm content. Fills a brand-new throwaway Owner with a believable
 * Loudoun County farm and garden, dated so it looks live on the day the
 * visitor arrives (`lib/demo/timeline.ts` decides every date). The caller
 * has already written the users, owners, helper_assignments and
 * owner_subscriptions rows and runs this inside `runWithTenant(ownerId)`.
 *
 * No network, no AI, no email or push. Deterministic for a given `now`
 * apart from row ids.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../client';
import { crops, hayCuttings, stockLots, stockMovements, tasks } from '../schema';
import { requireOwnerId, tenantValues } from '../tenant';
import { setSetting } from '../settings';
import { createField } from '../fields';
import { createBlock } from '../blocks';
import { insertBlockProtection } from '../blockProtections';
import { createMapFeature } from '../mapFeatures';
import { appendEquipmentLog, createEquipment, updateEquipmentState } from '../equipment';
import { recordCalibration, recordDecon, recordSpray } from '../sprayers';
import { createStockItem, type StockItem } from '../stock';
import { insertSprayEvent } from '../sprayEvents';
import { insertInsecticideEvent } from '../insecticideEvents';
import { insertFungicideEvent } from '../fungicideEvents';
import { insertCropHarvestEvent } from '../harvestEvents';
import { insertScoutObservation } from '../scoutObservations';
import { insertFertilityApplication, insertSoilTest } from '../fertility';
import { insertJournalEntry } from '../plantingJournal';
import { createSeedStart, recordSeedStartProgress } from '../seedStarts';
import { insertIrrigationEvent, insertRainGaugeReading } from '../irrigation';
import { insertLedgerEntry } from '../ledger';
import { insertAnimalGroup } from '../animalGroups';
import { insertAnimal } from '../animals';
import { insertStay } from '../animalLocations';
import { insertProductionLog } from '../animalProduction';
import { insertCarePlan } from '../animalCarePlans';
import { materializePluginPrePost } from '../tasks';
import { placementColumns } from '../crops';

import { RULES_VERSION } from '$lib/safety/version';
import type { ChemistryClass, SprayerLoadClass } from '$lib/safety/types';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { seedStartTaskId, seedStartTemplateKey } from '$lib/schedule/seedStart';
import {
  dismissGettingStarted,
  setFarmAnimals,
  setFarmProfile,
  setOnboardingStatus
} from '$lib/onboarding/state.server';
import { setActivePlanningYear } from '$lib/season/planningYear.server';
import { saveSeasonSetup } from '$lib/season/setup.server';
import { saveEmergencyContacts } from '$lib/farm/emergencyContacts.server';
import {
  DEMO_AREAS,
  DEMO_BEDS,
  DEMO_CROPS,
  DEMO_EQUIPMENT,
  DEMO_FARM_NAME as CATALOG_FARM_NAME,
  DEMO_FLOCK_SIZE,
  DEMO_GOATS,
  DEMO_PRODUCTS,
  DEMO_SEEDS,
  bedAcres,
  type DemoAreaKey,
  type DemoBedKey,
  type DemoEquipmentKey,
  type DemoProduct,
  type DemoSprayerKey
} from '$lib/demo/catalog';
import { buildDemoTimeline, type DemoSpray, type DemoTimeline } from '$lib/demo/timeline';
import { DAY_MS, DEMO_FROST, DEMO_LAT_LON, addDaysYmd, ymdOf, zonedMs } from '$lib/demo/time';
import { demoLocalizer, type DemoLocalizer } from '$lib/demo/localize';

export const DEMO_FARM_NAME: string = CATALOG_FARM_NAME;

export interface DemoSeedInput {
  ownerId: string;
  userId: string;
  now: number;
  /** The visitor's language: names, notes and task titles are written in it. */
  locale?: string | null;
}

export interface DemoSeedSummary {
  farmName: string;
  counts: Record<string, number>;
  seasonYear: number;
}

const HOUR_MS = 3_600_000;

/** Set for the length of one synchronous `seedDemoFarm` call. */
let L: DemoLocalizer = demoLocalizer(null);

// ─── plugin hashes (traceability on spray records) ──────────────────────

const pluginHashCache = new Map<string, string>();

function pluginsDir(): string {
  if (process.env.PLUGINS_DIR) return process.env.PLUGINS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../../../plugins');
}

/** SHA-256 of the plugin file's JSON, as the registry computes it. */
function pluginHash(product: DemoProduct): string {
  const hit = pluginHashCache.get(product.pluginId);
  if (hit) return hit;
  let hash: string;
  try {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(pluginsDir(), product.dir, `${product.pluginId}.json`), 'utf8')
    );
    hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  } catch {
    hash = createHash('sha256').update(JSON.stringify(product)).digest('hex');
  }
  pluginHashCache.set(product.pluginId, hash);
  return hash;
}

// ─── map geometry ───────────────────────────────────────────────────────

const FT_PER_DEG_LAT = 364_000;

function toLonLat(xFt: number, yFt: number): [number, number] {
  const lat = DEMO_LAT_LON.lat + yFt / FT_PER_DEG_LAT;
  const ftPerDegLon = FT_PER_DEG_LAT * Math.cos((DEMO_LAT_LON.lat * Math.PI) / 180);
  const lon = DEMO_LAT_LON.lon + xFt / ftPerDegLon;
  return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
}

function rectCorners(cx: number, cy: number, w: number, l: number): Array<[number, number]> {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - l / 2;
  const y1 = cy + l / 2;
  return [toLonLat(x0, y0), toLonLat(x1, y0), toLonLat(x1, y1), toLonLat(x0, y1), toLonLat(x0, y0)];
}

function rectPolygon(cx: number, cy: number, w: number, l: number): string {
  return JSON.stringify({ type: 'Polygon', coordinates: [rectCorners(cx, cy, w, l)] });
}

// ─── the seed ───────────────────────────────────────────────────────────

/**
 * Seeds the demo farm for the active tenant. Synchronous and run in one
 * transaction.
 * @hold-exempt: a brand-new demo farm has no prior holds to shorten, and none of its applications land on a grazed Area
 */
export function seedDemoFarm(input: DemoSeedInput): DemoSeedSummary {
  if (requireOwnerId() !== input.ownerId) {
    throw new Error('seedDemoFarm: run it inside runWithTenant(ownerId)');
  }
  const timeline = buildDemoTimeline(input.now);
  L = demoLocalizer(input.locale);
  let counts: Record<string, number>;
  try {
    counts = db.transaction(() => writeFarm(input, timeline));
  } finally {
    L = demoLocalizer(null);
  }
  return { farmName: DEMO_FARM_NAME, counts, seasonYear: timeline.season.current };
}

function writeFarm(input: DemoSeedInput, t: DemoTimeline): Record<string, number> {
  const { userId, now } = input;
  const counts: Record<string, number> = {};
  const bump = (key: string, n = 1) => {
    counts[key] = (counts[key] ?? 0) + n;
  };

  writeSettings(t, now);
  bump('settings');

  // Areas and beds.
  const areaId = new Map<DemoAreaKey, string>();
  for (const a of DEMO_AREAS) {
    const f = createField({
      name: L(a.name),
      kind: a.kind,
      details: a.details,
      widthFt: a.widthFt,
      lengthFt: a.lengthFt,
      notes: L(a.notes),
      geometryGeojson: rectPolygon(a.cxFt, a.cyFt, a.widthFt, a.lengthFt)
    });
    areaId.set(a.key, f.id);
    bump('areas');
  }
  const bedId = new Map<DemoBedKey, string>();
  for (const b of DEMO_BEDS) {
    const block = createBlock({
      name: L(b.name),
      fieldId: areaId.get(b.area)!,
      kind: b.kind,
      widthFt: b.widthFt,
      lengthFt: b.lengthFt,
      xFt: b.xFt,
      yFt: b.yFt,
      bedStyle: b.bedStyle,
      tillageMethod: b.tillage,
      sunExposure: 'full',
      geometryGeojson:
        b.cxFt !== undefined && b.cyFt !== undefined
          ? rectPolygon(b.cxFt, b.cyFt, b.widthFt, b.lengthFt)
          : undefined
    });
    bedId.set(b.key, block.id);
    bump('blocks');
  }
  for (const key of ['tE', 'tW'] as const) {
    insertBlockProtection({
      blockId: bedId.get(key)!,
      kind: 'high-tunnel',
      springShiftDays: 28,
      fallShiftDays: 35,
      provenance: 'manual',
      installedOn: null,
      removedOn: null,
      seasonYear: null,
      notes: L('30 × 72 ft gothic tunnel, single poly, roll-up sides.')
    });
    bump('blockProtections');
  }

  writeMapFeatures(areaId);
  bump('mapFeatures', 6);

  // Gear.
  const equipmentId = new Map<DemoEquipmentKey, string>();
  for (const e of DEMO_EQUIPMENT) {
    const template = SEED_EQUIPMENT_TEMPLATES.find((x) => x.templateId === e.templateId);
    if (!template) throw new Error(`demo equipment template missing: ${e.templateId}`);
    const row = createEquipment({
      type: template.type,
      label: template.label,
      spec: { ...(template.spec ?? {}), templateId: template.templateId },
      notes: L(e.notes)
    });
    equipmentId.set(e.key, row.id);
    if (e.hourMeter !== undefined) updateEquipmentState(row.id, { hourMeter: e.hourMeter });
    bump('equipment');
  }
  const sprayerId = (k: DemoSprayerKey) => equipmentId.get(k)!;

  // Plantings.
  const plantingId = new Map<string, string>();
  const plantingBed = new Map<string, string>();
  const templates = new Map(DEMO_CROPS.map((c) => [c.key, c]));
  for (const p of t.plantings) {
    const id = randomUUID();
    const blockId = bedId.get(p.bed)!;
    plantingId.set(p.key, id);
    plantingBed.set(p.key, blockId);
    db.insert(crops)
      .values(
        tenantValues({
          id,
          blockId,
          cropPluginId: p.cropPluginId,
          varietyDisplayName: L(p.variety),
          plantingDate: new Date(p.plantingDate),
          status: p.status,
          harvestedAt: p.harvestedAt !== undefined ? new Date(p.harvestedAt) : null,
          quantityPlantedHundredths: p.quantity ? Math.round(p.quantity.amount * 100) : null,
          quantityUnit: p.quantity?.unit ?? null,
          establishment: p.establishment ?? null,
          sownIndoorsAt: p.sownIndoorsAt !== undefined ? new Date(p.sownIndoorsAt) : null,
          ...(p.footprint
            ? placementColumns({
                footprint: p.footprint,
                spacingIn: p.spacingIn ?? null,
                rowSpacingIn: null,
                spacingPattern: 'square',
                plantCount: p.plantCount ?? null,
                plantCountProvenance: p.plantCount !== undefined ? 'data' : null
              })
            : {})
        })
      )
      .run();
    bump(`plantings.${p.status}`);
  }

  // Stock: products, seed, feed.
  const stock = writeStock(t, userId, now, plantingId, templates);
  bump('stockItems', stock.itemCount);
  bump('stockLots', stock.lotCount);

  // Spray records, sprayer state and stock draw-down.
  const sprayRecordId = new Map<DemoSpray, { id: string; table: string }>();
  const sprays = [...t.sprays].sort((a, b) => a.at - b.at);
  const lastAtvSpray = sprays.filter((s) => s.sprayer === 'atv').at(-1);
  for (const s of sprays) {
    const product = DEMO_PRODUCTS[s.product];
    const blockId = bedId.get(s.bed)!;
    const cropId = plantingId.get(s.plantingKey);
    const conditions = {
      windMph: s.windMph,
      tempF: s.tempF,
      rainForecastMmNext24h: 0
    };
    const hashes = { [product.pluginId]: pluginHash(product) };
    const codes = product.codes ?? [];
    let id: string;
    let table: 'spray_event' | 'insecticide_event' | 'fungicide_event';
    let load: SprayerLoadClass;
    if (s.kind === 'herbicide') {
      id = insertSprayEvent({
        blockId,
        cropId,
        sprayerId: sprayerId(s.sprayer),
        performedById: userId,
        occurredAt: s.at,
        products: [
          {
            pluginId: product.pluginId,
            chemistryClasses: codes as ChemistryClass[],
            rate: product.rate
          }
        ],
        conditions: { ...conditions, conditionsProvenance: 'measured' },
        rulesVersion: RULES_VERSION,
        pluginHashes: hashes
      }).id;
      table = 'spray_event';
      load = codes[0] as SprayerLoadClass;
    } else {
      const clears = {
        reEntryClearAt: s.at + (product.reiHours ?? 0) * HOUR_MS,
        preHarvestClearAt: s.at + (product.phiDays ?? 0) * DAY_MS
      };
      if (s.kind === 'insecticide') {
        id = insertInsecticideEvent({
          blockId,
          cropId,
          sprayerId: sprayerId(s.sprayer),
          performedById: userId,
          occurredAt: s.at,
          products: [
            {
              pluginId: product.pluginId,
              displayName: product.displayName,
              iracGroups: codes,
              rate: product.rate
            }
          ],
          scoutObservation: s.target
            ? { pest: s.target, metric: 'count-per-plant', value: 1, threshold: 1 }
            : undefined,
          conditions,
          ...clears,
          rulesVersion: RULES_VERSION,
          pluginHashes: hashes,
          bloomStatus: 'not-in-bloom',
          bloomStatusSource: 'operator',
          attestedNoForagers: false,
          pollinatorVerdict: 'pass'
        }).id;
        table = 'insecticide_event';
        load = 'insecticide-load';
      } else {
        id = insertFungicideEvent({
          blockId,
          cropId,
          sprayerId: sprayerId(s.sprayer),
          performedById: userId,
          occurredAt: s.at,
          products: [
            {
              pluginId: product.pluginId,
              displayName: product.displayName,
              fracCodes: codes,
              rate: product.rate
            }
          ],
          diseaseObservation: s.target
            ? {
                disease: s.target,
                metric: 'percent-leaf-area',
                value: 2,
                notes: 'Protective cover spray.'
              }
            : undefined,
          conditions,
          ...clears,
          rulesVersion: RULES_VERSION,
          pluginHashes: hashes
        }).id;
        table = 'fungicide_event';
        load = 'fungicide-load';
      }
    }
    sprayRecordId.set(s, { id, table });
    bump(`records.${table}`);

    recordSpray(sprayerId(s.sprayer), load, s.at);
    const rinsed = s.at + 2 * HOUR_MS;
    if (s !== lastAtvSpray && rinsed <= now) recordDecon(sprayerId(s.sprayer), rinsed);

    const amount =
      s.kind === 'herbicide'
        ? (product.perAcreInUnit ?? 0) * bedAcres(DEMO_BEDS.find((b) => b.key === s.bed)!)
        : (product.perLoadInUnit ?? 0) * (s.sprayer === 'atv' ? 4 : 1);
    stock.draw(product.pluginId, amount, s.at, {
      reason:
        table === 'spray_event'
          ? 'spray-event'
          : table === 'insecticide_event'
            ? 'insecticide-event'
            : 'fungicide-event',
      sprayEventId: table === 'spray_event' ? id : null,
      insecticideEventId: table === 'insecticide_event' ? id : null,
      fungicideEventId: table === 'fungicide_event' ? id : null,
      cropId: cropId ?? null
    });

    if (s.at >= now - 30 * DAY_MS) {
      writeTask({
        title: `Spray ${product.displayName.split(' (')[0]}`,
        category: 'spray',
        due: Date.parse(`${ymdOf(s.at)}T00:00:00Z`),
        cropId: cropId ?? null,
        blockId,
        equipmentId: sprayerId(s.sprayer),
        relatedEventTable: table,
        relatedEventId: id,
        completedAt: s.at,
        createdById: userId,
        createdAt: Math.min(s.at, now) - 3 * DAY_MS
      });
      bump('tasks.done');
    }
  }

  for (const c of t.calibrations) {
    const gpa = DEMO_EQUIPMENT.find((e) => e.key === c.sprayer)?.calibratedGpa ?? 15;
    recordCalibration(sprayerId(c.sprayer), gpa, c.at);
  }
  appendEquipmentLog({
    equipmentId: equipmentId.get('tractor')!,
    kind: 'maintenance',
    occurredAt: now - 40 * DAY_MS,
    performedById: userId,
    notes: L('Engine oil, filters and UDT fluid changed at 1,210 hours.')
  });
  appendEquipmentLog({
    equipmentId: equipmentId.get('baler')!,
    kind: 'inspection',
    occurredAt: now - 75 * DAY_MS,
    performedById: userId,
    notes: L('Knotters timed, new twine knives.')
  });

  // Harvests.
  const harvestId = new Map<string, string>();
  for (const h of t.harvests) {
    const ev = insertCropHarvestEvent({
      blockId: bedId.get(h.bed)!,
      cropId: plantingId.get(h.plantingKey),
      cropPluginId: h.cropPluginId,
      occurredAt: h.at,
      quantity: `${h.amount} ${h.unit}`,
      lotNumber: h.lotNumber,
      moisturePct: h.moisturePct
    });
    harvestId.set(`${h.plantingKey}@${h.at}`, ev.id);
    bump('records.harvest_event');
  }

  // Hay.
  for (const cut of t.hay) {
    db.insert(hayCuttings)
      .values(
        tenantValues({
          id: randomUUID(),
          blockId: bedId.get('hay')!,
          cropId: plantingId.get(cut.plantingKey) ?? null,
          cropPluginId: 'orchard-grass-potomac',
          cuttingNumber: cut.number,
          year: cut.season,
          status: cut.status,
          mowAt: new Date(cut.mowAt),
          tedAt: cut.tedAt !== undefined ? new Date(cut.tedAt) : null,
          rakeAt: cut.rakeAt !== undefined ? new Date(cut.rakeAt) : null,
          baleAt: cut.baleAt !== undefined ? new Date(cut.baleAt) : null,
          storedAt: cut.storedAt !== undefined ? new Date(cut.storedAt) : null,
          baleType: cut.baleAt !== undefined ? 'small-square' : null,
          balesQuantity: cut.bales ?? null,
          baleMoistureHundredths:
            cut.moisturePct !== undefined ? Math.round(cut.moisturePct * 100) : null,
          performedById: userId,
          rulesVersion: RULES_VERSION,
          recordedLate: false,
          notes: cut.status === 'complete' ? L('Stacked in the bank barn loft.') : null,
          createdAt: new Date(cut.mowAt)
        })
      )
      .run();
    bump('records.hay_cutting');
  }

  // Scouting, fertility, journal, seed trays.
  for (const s of t.scouts) {
    insertScoutObservation({
      blockId: bedId.get(s.bed)!,
      cropId: plantingId.get(s.plantingKey),
      performedById: userId,
      pest: s.pest,
      metric: s.metric,
      value: s.value,
      notes: L(s.notes),
      occurredAt: s.at
    });
    bump('records.scout');
  }
  for (const f of t.fertility) {
    const product = DEMO_PRODUCTS[f.product];
    const app = insertFertilityApplication({
      blockId: bedId.get(f.bed)!,
      cropId: plantingId.get(f.plantingKey),
      occurredAt: f.at,
      source: product.displayName,
      stockItemId: stock.itemId(product.pluginId),
      ratePerAcre: f.ratePerAcre,
      rateUnit: f.rateUnit,
      nLbPerAcre: f.n,
      pLbPerAcre: f.p,
      kLbPerAcre: f.k,
      performedById: userId
    });
    const acres = bedAcres(DEMO_BEDS.find((b) => b.key === f.bed)!);
    stock.draw(product.pluginId, f.ratePerAcre * acres, f.at, {
      reason: 'fertility-application',
      fertilityApplicationId: app.id,
      cropId: plantingId.get(f.plantingKey) ?? null
    });
    bump('records.fertility');
  }
  for (const j of t.journal) {
    insertJournalEntry({
      cropId: plantingId.get(j.plantingKey)!,
      blockId: bedId.get(j.bed)!,
      createdBy: userId,
      kind: 'note',
      text: L(j.text),
      provenance: 'manual',
      createdAt: j.at
    });
    bump('journal');
  }
  for (const s of t.seedStarts) {
    const planting = t.plantings.find((p) => p.key === s.plantingKey)!;
    const tray = createSeedStart({
      cropId: plantingId.get(s.plantingKey)!,
      sownAt: s.sownAt,
      trayLabel: L(s.trayLabel),
      cells: s.cells,
      seedsPerCell: 1,
      locationText: L('Basement grow shelf'),
      stockLotId: planting.seed ? (stock.seedLotId(planting.seed) ?? null) : null,
      performedById: userId
    });
    if (s.germinatedAt !== undefined || s.hardenStartedAt !== undefined) {
      recordSeedStartProgress(tray.id, {
        observedAt: s.germinatedAt ?? s.sownAt,
        germinatedCount: s.germinatedCount,
        hardenStartedAt: s.hardenStartedAt,
        transplantedAt: s.transplantedAt
      });
    }
    bump('seedStarts');
  }

  for (const s of t.soilTests) {
    insertSoilTest({
      blockId: bedId.get(s.bed)!,
      sampledAt: s.at,
      lab: 'Waypoint Analytical, Richmond VA',
      extractionMethod: 'mehlich-3',
      unitsBasis: 'ppm',
      ph: s.bed === 'nfA' ? 6.2 : 6.6,
      bufferPh: s.bed === 'nfA' ? 6.7 : 6.9,
      organicMatterPct: s.bed === 'nfA' ? 2.9 : 5.4,
      cec: s.bed === 'nfA' ? 9.8 : 13.1,
      phosphorusPpm: s.bed === 'nfA' ? 38 : 112,
      potassiumPpm: s.bed === 'nfA' ? 124 : 210,
      caPpm: s.bed === 'nfA' ? 1180 : 1720,
      mgPpm: s.bed === 'nfA' ? 165 : 240,
      nitratePpm: s.bed === 'nfA' ? 9 : 22,
      labRatings: s.bed === 'nfA' ? { p: 'medium', k: 'medium' } : { p: 'high', k: 'high' },
      provenance: 'manual',
      notes:
        s.bed === 'nfA'
          ? L('Lab recommends 1 ton/ac ag lime before corn.')
          : L('Years of compost show. Skip P for a season.')
    });
    bump('records.soil_test');
  }

  // Water.
  for (const w of t.irrigation) {
    insertIrrigationEvent({
      fieldId: areaId.get(w.area)!,
      blockId: w.bed ? (bedId.get(w.bed) ?? null) : null,
      occurredAt: w.at,
      durationMin: w.durationMin,
      inches: w.inches,
      method: w.method,
      notes: L(w.notes ?? null),
      performedById: userId
    });
    bump('records.irrigation');
  }
  for (const r of t.rain) {
    insertRainGaugeReading({
      fieldId: areaId.get(r.area)!,
      readAt: r.at,
      inches: r.inches,
      recordedById: userId
    });
    bump('records.rain_gauge');
  }

  // Animals.
  const animalIds = writeAnimals(areaId, userId, now);
  bump('animalGroups', 2);
  bump('animals', DEMO_GOATS.length + 1);
  for (const log of t.production) {
    insertProductionLog({
      subjectType: 'group',
      subjectId: log.subject === 'flock' ? animalIds.flock : animalIds.goats,
      kind: log.kind,
      quantity: log.quantity,
      unit: log.unit,
      occurredAt: log.at,
      use: log.use,
      rulesVersion: RULES_VERSION,
      performedById: userId,
      createdAt: log.at
    });
    bump('records.production');
  }
  for (const c of t.carePlans) {
    insertCarePlan(
      {
        subjectType: c.subject === 'dog' ? 'animal' : 'group',
        subjectId:
          c.subject === 'flock'
            ? animalIds.flock
            : c.subject === 'goats'
              ? animalIds.goats
              : animalIds.dog,
        kind: c.kind,
        title: L(c.title),
        intervalDays: c.intervalDays,
        nextDueOn: c.nextDue,
        leadDays: c.leadDays,
        provenance: 'manual'
      },
      now
    );
    bump('carePlans');
  }

  // Money.
  for (const e of stock.purchases) {
    insertLedgerEntry(
      {
        kind: 'expense',
        occurredAt: e.at,
        amountCents: e.cents,
        category: e.category,
        description: e.description,
        stockLotId: e.lotId
      },
      userId,
      now
    );
    bump('ledger');
  }
  for (const e of t.ledger) {
    const plantingKey = e.plantingKey;
    insertLedgerEntry(
      {
        kind: e.kind,
        occurredAt: e.at,
        amountCents: e.amountCents,
        category: e.category,
        description: L(e.description),
        enterprise: L(e.enterprise ?? null),
        quantity: e.quantity ?? null,
        unit: e.unit ?? null,
        cropId: plantingKey ? (plantingId.get(plantingKey) ?? null) : null,
        harvestEventId:
          plantingKey && e.harvestAt !== undefined
            ? (harvestId.get(`${plantingKey}@${e.harvestAt}`) ?? null)
            : null,
        animalGroupId: e.subject === 'flock' ? animalIds.flock : null
      },
      userId,
      now
    );
    bump('ledger');
  }

  // Open work.
  for (const task of t.tasks) {
    const cropId = task.plantingKey ? (plantingId.get(task.plantingKey) ?? null) : null;
    const blockId = task.bed
      ? bedId.get(task.bed)!
      : task.plantingKey
        ? (plantingBed.get(task.plantingKey) ?? null)
        : null;
    const id = task.seedStep && cropId ? seedStartTaskId(cropId, task.seedStep) : randomUUID();
    const equipment = task.equipment ? equipmentId.get(task.equipment)! : null;
    writeTask({
      id,
      title: task.title,
      body: task.body ?? null,
      category: task.category,
      due: task.due,
      cropId,
      blockId,
      equipmentId: equipment,
      relatedEventTable: task.relatedTable ?? null,
      relatedEventId: null,
      pluginTemplateKey:
        task.seedStep && cropId ? seedStartTemplateKey(cropId, task.seedStep) : null,
      completedAt: task.doneAt ?? null,
      createdById: userId,
      createdAt: Math.min(now, task.due) - 10 * DAY_MS
    });
    bump(task.doneAt !== undefined ? 'tasks.done' : 'tasks.open');
    if (task.doneAt === undefined && task.category === 'spray' && equipment) {
      const template = SEED_EQUIPMENT_TEMPLATES.find(
        (x) => x.templateId === DEMO_EQUIPMENT.find((e) => e.key === task.equipment)?.templateId
      );
      const made = materializePluginPrePost({
        primaryTaskId: id,
        scheduledFor: task.due,
        equipmentTemplate: template,
        equipmentLastUsedAt: undefined
      });
      bump('tasks.linked', made.preTaskIds.length + made.postTaskIds.length);
    }
  }

  return counts;
}

// ─── settings ───────────────────────────────────────────────────────────

function writeSettings(t: DemoTimeline, now: number): void {
  setOnboardingStatus('complete');
  setFarmProfile('mixed');
  setFarmAnimals(['animals', 'pets', 'chickens']);
  dismissGettingStarted(now);
  setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify(DEMO_LAT_LON));
  setSetting(SETTINGS_KEYS.lastFrost, DEMO_FROST.lastFrost);
  setSetting(SETTINGS_KEYS.firstFrost, DEMO_FROST.firstFrost);
  setSetting(SETTINGS_KEYS.lastHardFrost, DEMO_FROST.lastHardFrost);
  setSetting(SETTINGS_KEYS.firstHardFrost, DEMO_FROST.firstHardFrost);
  setSetting(
    SETTINGS_KEYS.frostProvenance,
    JSON.stringify({
      values: {
        lastFrost: 'manual',
        firstFrost: 'manual',
        lastHardFrost: 'manual',
        firstHardFrost: 'manual'
      },
      source: null,
      probability: null
    })
  );
  setSetting(SETTINGS_KEYS.hardinessZone, '7a');
  setSetting(SETTINGS_KEYS.hardinessZoneProvenance, 'manual');
  // The demo runs the no-key path: AI is off for this farm (`owner-disabled`).
  setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '0');
  setActivePlanningYear(t.season.planningYear, new Date(now));
  const years = new Set([t.season.current - 1, t.season.current, t.season.planningYear]);
  for (const year of years) {
    saveSeasonSetup(year, {
      philosophy: 'conventional',
      weedStrategy: 'post-emergence-ok',
      pestStrategy: 'ipm',
      fertilityApproach: 'mixed',
      coverCropIntent: 'fall-cereal',
      transitioningStartedYear: null
    });
  }
  saveEmergencyContacts([
    {
      name: L('Dr. Ellen Marsh (fictional)'),
      role: L('Large-animal vet'),
      phone: '555-0100',
      type: 'vet'
    },
    {
      name: L('Loudoun Extension office (fictional)'),
      role: L('Agronomy questions'),
      phone: '555-0142'
    },
    { name: L('Ridge Road Co-op (fictional)'), role: L('Fuel and fertilizer'), phone: '555-0177' }
  ]);
}

// ─── map lines and points ───────────────────────────────────────────────

function writeMapFeatures(areaId: Map<DemoAreaKey, string>): void {
  const pasture = DEMO_AREAS.find((a) => a.key === 'goatPasture')!;
  const fence = rectCorners(pasture.cxFt, pasture.cyFt, pasture.widthFt, pasture.lengthFt);
  createMapFeature({
    kind: 'fence',
    name: L('Goat pasture woven-wire fence'),
    geometry: { type: 'LineString', coordinates: fence },
    fieldId: areaId.get('goatPasture')!
  });
  createMapFeature({
    kind: 'gate',
    name: L('Pasture gate'),
    geometry: {
      type: 'Point',
      coordinates: toLonLat(pasture.cxFt - pasture.widthFt / 2, pasture.cyFt + 40)
    },
    fieldId: areaId.get('goatPasture')!
  });
  createMapFeature({
    kind: 'hydrant',
    name: L('Barnyard frost-free hydrant'),
    geometry: { type: 'Point', coordinates: toLonLat(100, -70) },
    fieldId: areaId.get('goatPasture')!,
    areaIds: [areaId.get('goatPasture')!, areaId.get('coop')!]
  });
  createMapFeature({
    kind: 'water_source',
    name: L('Barn well'),
    geometry: { type: 'Point', coordinates: toLonLat(170, 30) },
    fieldId: areaId.get('barn')!,
    details: { source: 'well', flowRateGpm: 8 }
  });
  const garden = DEMO_AREAS.find((a) => a.key === 'garden')!;
  createMapFeature({
    kind: 'irrigation_line',
    name: L('Garden drip main'),
    geometry: {
      type: 'LineString',
      coordinates: [
        toLonLat(garden.cxFt - garden.widthFt / 2, garden.cyFt - garden.lengthFt / 2 + 2),
        toLonLat(garden.cxFt + garden.widthFt / 2, garden.cyFt - garden.lengthFt / 2 + 2)
      ]
    },
    fieldId: areaId.get('garden')!
  });
  createMapFeature({
    kind: 'path',
    name: L('Farm lane'),
    geometry: {
      type: 'LineString',
      coordinates: [toLonLat(30, 0), toLonLat(40, 150), toLonLat(20, 400)]
    }
  });
}

// ─── stock ──────────────────────────────────────────────────────────────

interface DrawLink {
  reason:
    | 'spray-event'
    | 'insecticide-event'
    | 'fungicide-event'
    | 'fertility-application'
    | 'planting'
    | 'animal-feed';
  sprayEventId?: string | null;
  insecticideEventId?: string | null;
  fungicideEventId?: string | null;
  fertilityApplicationId?: string | null;
  cropId?: string | null;
  notes?: string | null;
}

interface StockWriter {
  itemCount: number;
  lotCount: number;
  itemId(pluginId: string): string | undefined;
  seedLotId(seedKey: string): string | undefined;
  draw(pluginId: string, amount: number, at: number, link: DrawLink): void;
  purchases: Array<{
    lotId: string;
    at: number;
    cents: number;
    category: string;
    description: string;
  }>;
}

const PURCHASE_CATEGORY: Record<string, string> = {
  herbicide: 'pest-control',
  insecticide: 'pest-control',
  fungicide: 'pest-control',
  fertilizer: 'fertility',
  seed: 'seed-and-plants',
  feed: 'feed',
  bedding: 'supplies',
  'animal-health': 'animal-health'
};

function writeStock(
  t: DemoTimeline,
  userId: string,
  now: number,
  plantingId: Map<string, string>,
  templates: Map<string, (typeof DEMO_CROPS)[number]>
): StockWriter {
  let itemCount = 0;
  let lotCount = 0;
  const items = new Map<string, StockItem>();
  /** pluginId → year → lot id */
  const lotByYear = new Map<string, Map<number, string>>();
  const seedLot = new Map<string, string>();
  const purchases: StockWriter['purchases'] = [];

  const insertLot = (lot: {
    item: StockItem;
    at: number;
    quantity: number;
    costCents?: number;
    supplier: string;
    lotNumber?: string;
    expiresAt?: number;
    status?: 'existing' | 'ordered' | 'planned';
    notes?: string;
  }): string => {
    const id = randomUUID();
    const hundredths = Math.round(lot.quantity * 100);
    const status = lot.status ?? 'existing';
    db.insert(stockLots)
      .values(
        tenantValues({
          id,
          stockItemId: lot.item.id,
          lotNumber: lot.lotNumber ?? null,
          expiresAt: lot.expiresAt !== undefined ? new Date(lot.expiresAt) : null,
          receivedAt: new Date(lot.at),
          receivedQuantityHundredths: hundredths,
          receivedCostCents: lot.costCents ?? null,
          supplier: lot.supplier,
          notes: lot.notes ?? null,
          quantityStatus: status
        })
      )
      .run();
    if (status === 'existing') {
      db.insert(stockMovements)
        .values(
          tenantValues({
            id: randomUUID(),
            stockLotId: id,
            occurredAt: new Date(lot.at),
            deltaHundredths: hundredths,
            reason: 'receipt' as const,
            performedById: userId,
            notes: L('lot received')
          })
        )
        .run();
      if (lot.costCents) {
        purchases.push({
          lotId: id,
          at: lot.at,
          cents: lot.costCents,
          category: PURCHASE_CATEGORY[lot.item.category] ?? 'supplies',
          description: `${lot.item.displayName} (${lot.quantity} ${lot.item.defaultUnit})`
        });
      }
    }
    lotCount++;
    return id;
  };

  const movement = (lotId: string, amount: number, at: number, link: DrawLink) => {
    const hundredths = Math.round(amount * 100);
    if (hundredths <= 0) return;
    db.insert(stockMovements)
      .values(
        tenantValues({
          id: randomUUID(),
          stockLotId: lotId,
          occurredAt: new Date(at),
          deltaHundredths: -hundredths,
          reason: link.reason,
          sprayEventId: link.sprayEventId ?? null,
          insecticideEventId: link.insecticideEventId ?? null,
          fungicideEventId: link.fungicideEventId ?? null,
          fertilityApplicationId: link.fertilityApplicationId ?? null,
          cropId: link.cropId ?? null,
          performedById: userId,
          notes: link.notes ?? null
        })
      )
      .run();
  };

  const lotNo = (prefix: string, at: number) => `${prefix}-${ymdOf(at).slice(2).replace(/-/g, '')}`;
  const receiptBefore = (first: number) => Math.min(first - 10 * DAY_MS, now - 21 * DAY_MS);

  // Crop protection and fertility: one lot per year the product was used.
  const usesByProduct = new Map<string, Map<number, { first: number; total: number }>>();
  const note = (pluginId: string, at: number, amount: number) => {
    const year = Number(ymdOf(at).slice(0, 4));
    const byYear = usesByProduct.get(pluginId) ?? new Map();
    const cur = byYear.get(year) ?? { first: at, total: 0 };
    cur.first = Math.min(cur.first, at);
    cur.total += amount;
    byYear.set(year, cur);
    usesByProduct.set(pluginId, byYear);
  };
  for (const s of t.sprays) {
    const p = DEMO_PRODUCTS[s.product];
    note(
      p.pluginId,
      s.at,
      s.kind === 'herbicide'
        ? (p.perAcreInUnit ?? 0) * bedAcres(DEMO_BEDS.find((b) => b.key === s.bed)!)
        : (p.perLoadInUnit ?? 0) * (s.sprayer === 'atv' ? 4 : 1)
    );
  }
  for (const f of t.fertility) {
    note(f.product, f.at, f.ratePerAcre * bedAcres(DEMO_BEDS.find((b) => b.key === f.bed)!));
  }
  for (const p of Object.values(DEMO_PRODUCTS)) {
    const item = createStockItem({
      category: p.kind,
      displayName: p.displayName,
      defaultUnit: p.unit,
      pluginId: p.pluginId,
      reorderThreshold: p.reorderAt
    });
    itemCount++;
    items.set(p.pluginId, item);
    const years = usesByProduct.get(p.pluginId) ?? new Map([[0, { first: now, total: 0 }]]);
    const lots = new Map<number, string>();
    for (const [year, use] of [...years.entries()].sort((a, b) => a[0] - b[0])) {
      const packs = Math.max(p.packs, Math.ceil(use.total / p.packSize));
      const at = receiptBefore(use.first);
      lots.set(
        year,
        insertLot({
          item,
          at,
          quantity: packs * p.packSize,
          costCents: packs * p.packCostCents,
          supplier: p.supplier,
          lotNumber: lotNo(p.pluginId.slice(0, 3).toUpperCase(), at),
          expiresAt: at + 3 * 365 * DAY_MS
        })
      );
    }
    lotByYear.set(p.pluginId, lots);
  }

  // Seed: what is on hand, what planting took, and what is on order.
  for (const s of DEMO_SEEDS) {
    const item = createStockItem({
      category: 'seed',
      displayName: s.displayName,
      defaultUnit: s.unit,
      pluginId: s.cropPluginId,
      reorderThreshold: s.reorderAt
    });
    itemCount++;
    const draws = t.plantings.filter((p) => {
      const tpl = templates.get(p.templateKey);
      return (
        tpl?.seed === s.key &&
        p.status !== 'planned' &&
        p.quantity?.unit === s.unit &&
        p.plantingDate <= now
      );
    });
    const first = Math.min(now, ...draws.map((d) => d.plantingDate));
    const at = receiptBefore(first);
    const total = draws.reduce((sum, d) => sum + (d.quantity?.amount ?? 0), 0);
    const lotId = insertLot({
      item,
      at,
      quantity: s.onHand + total,
      costCents: s.costCents || undefined,
      supplier: s.supplier,
      lotNumber: s.lotNumber
    });
    seedLot.set(s.key, lotId);
    for (const d of draws) {
      movement(lotId, d.quantity!.amount, zonedMs(ymdOf(d.plantingDate, 'UTC'), 8), {
        reason: 'planting',
        cropId: plantingId.get(d.key) ?? null,
        notes: L(`Planted ${d.variety}`)
      });
    }
    if (s.pending) {
      insertLot({
        item,
        at: now - 6 * DAY_MS,
        quantity: s.pending.quantity,
        costCents: s.pending.costCents,
        supplier: s.pending.supplier,
        status: s.pending.status,
        notes:
          s.pending.status === 'ordered'
            ? L('Order #48213, shipping this week.')
            : L('For fall planting.')
      });
    }
  }

  // Feed, bedding and the animal medicine cabinet.
  const feedMeta = (lbPerBag: number, scoopLb: number) =>
    JSON.stringify({ feed: { lbPerBag, scoopLb, scoopProvenance: 'manual' } });
  const layer = createStockItem({
    category: 'feed',
    displayName: 'Layer pellets 16% (50 lb)',
    defaultUnit: 'bag',
    reorderThreshold: 3,
    metadataJson: feedMeta(50, 1.5)
  });
  const goat = createStockItem({
    category: 'feed',
    displayName: 'Goat grain ration 16% (50 lb)',
    defaultUnit: 'bag',
    reorderThreshold: 1,
    metadataJson: feedMeta(50, 1)
  });
  const shavings = createStockItem({
    category: 'bedding',
    displayName: 'Pine shavings (3.25 cu ft)',
    defaultUnit: 'bag',
    reorderThreshold: 3
  });
  const dewormer = createStockItem({
    category: 'animal-health',
    displayName: 'Safe-Guard Suspension 10% (fenbendazole)',
    defaultUnit: 'ml',
    pluginId: 'safe-guard-suspension',
    metadataJson: JSON.stringify({ animalHealth: { pluginLink: 'manual' } })
  });
  itemCount += 4;
  const bags: Array<[StockItem, number, number, number, number[]]> = [
    [layer, 8, 2_199, 36, [31, 26, 21, 15, 9, 3]],
    [goat, 5, 2_349, 40, [33, 19, 6]],
    [shavings, 10, 749, 52, [48, 41, 34, 27, 20, 13, 9, 4]]
  ];
  for (const [item, quantity, each, daysAgo, useDays] of bags) {
    const lotId = insertLot({
      item,
      at: now - daysAgo * DAY_MS,
      quantity,
      costCents: quantity * each,
      supplier: 'Tractor Supply, Purcellville',
      lotNumber: lotNo('TSC', now - daysAgo * DAY_MS)
    });
    for (const d of useDays) {
      movement(lotId, 1, now - d * DAY_MS, { reason: 'animal-feed', notes: L('Opened a bag') });
    }
  }
  insertLot({
    item: dewormer,
    at: now - 300 * DAY_MS,
    quantity: 125,
    costCents: 2_899,
    supplier: 'Valley Vet Supply',
    lotNumber: 'SG-2210431',
    expiresAt: now + 20 * DAY_MS
  });

  return {
    get itemCount() {
      return itemCount;
    },
    get lotCount() {
      return lotCount;
    },
    itemId: (pluginId) => items.get(pluginId)?.id,
    seedLotId: (key) => seedLot.get(key),
    draw(pluginId, amount, at, link) {
      const lots = lotByYear.get(pluginId);
      if (!lots) return;
      const year = Number(ymdOf(at).slice(0, 4));
      const lotId = lots.get(year) ?? [...lots.values()].at(-1);
      if (lotId) movement(lotId, amount, at, link);
    },
    purchases
  };
}

// ─── animals ────────────────────────────────────────────────────────────

function writeAnimals(
  areaId: Map<DemoAreaKey, string>,
  userId: string,
  now: number
): { flock: string; goats: string; dog: string } {
  const flockSince = now - 420 * DAY_MS;
  const coop = areaId.get('coop')!;
  const flock = insertAnimalGroup(
    {
      name: L('Laying flock'),
      speciesId: 'chicken',
      purpose: 'production',
      headCount: DEMO_FLOCK_SIZE,
      foodProducing: true,
      housingFieldId: coop,
      notes: L('Buff Orpingtons, Australorps and a few Easter Eggers. Locked in at dusk.')
    },
    flockSince
  );
  insertStay({
    subject: { subjectType: 'group', subjectId: flock.id },
    fieldId: coop,
    atMs: flockSince,
    movedBy: userId
  });

  const goatsSince = now - 300 * DAY_MS;
  const pasture = areaId.get('goatPasture')!;
  const goats = insertAnimalGroup(
    {
      name: L('Dairy goats'),
      speciesId: 'goat',
      purpose: 'production',
      headCount: 0,
      foodProducing: true,
      housingFieldId: pasture,
      notes: L('Milked once a day at 7. Rotated between the east and west paddocks.')
    },
    goatsSince
  );
  insertStay({
    subject: { subjectType: 'group', subjectId: goats.id },
    fieldId: pasture,
    atMs: goatsSince,
    movedBy: userId
  });
  DEMO_GOATS.forEach((g, i) => {
    insertAnimal(
      {
        speciesId: 'goat',
        groupId: goats.id,
        name: g.name,
        tag: g.tag,
        sex: 'female',
        breed: g.breed,
        birthDate: Date.parse(`${addDaysYmd(ymdOf(now), -(3 * 365 + i * 130))}T00:00:00Z`),
        birthDateEstimated: i === 2,
        acquiredDate: goatsSince,
        acquiredFrom: 'Catoctin Creek Goat Dairy (fictional)',
        purpose: 'production',
        foodProducing: true,
        housingFieldId: pasture
      },
      goatsSince
    );
  });

  const dogSince = now - 900 * DAY_MS;
  const house = areaId.get('house')!;
  const dog = insertAnimal(
    {
      speciesId: 'dog',
      name: 'Biscuit',
      sex: 'neutered-male',
      breed: L('Australian Shepherd mix'),
      birthDate: dogSince - 200 * DAY_MS,
      birthDateEstimated: true,
      acquiredDate: dogSince,
      acquiredFrom: 'Loudoun County Animal Shelter',
      purpose: 'pet',
      foodProducing: false,
      housingFieldId: house,
      microchipId: '985 000 000 000 001 (demo)',
      feedingNote: L('2 cups kibble morning and evening. No chicken bones.')
    },
    dogSince
  );
  insertStay({
    subject: { subjectType: 'animal', subjectId: dog.id },
    fieldId: house,
    atMs: dogSince,
    movedBy: userId
  });
  return { flock: flock.id, goats: goats.id, dog: dog.id };
}

// ─── tasks ──────────────────────────────────────────────────────────────

function writeTask(task: {
  id?: string;
  title: string;
  body?: string | null;
  category: (typeof tasks.$inferInsert)['category'];
  due: number;
  cropId?: string | null;
  blockId?: string | null;
  equipmentId?: string | null;
  relatedEventTable?: (typeof tasks.$inferInsert)['relatedEventTable'];
  relatedEventId?: string | null;
  pluginTemplateKey?: string | null;
  completedAt?: number | null;
  createdById: string;
  createdAt: number;
}): void {
  db.insert(tasks)
    .values(
      tenantValues({
        id: task.id ?? randomUUID(),
        title: L(task.title),
        body: L(task.body ?? null),
        kind: 'primary' as const,
        cropId: task.cropId ?? null,
        blockId: task.blockId ?? null,
        equipmentId: task.equipmentId ?? null,
        scheduledFor: new Date(task.due),
        completedAt: task.completedAt != null ? new Date(task.completedAt) : null,
        relatedEventTable: task.relatedEventTable ?? null,
        relatedEventId: task.relatedEventId ?? null,
        pluginTemplateKey: task.pluginTemplateKey ?? null,
        category: task.category ?? null,
        createdById: task.createdById,
        createdAt: new Date(task.createdAt)
      })
    )
    .run();
}
