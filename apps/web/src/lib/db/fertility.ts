/**
 * Fertility / soil-test repository (Phase 10).
 *
 * Per-block N / P / K budget. The math is intentionally trivial — the value
 * is in the data model + UI surface, not the calculations.
 *
 * Phase 18a: tenant-scoped. Soil tests, applications, and credits all
 * filter by Owner; per-block budgets sum within the active tenant.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './client';
import { fertilityApplications, fertilityCredits, soilTests } from './schema';
import { tenantValues, withTenant } from './tenant';
import {
  parseLabRatings,
  type ExtractionMethod,
  type LabRatings,
  type UnitsBasis
} from '$lib/fertility/soilInterpret';
import { nutrientFromStorage, nutrientToStorage } from '$lib/fertility/applicationMath';

// ─── soil_tests ──────────────────────────────────────────────────────────

export interface SoilTestInput {
  blockId: string;
  sampledAt: number;
  lab?: string;
  reportPdfUrl?: string;
  ph?: number;
  cec?: number;
  organicMatterPct?: number;
  nitratePpm?: number;
  phosphorusPpm?: number;
  potassiumPpm?: number;
  notes?: string;
  /** Nutrient values are as typed on the lab sheet; `unitsBasis` says
   *  whether that was ppm or lb/acre. Missing means ppm. */
  unitsBasis?: UnitsBasis;
  extractionMethod?: ExtractionMethod;
  caPpm?: number;
  mgPpm?: number;
  bufferPh?: number;
  labRatings?: LabRatings;
  provenance?: 'manual' | 'ai' | 'fallback';
}

export interface SoilTest extends SoilTestInput {
  id: string;
  /** The lab report in the document vault (A-36), deleted or not. */
  documentId?: string;
}

function rowToSoilTest(row: typeof soilTests.$inferSelect): SoilTest {
  return {
    id: row.id,
    blockId: row.blockId,
    sampledAt: row.sampledAt.getTime(),
    lab: row.lab ?? undefined,
    reportPdfUrl: row.reportPdfUrl ?? undefined,
    ph: row.ph !== null ? row.ph / 100 : undefined,
    cec: row.cecHundredths !== null ? row.cecHundredths / 100 : undefined,
    organicMatterPct:
      row.organicMatterPctHundredths !== null ? row.organicMatterPctHundredths / 100 : undefined,
    nitratePpm: row.nitratePpm ?? undefined,
    phosphorusPpm: row.phosphorusPpm ?? undefined,
    potassiumPpm: row.potassiumPpm ?? undefined,
    notes: row.notes ?? undefined,
    unitsBasis: row.unitsBasis ?? undefined,
    extractionMethod: row.extractionMethod ?? undefined,
    caPpm: row.caPpm ?? undefined,
    mgPpm: row.mgPpm ?? undefined,
    bufferPh: row.bufferPhHundredths !== null ? row.bufferPhHundredths / 100 : undefined,
    labRatings: row.labRatingJson ? parseLabRatings(row.labRatingJson) : undefined,
    provenance: row.provenance ?? undefined,
    documentId: row.documentId ?? undefined
  };
}

export function insertSoilTest(input: SoilTestInput): SoilTest {
  const id = randomUUID();
  const row = db
    .insert(soilTests)
    .values(
      tenantValues({
        id,
        blockId: input.blockId,
        sampledAt: new Date(input.sampledAt),
        lab: input.lab ?? null,
        reportPdfUrl: input.reportPdfUrl ?? null,
        ph: input.ph !== undefined ? Math.round(input.ph * 100) : null,
        cecHundredths: input.cec !== undefined ? Math.round(input.cec * 100) : null,
        organicMatterPctHundredths:
          input.organicMatterPct !== undefined ? Math.round(input.organicMatterPct * 100) : null,
        nitratePpm: input.nitratePpm ?? null,
        phosphorusPpm: input.phosphorusPpm ?? null,
        potassiumPpm: input.potassiumPpm ?? null,
        notes: input.notes ?? null,
        unitsBasis: input.unitsBasis ?? null,
        extractionMethod: input.extractionMethod ?? null,
        caPpm: input.caPpm ?? null,
        mgPpm: input.mgPpm ?? null,
        bufferPhHundredths: input.bufferPh !== undefined ? Math.round(input.bufferPh * 100) : null,
        labRatingJson:
          input.labRatings && Object.keys(input.labRatings).length
            ? JSON.stringify(input.labRatings)
            : null,
        provenance: input.provenance ?? 'manual'
      })
    )
    .returning()
    .get();
  return rowToSoilTest(row);
}

