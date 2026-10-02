/**
 * Forage lab results and the facts behind the forage advisory (Phase 33C,
 * C4). Every read and write is tenant-scoped; the cross-tenant test covers
 * each function.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, gte, inArray, lte, or } from 'drizzle-orm';
import { db } from './client';
import {
  blocks,
  crops,
  documentLinks,
  fertilityApplications,
  fields,
  forageTests,
  hayCuttings,
  pushDeliveries,
  stockItems,
  stockLots
} from './schema';
import { tenantValues, withTenant } from './tenant';
import { currentPlantingsCutoff } from './blocks';
import { insertDocumentLink } from './documents';
import { parseLabRating, type ForageLabRating, type NitrateUnits } from '$lib/forage/model';

export interface ForageTestRow {
  id: string;
  blockId: string | null;
  hayCuttingId: string | null;
  stockLotId: string | null;
  sampledAt: number;
  lab: string | null;
  nitrateValue: number | null;
  nitrateUnits: NitrateUnits | null;
  hcnPpm: number | null;
  labRating: ForageLabRating | null;
  documentId: string | null;
  provenance: 'manual' | 'ai' | 'fallback';
  createdBy: string | null;
  createdAt: number;
}

export interface NewForageTest {
  blockId?: string | null;
  hayCuttingId?: string | null;
  stockLotId?: string | null;
  sampledAt: number;
  lab?: string | null;
  nitrateValue?: number | null;
  nitrateUnits?: NitrateUnits | null;
  hcnPpm?: number | null;
  labRating?: ForageLabRating | null;
  documentId?: string | null;
  createdBy: string | null;
}

const hundredths = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Math.round(n * 100);
const fromHundredths = (n: number | null) => (n === null ? null : n / 100);

function toRow(r: typeof forageTests.$inferSelect): ForageTestRow {
  return {
    id: r.id,
    blockId: r.blockId,
    hayCuttingId: r.hayCuttingId,
    stockLotId: r.stockLotId,
    sampledAt: r.sampledAt.getTime(),
    lab: r.lab,
    nitrateValue: fromHundredths(r.nitrateValueHundredths),
    nitrateUnits: r.nitrateUnits,
    hcnPpm: fromHundredths(r.hcnPpmHundredths),
    labRating: parseLabRating(r.labRatingJson),
    documentId: r.documentId,
    provenance: r.provenance,
    createdBy: r.createdBy,
    createdAt: r.createdAt.getTime()
  };
}

/** Saves a lab result (always `manual`, M-58) and links its report, in one
 *  transaction. */
export function insertForageTest(input: NewForageTest): ForageTestRow {
  const targets = [input.blockId, input.hayCuttingId, input.stockLotId].filter(Boolean);
  if (targets.length !== 1) throw new Error('a forage test needs exactly one target');
  const id = randomUUID();
  const rating = input.labRating && Object.keys(input.labRating).length ? input.labRating : null;
  return db.transaction(() => {
    db.insert(forageTests)
      .values(
        tenantValues({
          id,
          blockId: input.blockId ?? null,
          hayCuttingId: input.hayCuttingId ?? null,
          stockLotId: input.stockLotId ?? null,
          sampledAt: new Date(input.sampledAt),
          lab: input.lab ?? null,
          nitrateValueHundredths: hundredths(input.nitrateValue),
          nitrateUnits: input.nitrateUnits ?? null,
          hcnPpmHundredths: hundredths(input.hcnPpm),
          labRatingJson: rating ? JSON.stringify(rating) : null,
          documentId: input.documentId ?? null,
          provenance: 'manual' as const,
          createdBy: input.createdBy
        })
      )
      .run();
    if (input.documentId) {
      insertDocumentLink({
        documentId: input.documentId,
        subjectType: 'forage-test',
        subjectId: id,
        createdBy: input.createdBy
      });
    }
    return getForageTest(id)!;
  });
}

export function getForageTest(id: string): ForageTestRow | undefined {
  const r = db
    .select()
    .from(forageTests)
    .where(withTenant(forageTests, eq(forageTests.id, id)))
    .get();
  return r ? toRow(r) : undefined;
}

