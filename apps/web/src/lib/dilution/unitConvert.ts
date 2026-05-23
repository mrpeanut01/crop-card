/**
 * Phase 21b follow-up — multi-unit formatting for the Spray Card.
 *
 * The dilution calculator's native unit comes from the herbicide
 * plugin's `ratePerAcre.unit` (fl-oz, pt, qt, oz, lb). The print
 * spray card surfaces a secondary unit so the operator can pour
 * confidently regardless of which jug / measuring vessel they have
 * in hand. Liquid amounts also include mL (for label-printed metric
 * markings).
 *
 * Liquid conversions are exact (US measure):
 *   1 fl-oz = 29.5735296875 mL
 *   1 qt    = 32 fl-oz       = 946.352947  mL
 *   1 pt    = 16 fl-oz       = 473.176473  mL
 * Solid conversions:
 *   1 oz   = 28.3495231 g
 *   1 lb   = 453.59237  g    = 16 oz
 */

export type DilutionUnit = 'fl-oz' | 'pt' | 'qt' | 'oz' | 'lb';

const ML_PER_FL_OZ = 29.5735296875;
const G_PER_OZ = 28.3495231;
const G_PER_LB = 453.59237;
const FL_OZ_PER_QT = 32;
const FL_OZ_PER_PT = 16;
const OZ_PER_LB = 16;

/**
 * Round to two decimals for display. Avoids the "0.7000000000000001"
 * float artifact when the operator's amount is something like
 * 0.35 qt × 2.
 */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
function r0(n: number): number {
  return Math.round(n);
}

/**
 * Pretty-print an amount in a single unit. Native API for the rest
 * of the Spray Card to use when the secondary unit isn't needed.
 */
export function fmtAmount(amount: number, unit: DilutionUnit): string {
  return `${r2(amount)} ${unit}`;
}

/**
 * Return a list of secondary-unit representations of an amount. The
 * native unit is NOT included — caller already has it. Liquid amounts
 * pick up qt + mL (or fl-oz + mL when native = qt). Solid amounts
 * pick up the alternate weight unit + grams.
 *
 * The output is ordered so the most operator-useful unit comes first
 * (the unit the operator's measuring cup likely shows).
 */
export function secondaryUnits(amount: number, unit: DilutionUnit): string[] {
  const out: string[] = [];
  if (unit === 'fl-oz') {
    const qt = amount / FL_OZ_PER_QT;
    const ml = amount * ML_PER_FL_OZ;
    if (qt >= 0.25) out.push(`${r2(qt)} qt`);
    out.push(`${r0(ml)} mL`);
  } else if (unit === 'pt') {
    const flOz = amount * FL_OZ_PER_PT;
    const qt = amount / 2;
    const ml = flOz * ML_PER_FL_OZ;
    out.push(`${r2(qt)} qt`);
    out.push(`${r2(flOz)} fl-oz`);
    out.push(`${r0(ml)} mL`);
  } else if (unit === 'qt') {
    const flOz = amount * FL_OZ_PER_QT;
    const ml = flOz * ML_PER_FL_OZ;
    out.push(`${r2(flOz)} fl-oz`);
    out.push(`${r0(ml)} mL`);
  } else if (unit === 'oz') {
    const lb = amount / OZ_PER_LB;
    const g = amount * G_PER_OZ;
    if (lb >= 0.1) out.push(`${r2(lb)} lb`);
    out.push(`${r0(g)} g`);
  } else if (unit === 'lb') {
    const oz = amount * OZ_PER_LB;
    const g = amount * G_PER_LB;
    out.push(`${r2(oz)} oz`);
    out.push(`${r0(g)} g`);
  }
  return out;
}

/**
 * Build the 3-row fill-increment table used on the Spray Card. The
 * "recommended" row is the exact water-fill needed for the remaining
 * acreage in the LAST tank of the pass — i.e., what the operator
 * mixes when the last tank can't be full. The lower / upper rows
 * are the nearest round-number tank levels above + below so the
 * operator can fill to a sight-glass mark and adjust chemical.
 *
 * For full tanks (every tank before the last) the math is trivial:
 * fill to capacity, mix per-tank-full chemical. Those tanks don't
 * need an increment table — they're "fill to {tankSize} gal" by
 * definition. This helper returns the increments for the LAST tank.
 */
export interface FillIncrement {
  waterGallons: number;
  /** True when this is the exact recommended fill (not a round number). */
  recommended: boolean;
  /** Acres this fill volume covers at the given GPA. */
  acresCovered: number;
  /** Chemical to add at this fill level, in the chemical's native unit. */
  chemicalAmount: number;
}

export function buildLastTankFills(
  remainingAcres: number,
  gpa: number,
  ratePerAcre: number,
  tankSize: number
): FillIncrement[] {
  if (remainingAcres <= 0 || gpa <= 0 || ratePerAcre <= 0) return [];
  const recommendedFill = Math.min(tankSize, remainingAcres * gpa);
  // Round to nearest 5-gallon below and above. Floor for the lower
  // (always strictly less than recommended) and ceil for the upper
  // (always strictly greater). Drop options that fall outside the
  // tank's physical capacity or below zero.
  const STEP = 5;
  const lower = Math.max(0, Math.floor(recommendedFill / STEP) * STEP);
  const upper = Math.min(tankSize, Math.ceil(recommendedFill / STEP) * STEP);
  const candidates = [
    { waterGallons: lower, recommended: false },
    { waterGallons: recommendedFill, recommended: true },
    { waterGallons: upper, recommended: false }
  ];
  // Dedupe — when recommended is itself a 5-gallon multiple, lower or
  // upper collide. Keep the "recommended: true" copy.
  const seen = new Map<number, FillIncrement>();
  for (const c of candidates) {
    if (c.waterGallons <= 0) continue;
    const acresCovered = c.waterGallons / gpa;
    const chemicalAmount = acresCovered * ratePerAcre;
    const existing = seen.get(c.waterGallons);
    if (existing && !c.recommended) continue;
    seen.set(c.waterGallons, {
      waterGallons: c.waterGallons,
      recommended: c.recommended,
      acresCovered,
      chemicalAmount
    });
  }
  return [...seen.values()].sort((a, b) => a.waterGallons - b.waterGallons);
}