export function listSoilTestsForBlock(blockId: string): SoilTest[] {
  return db
    .select()
    .from(soilTests)
    .where(withTenant(soilTests, eq(soilTests.blockId, blockId)))
    .orderBy(desc(soilTests.sampledAt))
    .all()
    .map(rowToSoilTest);
}

/** Every soil test on the active Owner's farm, newest first. */
export function listSoilTests(): SoilTest[] {
  return db
    .select()
    .from(soilTests)
    .where(withTenant(soilTests))
    .orderBy(desc(soilTests.sampledAt), desc(soilTests.id))
    .all()
    .map(rowToSoilTest);
}

export function hasSoilTest(): boolean {
  return (
    db.select({ id: soilTests.id }).from(soilTests).where(withTenant(soilTests)).limit(1).get() !==
    undefined
  );
}

// ─── fertility_applications ──────────────────────────────────────────────

export interface FertilityApplicationInput {
  blockId: string;
  cropId?: string;
  occurredAt: number;
  source: string;
  stockItemId?: string;
  ratePerAcre: number;
  rateUnit: string;
  /** N, P₂O₅ and K₂O delivered; missing or null is not known (#738). */
  nLbPerAcre?: number | null;
  pLbPerAcre?: number | null;
  kLbPerAcre?: number | null;
  performedById?: string;
  notes?: string;
  /** The manure or compost batch spread (33C). */
  amendmentBatchId?: string;
  /** The stored carryover confirmation, `CarryoverAck` as JSON (M-46). */
  carryoverAckJson?: string;
}

export interface FertilityApplication extends FertilityApplicationInput {
  id: string;
}

function rowToApplication(row: typeof fertilityApplications.$inferSelect): FertilityApplication {
  return {
    id: row.id,
    blockId: row.blockId,
    cropId: row.cropId ?? undefined,
    occurredAt: row.occurredAt.getTime(),
    source: row.source,
    stockItemId: row.stockItemId ?? undefined,
    ratePerAcre: row.ratePerAcreHundredths / 100,
    rateUnit: row.rateUnit,
    nLbPerAcre: nutrientFromStorage(row.nDeliveredHundredths),
    pLbPerAcre: nutrientFromStorage(row.pDeliveredHundredths),
    kLbPerAcre: nutrientFromStorage(row.kDeliveredHundredths),
    performedById: row.performedById ?? undefined,
    notes: row.notes ?? undefined,
    amendmentBatchId: row.amendmentBatchId ?? undefined,
    carryoverAckJson: row.carryoverAckJson ?? undefined
  };
}

export function insertFertilityApplication(input: FertilityApplicationInput): FertilityApplication {
  const id = randomUUID();
  const row = db
    .insert(fertilityApplications)
    .values(
      tenantValues({
        id,
        blockId: input.blockId,
        cropId: input.cropId ?? null,
        occurredAt: new Date(input.occurredAt),
        source: input.source,
        stockItemId: input.stockItemId ?? null,
        ratePerAcreHundredths: Math.round(input.ratePerAcre * 100),
        rateUnit: input.rateUnit,
        nDeliveredHundredths: nutrientToStorage(input.nLbPerAcre),
        pDeliveredHundredths: nutrientToStorage(input.pLbPerAcre),
        kDeliveredHundredths: nutrientToStorage(input.kLbPerAcre),
        performedById: input.performedById ?? null,
        notes: input.notes ?? null,
        amendmentBatchId: input.amendmentBatchId ?? null,
        carryoverAckJson: input.carryoverAckJson ?? null
      })
    )
    .returning()
    .get();
  return rowToApplication(row);
}

export function getFertilityApplication(id: string): FertilityApplication | undefined {
  const row = db
    .select()
    .from(fertilityApplications)
    .where(withTenant(fertilityApplications, eq(fertilityApplications.id, id)))
    .get();
  return row ? rowToApplication(row) : undefined;
}

export function listFertilityApplicationsForBlock(blockId: string): FertilityApplication[] {
  return db
    .select()
    .from(fertilityApplications)
    .where(withTenant(fertilityApplications, eq(fertilityApplications.blockId, blockId)))
    .orderBy(desc(fertilityApplications.occurredAt))
    .all()
    .map(rowToApplication);
}

// ─── fertility_credits ───────────────────────────────────────────────────