/** Deletes a test and its document links. The report stays in the vault. */
export function deleteForageTest(id: string): boolean {
  return db.transaction(() => {
    const res = db
      .delete(forageTests)
      .where(withTenant(forageTests, eq(forageTests.id, id)))
      .run();
    if (res.changes === 0) return false;
    db.delete(documentLinks)
      .where(
        withTenant(
          documentLinks,
          eq(documentLinks.subjectType, 'forage-test'),
          eq(documentLinks.subjectId, id)
        )
      )
      .run();
    return true;
  });
}

export interface ForageTestFilter {
  blockId?: string;
  hayCuttingId?: string;
  stockLotId?: string;
  blockIds?: readonly string[];
  hayCuttingIds?: readonly string[];
}

/** Tests on any of the targets named, newest sample first. An empty filter
 *  lists every test of the farm. */
export function listForageTests(filter: ForageTestFilter = {}): ForageTestRow[] {
  const blockIds = [...(filter.blockIds ?? []), ...(filter.blockId ? [filter.blockId] : [])];
  const cuttingIds = [
    ...(filter.hayCuttingIds ?? []),
    ...(filter.hayCuttingId ? [filter.hayCuttingId] : [])
  ];
  const named =
    filter.blockId !== undefined ||
    filter.hayCuttingId !== undefined ||
    filter.stockLotId !== undefined ||
    filter.blockIds !== undefined ||
    filter.hayCuttingIds !== undefined;
  const any = [
    blockIds.length ? inArray(forageTests.blockId, blockIds) : undefined,
    cuttingIds.length ? inArray(forageTests.hayCuttingId, cuttingIds) : undefined,
    filter.stockLotId ? eq(forageTests.stockLotId, filter.stockLotId) : undefined
  ].filter((c) => c !== undefined);
  if (named && any.length === 0) return [];
  return db
    .select()
    .from(forageTests)
    .where(withTenant(forageTests, any.length ? or(...any) : undefined))
    .orderBy(desc(forageTests.sampledAt), desc(forageTests.createdAt))
    .all()
    .map(toRow);
}

// ─── Advisory facts ─────────────────────────────────────────────────────

export interface ForageBlockFact {
  id: string;
  name: string;
  fieldId: string | null;
}

export interface ForagePlantingFact {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number | null;
}

export interface ForageCutFact {
  id: string;
  blockId: string;
  cropPluginId: string;
  cuttingNumber: number;
  /** The mow time, else the record time. */
  cutAt: number;
}

export interface ForageNitrogenFact {
  blockId: string;
  occurredAt: number;
}

export interface ForageAreaFacts {
  area: { id: string; name: string } | null;
  blocks: ForageBlockFact[];
  plantings: ForagePlantingFact[];
  cuts: ForageCutFact[];
  nitrogen: ForageNitrogenFact[];
}

export function getForageArea(fieldId: string): { id: string; name: string } | undefined {
  return db
    .select({ id: fields.id, name: fields.name })
    .from(fields)
    .where(withTenant(fields, eq(fields.id, fieldId)))
    .get();
}

function blockFacts(where: { fieldId?: string; blockId?: string }): ForageBlockFact[] {
  return db
    .select({ id: blocks.id, name: blocks.name, fieldId: blocks.fieldId })
    .from(blocks)
    .where(
      withTenant(
        blocks,
        where.fieldId ? eq(blocks.fieldId, where.fieldId) : undefined,
        where.blockId ? eq(blocks.id, where.blockId) : undefined
      )
    )
    .all();
}

/**
 * Crops in the ground on these blocks, with the same rule as the toxic-plant
 * advisory (`plantsInGroundByArea`): active, planned with a planting date
 * that has come, or harvested since Jan 1 of last year.
 */
