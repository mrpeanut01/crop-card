/**
 * Shared seed-quantity ↔ plant-count math (Phase 14e).
 *
 * Promoted out of `SeedQuantityModal.svelte` so the AI allocation wizard,
 * the layout engine, and the existing modal all use the same conversion.
 *
 * Conversion priority (most to least precise):
 *   1. Plugin `seedsPerLb` → exact when present.
 *   2. Plugin `seedsPerAcre` ÷ `recommendedLbsPerAcre` → derived.
 *   3. Family default (1500 grain/corn, 30000 vegetable) — rough.
 *
 * Germination is applied as a flat multiplier (default 0.85 if not given).
 * The output is "plants reasonably expected to emerge," not raw seed count.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import { resolveSeedsPerLb } from '$lib/plugins/familyDefaults';

export type SeedUnit = 'lb' | 'oz' | 'g' | 'kg' | 'seeds' | 'packets' | 'count';

/** Subset of CropPlugin we actually read. Lets clients build a thin
 *  object from plantingGuides + cropCatalog without holding the whole
 *  plugin Zod-validated shape in browser-side data. */
export interface SeedPluginShape {
  cropFamily?: string;
  plantingGuide?: {
    seedsPerLb?: number;
    seedsPerAcre?: number;
    recommendedLbsPerAcre?: number;
  };
}

const GRAMS_PER_LB = 453.592;
const OZ_PER_LB = 16;
const G_PER_KG = 1000;

const FAMILY_FALLBACK = 30000;
const PACKET_SEED_DEFAULT = 50;
const DEFAULT_GERMINATION = 0.85;

// B2 — family-keyed seeds-per-lb table moved to `plugins/familyDefaults.ts`.
// Conversion priority: plugin `plantingGuide.seedsPerLb` (direct) → derived
// from seedsPerAcre/lbsPerAcre → family default → null.
export function seedsPerLb(plugin: SeedPluginShape | CropPlugin | undefined): number | null {
  if (!plugin) return null;
  const { seedsPerLb } = resolveSeedsPerLb(plugin);
  if (seedsPerLb !== null) return seedsPerLb;
  // Last-ditch fallback for unknown families when the plugin only declares
  // seedsPerAcre. Preserves prior behavior for `FAMILY_FALLBACK`.
  if (plugin.plantingGuide?.seedsPerAcre) return FAMILY_FALLBACK;
  return null;
}

export interface SeedsToPlantsInput {
  unit: SeedUnit | string;
  quantity: number;
  plugin: SeedPluginShape | CropPlugin | undefined;
  /** 0..1; defaults to 0.85 when not provided. */
  germinationPct?: number;
  /** Override the derived seeds-per-lb (when stock metadata knows it
   *  precisely, e.g. lot-specific seed weight from the supplier). */
  seedsPerLbOverride?: number;
  /** Seeds per packet; defaults to 50. */
  seedsPerPacket?: number;
}

export interface SeedsToPlantsResult {
  /** Raw seeds the supplied quantity represents. */
  rawSeeds: number;
  /** Plants expected to emerge (rawSeeds × germination). */
  plants: number;
  /** True when conversion fell back to a family default (lower confidence). */
  fellBackToFamilyDefault: boolean;
}

export function seedsToPlants(input: SeedsToPlantsInput): SeedsToPlantsResult | null {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) return null;
  const germ = clampGermination(input.germinationPct);
  const unit = input.unit;

  if (unit === 'seeds') {
    const raw = input.quantity;
    return { rawSeeds: raw, plants: Math.round(raw * germ), fellBackToFamilyDefault: false };
  }

  if (unit === 'count') {
    // `count` is used for transplants, plugs, packet labels like "25 count" —
    // the quantity already represents discrete plantable units, so no
    // germination discount is applied. 1 count → 1 plant.
    return {
      rawSeeds: input.quantity,
      plants: Math.round(input.quantity),
      fellBackToFamilyDefault: false
    };
  }

  if (unit === 'packets') {
    const seedsPerPacket = input.seedsPerPacket ?? PACKET_SEED_DEFAULT;
    const raw = input.quantity * seedsPerPacket;
    return { rawSeeds: raw, plants: Math.round(raw * germ), fellBackToFamilyDefault: false };
  }

  const sPerLb = input.seedsPerLbOverride ?? seedsPerLb(input.plugin);
  if (sPerLb === null) return null;
  const lbs = toPounds(input.quantity, unit);
  if (lbs === null) return null;
  const raw = lbs * sPerLb;

  const fellBack = derivationWasFamilyFallback(input.plugin, input.seedsPerLbOverride);

  return {
    rawSeeds: raw,
    plants: Math.round(raw * germ),
    fellBackToFamilyDefault: fellBack
  };
}

export function plantsToLbs(
  plants: number,
  plugin: SeedPluginShape | CropPlugin | undefined,
  germinationPct?: number
): number | null {
  const sPerLb = seedsPerLb(plugin);
  if (sPerLb === null || sPerLb <= 0) return null;
  const germ = clampGermination(germinationPct);
  if (germ <= 0) return null;
  const rawSeeds = plants / germ;
  return rawSeeds / sPerLb;
}

function toPounds(quantity: number, unit: string): number | null {
  if (unit === 'lb') return quantity;
  if (unit === 'oz') return quantity / OZ_PER_LB;
  if (unit === 'g') return quantity / GRAMS_PER_LB;
  if (unit === 'kg') return (quantity * G_PER_KG) / GRAMS_PER_LB;
  return null;
}

function clampGermination(pct: number | undefined): number {
  if (pct === undefined || pct === null || !Number.isFinite(pct)) return DEFAULT_GERMINATION;
  if (pct <= 0) return 0;
  if (pct > 1) return 1;
  return pct;
}

function derivationWasFamilyFallback(
  plugin: SeedPluginShape | CropPlugin | undefined,
  override: number | undefined
): boolean {
  if (override !== undefined) return false;
  if (!plugin) return false;
  const guide = plugin.plantingGuide;
  if (guide?.seedsPerAcre && guide?.recommendedLbsPerAcre) return false;
  return true;
}