export interface FertilityCreditInput {
  blockId: string;
  appliesToYear: number;
  source: string;
  cropPluginId?: string;
  nLbPerAcre?: number;
  pLbPerAcre?: number;
  kLbPerAcre?: number;
  notes?: string;
}

export interface FertilityCredit extends FertilityCreditInput {
  id: string;
  createdAt: number;
}

function rowToCredit(row: typeof fertilityCredits.$inferSelect): FertilityCredit {
  return {
    id: row.id,
    blockId: row.blockId,
    appliesToYear: row.appliesToYear,
    source: row.source,
    cropPluginId: row.cropPluginId ?? undefined,
    nLbPerAcre: row.nLbPerAcreHundredths / 100,
    pLbPerAcre: row.pLbPerAcreHundredths / 100,
    kLbPerAcre: row.kLbPerAcreHundredths / 100,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.getTime()
  };
}

export function insertFertilityCredit(input: FertilityCreditInput): FertilityCredit {
  const id = randomUUID();
  const row = db
    .insert(fertilityCredits)
    .values(
      tenantValues({
        id,
        blockId: input.blockId,
        appliesToYear: input.appliesToYear,
        source: input.source,
        cropPluginId: input.cropPluginId ?? null,
        nLbPerAcreHundredths: Math.round((input.nLbPerAcre ?? 0) * 100),
        pLbPerAcreHundredths: Math.round((input.pLbPerAcre ?? 0) * 100),
        kLbPerAcreHundredths: Math.round((input.kLbPerAcre ?? 0) * 100),
        notes: input.notes ?? null
      })
    )
    .returning()
    .get();
  return rowToCredit(row);
}

export function listFertilityCreditsForBlock(blockId: string, year?: number): FertilityCredit[] {
  const conds = [eq(fertilityCredits.blockId, blockId)];
  if (year !== undefined) conds.push(eq(fertilityCredits.appliesToYear, year));
  return db
    .select()
    .from(fertilityCredits)
    .where(withTenant(fertilityCredits, and(...conds)))
    .orderBy(desc(fertilityCredits.createdAt))
    .all()
    .map(rowToCredit);
}

// ─── Per-block budget summary ────────────────────────────────────────────

export interface FertilityBudget {
  blockId: string;
  year: number;
  nDeliveredLbPerAcre: number;
  pDeliveredLbPerAcre: number;
  kDeliveredLbPerAcre: number;
  nCreditedLbPerAcre: number;
  pCreditedLbPerAcre: number;
  kCreditedLbPerAcre: number;
  totalNLbPerAcre: number;
  totalPLbPerAcre: number;
  totalKLbPerAcre: number;
  /** Applications this year with that nutrient not known; the delivered
   *  and total figures are then a lower bound (#738). */
  nUnknownApplications: number;
  pUnknownApplications: number;
  kUnknownApplications: number;
}

export function fertilityBudgetForBlock(blockId: string, year: number): FertilityBudget {
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const apps = listFertilityApplicationsForBlock(blockId).filter(
    (a) => a.occurredAt >= yearStart && a.occurredAt < yearEnd
  );
  const credits = listFertilityCreditsForBlock(blockId, year);

  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const nDelivered = sum(apps.map((a) => a.nLbPerAcre ?? 0));
  const pDelivered = sum(apps.map((a) => a.pLbPerAcre ?? 0));
  const kDelivered = sum(apps.map((a) => a.kLbPerAcre ?? 0));
  const nCredited = sum(credits.map((c) => c.nLbPerAcre ?? 0));
  const pCredited = sum(credits.map((c) => c.pLbPerAcre ?? 0));
  const kCredited = sum(credits.map((c) => c.kLbPerAcre ?? 0));

  return {
    blockId,
    year,
    nDeliveredLbPerAcre: nDelivered,
    pDeliveredLbPerAcre: pDelivered,
    kDeliveredLbPerAcre: kDelivered,
    nCreditedLbPerAcre: nCredited,
    pCreditedLbPerAcre: pCredited,
    kCreditedLbPerAcre: kCredited,
    totalNLbPerAcre: nDelivered + nCredited,
    totalPLbPerAcre: pDelivered + pCredited,
    totalKLbPerAcre: kDelivered + kCredited,
    nUnknownApplications: apps.filter((a) => a.nLbPerAcre == null).length,
    pUnknownApplications: apps.filter((a) => a.pLbPerAcre == null).length,
    kUnknownApplications: apps.filter((a) => a.kLbPerAcre == null).length
  };
}
