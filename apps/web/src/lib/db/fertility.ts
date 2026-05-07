/**
 * Fertility / soil-test repository (Phase 10).
 *
 * Per-block N / P / K budget. The math is intentionally trivial — the value
 * is in the data model + UI surface, not the calculations:
 *
 *   delivered  = sum(fertility_applications.{n,p,k}_delivered_hundredths)
 *   credits    = sum(fertility_credits.{n,p,k}_lb_per_acre_hundredths)
 *   remaining  = (cropDemand × acres) - delivered - credits
 *
 * Quantities stored as integer hundredths to match stock-management
 * precision. cropDemand comes from the crop plugin (default tables) or
 * an explicit operator override on /fertility.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './client';
import { fertilityApplications, fertilityCredits, soilTests } from './schema';

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
}

export interface SoilTest extends SoilTestInput {
  id: string;
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
      row.organicMatterPctHundredths !== null
        ? row.organicMatterPctHundredths / 100
        : undefined,
    nitratePpm: row.nitratePpm ?? undefined,
    phosphorusPpm: row.phosphorusPpm ?? undefined,
    potassiumPpm: row.potassiumPpm ?? undefined,
    notes: row.notes ?? undefined
  };
}

export function insertSoilTest(input: SoilTestInput): SoilTest {
  const id = randomUUID();
  const row = db
    .insert(soilTests)
    .values({
      id,
      blockId: input.blockId,
      sampledAt: new Date(input.sampledAt),
      lab: input.lab ?? null,
      reportPdfUrl: input.reportPdfUrl ?? null,
      ph: input.ph !== undefined ? Math.round(input.ph * 100) : null,
      cecHundredths: input.cec !== undefined ? Math.round(input.cec * 100) : null,
      organicMatterPctHundredths:
        input.organicMatterPct !== undefined
          ? Math.round(input.organicMatterPct * 100)
          : null,
      nitratePpm: input.nitratePpm ?? null,
      phosphorusPpm: input.phosphorusPpm ?? null,
      potassiumPpm: input.potassiumPpm ?? null,
      notes: input.notes ?? null
    })
    .returning()
    .get();
  return rowToSoilTest(row);
}

export function listSoilTestsForBlock(blockId: string): SoilTest[] {
  return db
    .select()
    .from(soilTests)
    .where(eq(soilTests.blockId, blockId))
    .orderBy(desc(soilTests.sampledAt))
    .all()
    .map(rowToSoilTest);
}

// ─── fertility_applications ──────────────────────────────────────────────

export interface FertilityApplicationInput {
  blockId: string;
  occurredAt: number;
  source: string;
  stockItemId?: string;
  ratePerAcre: number;
  rateUnit: string;
  /** Pounds of nutrient delivered per acre. */
  nLbPerAcre?: number;
  pLbPerAcre?: number;
  kLbPerAcre?: number;
  performedById?: string;
  notes?: string;
}

export interface FertilityApplication extends FertilityApplicationInput {
  id: string;
}

function rowToApplication(
  row: typeof fertilityApplications.$inferSelect
): FertilityApplication {
  return {
    id: row.id,
    blockId: row.blockId,
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
  };
}

export function insertFertilityApplication(
  input: FertilityApplicationInput
): FertilityApplication {
  const id = randomUUID();
  const row = db
    .insert(fertilityApplications)
    .values({
      id,
      blockId: input.blockId,
      occurredAt: new Date(input.occurredAt),
      source: input.source,
      stockItemId: input.stockItemId ?? null,
      ratePerAcreHundredths: Math.round(input.ratePerAcre * 100),
      rateUnit: input.rateUnit,
      nDeliveredHundredths: Math.round((input.nLbPerAcre ?? 0) * 100),
      pDeliveredHundredths: Math.round((input.pLbPerAcre ?? 0) * 100),
      kDeliveredHundredths: Math.round((input.kLbPerAcre ?? 0) * 100),
      performedById: input.performedById ?? null,
      notes: input.notes ?? null
    })
    .returning()
    .get();
  return rowToApplication(row);
}

export function listFertilityApplicationsForBlock(blockId: string): FertilityApplication[] {
  return db
    .select()
    .from(fertilityApplications)
    .where(eq(fertilityApplications.blockId, blockId))
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
    .values({
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
    .returning()
    .get();
  return rowToCredit(row);
}

export function listFertilityCreditsForBlock(
  blockId: string,
  year?: number
): FertilityCredit[] {
  const conds = [eq(fertilityCredits.blockId, blockId)];
  if (year !== undefined) conds.push(eq(fertilityCredits.appliesToYear, year));
  return db
    .select()
    .from(fertilityCredits)
    .where(and(...conds))
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
    totalKLbPerAcre: kDelivered + kCredited
  };
}