function plantingsInGround(blockIds: readonly string[], now: number): ForagePlantingFact[] {
  if (blockIds.length === 0) return [];
  return db
    .select({
      id: crops.id,
      blockId: crops.blockId,
      cropPluginId: crops.cropPluginId,
      varietyDisplayName: crops.varietyDisplayName,
      plantingDate: crops.plantingDate
    })
    .from(crops)
    .where(
      withTenant(
        crops,
        inArray(crops.blockId, [...blockIds]),
        or(
          eq(crops.status, 'active'),
          and(eq(crops.status, 'planned'), lte(crops.plantingDate, new Date(now))),
          and(
            eq(crops.status, 'harvested'),
            gte(crops.plantingDate, new Date(currentPlantingsCutoff(now)))
          )
        )
      )
    )
    .all()
    .map((r) => ({ ...r, plantingDate: r.plantingDate ? r.plantingDate.getTime() : null }));
}

function cutFacts(blockIds: readonly string[]): ForageCutFact[] {
  if (blockIds.length === 0) return [];
  return db
    .select({
      id: hayCuttings.id,
      blockId: hayCuttings.blockId,
      cropPluginId: hayCuttings.cropPluginId,
      cuttingNumber: hayCuttings.cuttingNumber,
      mowAt: hayCuttings.mowAt,
      createdAt: hayCuttings.createdAt
    })
    .from(hayCuttings)
    .where(withTenant(hayCuttings, inArray(hayCuttings.blockId, [...blockIds])))
    .all()
    .map((r) => ({
      id: r.id,
      blockId: r.blockId,
      cropPluginId: r.cropPluginId,
      cuttingNumber: r.cuttingNumber,
      cutAt: (r.mowAt ?? r.createdAt).getTime()
    }));
}

function nitrogenFacts(blockIds: readonly string[]): ForageNitrogenFact[] {
  if (blockIds.length === 0) return [];
  return db
    .select({
      blockId: fertilityApplications.blockId,
      occurredAt: fertilityApplications.occurredAt
    })
    .from(fertilityApplications)
    .where(
      withTenant(
        fertilityApplications,
        inArray(fertilityApplications.blockId, [...blockIds]),
        gt(fertilityApplications.nDeliveredHundredths, 0)
      )
    )
    .all()
    .map((r) => ({ blockId: r.blockId, occurredAt: r.occurredAt.getTime() }));
}

/** What the advisory needs for one Area of the active Owner. */
export function forageFactsForArea(fieldId: string, now: number = Date.now()): ForageAreaFacts {
  const area = getForageArea(fieldId) ?? null;
  if (!area) return { area: null, blocks: [], plantings: [], cuts: [], nitrogen: [] };
  const bs = blockFacts({ fieldId });
  const ids = bs.map((b) => b.id);
  return {
    area,
    blocks: bs,
    plantings: plantingsInGround(ids, now),
    cuts: cutFacts(ids),
    nitrogen: nitrogenFacts(ids)
  };
}

/** The same facts for the block a hay cutting came off. */
export function forageFactsForBlock(blockId: string, now: number = Date.now()): ForageAreaFacts {
  const bs = blockFacts({ blockId });
  if (bs.length === 0) return { area: null, blocks: [], plantings: [], cuts: [], nitrogen: [] };
  const area = bs[0].fieldId ? (getForageArea(bs[0].fieldId) ?? null) : null;
  return {
    area,
    blocks: bs,
    plantings: plantingsInGround([blockId], now),
    cuts: cutFacts([blockId]),
    nitrogen: nitrogenFacts([blockId])
  };
}

/** Times a `frost-tonight` alert was sent to this farm since `sinceMs`. */
export function frostAlertTimes(sinceMs: number): number[] {
  return db
    .select({ sentAt: pushDeliveries.sentAt })
    .from(pushDeliveries)
    .where(
      withTenant(
        pushDeliveries,
        eq(pushDeliveries.kind, 'frost-tonight'),
        gte(pushDeliveries.sentAt, new Date(sinceMs))
      )
    )
    .all()
    .map((r) => r.sentAt.getTime());
}

/** The item category of one of this farm's stock lots. */
export function stockLotCategory(lotId: string): string | undefined {
  return db
    .select({ category: stockItems.category })
    .from(stockLots)
    .innerJoin(stockItems, and(eq(stockItems.id, stockLots.stockItemId), withTenant(stockItems)))
    .where(withTenant(stockLots, eq(stockLots.id, lotId)))
    .get()?.category;
}
