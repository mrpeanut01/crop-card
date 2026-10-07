/**
 * GPA-aware dilution calculator (FR-02, FR-12).
 *
 * Reads rates exclusively from the herbicide plugin — zero hardcoded rates.
 * Scales the plugin's published per-tank amounts by the operator's calibrated
 * GPA so a sprayer that delivers 18 GPA gets a 20% increase over a plugin
 * calibrated for 15 GPA, etc.
 *
 * Custom-rate overrides (FR-02) are caller-driven: pass `customRatePerAcre`
 * to bypass the plugin's `ratePerAcre`. Use of an override is a UI-level
 * acknowledgment that gets stamped on the spray record.
 */

import type { HerbicidePlugin } from '$lib/plugins/schemas';

type RateUnit = NonNullable<HerbicidePlugin['ratePerAcre']>['unit'];

export interface DilutionInput {
  herbicide: HerbicidePlugin;
  /** Operator's calibrated gallons-per-acre, from FR-12. Defaults to the
   *  plugin's gpaCalibration so a calibrated-as-published sprayer is a no-op. */
  calibratedGpa?: number;
  /** Tank size in gallons, e.g. 50. Must be a positive integer. */
  tankSizeGallons: number;
  /** Optional override of the plugin's per-acre rate. */
  customRatePerAcre?: { amount: number; unit: RateUnit };
}

export interface DilutionLine {
  pluginId: string;
  displayName: string;
  productAmount: number;
  unit: RateUnit;
  display: string;
  acresCovered: number;
  gpaUsed: number;
  ratePerAcre: { amount: number; unit: RateUnit };
  customRateApplied: boolean;
}

/**
 * Convert an amount to fluid ounces for arithmetic, then back to the original
 * unit at the end. Liquid-only — solid units (lb, oz) are returned as-is.
 */
const FL_OZ_PER_UNIT: Record<RateUnit, number | null> = {
  'fl-oz': 1,
  pt: 16,
  qt: 32,
  oz: null,
  lb: null
};

function toFlOz(amount: number, unit: RateUnit): number | null {
  const factor = FL_OZ_PER_UNIT[unit];
  return factor === null ? null : amount * factor;
}

function formatDisplay(amount: number, unit: RateUnit): string {
  const rounded = Math.round(amount * 100) / 100;
  return `${rounded} ${unit}`;
}

export function computeDilution(input: DilutionInput): DilutionLine {
  const { herbicide, tankSizeGallons } = input;
  if (!Number.isFinite(tankSizeGallons) || tankSizeGallons <= 0) {
    throw new Error('tankSizeGallons must be a positive number');
  }

  const ratePerAcre = input.customRatePerAcre ?? herbicide.ratePerAcre;
  if (!ratePerAcre) throw new Error(`${herbicide.pluginId} has no label rate on file`);
  const gpaUsed = input.calibratedGpa ?? herbicide.gpaCalibration ?? 15;
  if (gpaUsed <= 0) throw new Error('calibratedGpa must be positive');

  const acresCovered = tankSizeGallons / gpaUsed;

  // Solid units don't scale linearly via fl-oz — we still scale by acres.
  const ratePerAcreFlOz = toFlOz(ratePerAcre.amount, ratePerAcre.unit);
  if (ratePerAcreFlOz === null) {
    const amount = ratePerAcre.amount * acresCovered;
    return {
      pluginId: herbicide.pluginId,
      displayName: herbicide.displayName,
      productAmount: amount,
      unit: ratePerAcre.unit,
      display: formatDisplay(amount, ratePerAcre.unit),
      acresCovered,
      gpaUsed,
      ratePerAcre,
      customRateApplied: input.customRatePerAcre != null
    };
  }

  const totalFlOz = ratePerAcreFlOz * acresCovered;
  // Render in the source unit so 1pt/A on a 25gal tank returns "1.67 pt".
  const factor = FL_OZ_PER_UNIT[ratePerAcre.unit] ?? 1;
  const amountInSourceUnit = totalFlOz / factor;

  return {
    pluginId: herbicide.pluginId,
    displayName: herbicide.displayName,
    productAmount: amountInSourceUnit,
    unit: ratePerAcre.unit,
    display: formatDisplay(amountInSourceUnit, ratePerAcre.unit),
    acresCovered,
    gpaUsed,
    ratePerAcre,
    customRateApplied: input.customRatePerAcre != null
  };
}

/**
 * Compute dilutions for a tank-mix of products at the same tank size.
 * Tank-mix order is presented separately (FR-04) by the kernel.
 */
export function computeTankMixDilutions(
  products: HerbicidePlugin[],
  tankSizeGallons: number,
  calibratedGpa?: number
): DilutionLine[] {
  return products
    .filter((herbicide) => herbicide.ratePerAcre)
    .map((herbicide) => computeDilution({ herbicide, tankSizeGallons, calibratedGpa }));
}

/** #737 — products with no label rate on file. They get no mix amount; the
 *  spray flow says "Check the label" for them instead. */
export function productsWithoutRate(products: HerbicidePlugin[]): string[] {
  return products.filter((p) => !p.ratePerAcre).map((p) => p.pluginId);
}

/**
 * Generic per-product dilution math — used by the insecticide flow, which
 * carries a minimal product shape. Equivalent to `computeDilution` but
 * decoupled from HerbicidePlugin so non-herbicide consumers don't have to
 * fabricate one. (Pricing/stock-decrement only — no safety semantics.)
 */
export interface RatedProduct {
  pluginId: string;
  displayName: string;
  ratePerAcre: { amount: number; unit: RateUnit };
  gpaCalibration?: number;
}

export function computeRatedDilution(
  product: RatedProduct,
  tankSizeGallons: number,
  calibratedGpa?: number
): DilutionLine {
  if (!Number.isFinite(tankSizeGallons) || tankSizeGallons <= 0) {
    throw new Error('tankSizeGallons must be a positive number');
  }
  const ratePerAcre = product.ratePerAcre;
  const gpaUsed = calibratedGpa ?? product.gpaCalibration ?? 15;
  if (gpaUsed <= 0) throw new Error('calibratedGpa must be positive');

  const acresCovered = tankSizeGallons / gpaUsed;
  const ratePerAcreFlOz = toFlOz(ratePerAcre.amount, ratePerAcre.unit);
  if (ratePerAcreFlOz === null) {
    const amount = ratePerAcre.amount * acresCovered;
    return {
      pluginId: product.pluginId,
      displayName: product.displayName,
      productAmount: amount,
      unit: ratePerAcre.unit,
      display: formatDisplay(amount, ratePerAcre.unit),
      acresCovered,
      gpaUsed,
      ratePerAcre,
      customRateApplied: false
    };
  }
  const totalFlOz = ratePerAcreFlOz * acresCovered;
  const factor = FL_OZ_PER_UNIT[ratePerAcre.unit] ?? 1;
  const amountInSourceUnit = totalFlOz / factor;
  return {
    pluginId: product.pluginId,
    displayName: product.displayName,
    productAmount: amountInSourceUnit,
    unit: ratePerAcre.unit,
    display: formatDisplay(amountInSourceUnit, ratePerAcre.unit),
    acresCovered,
    gpaUsed,
    ratePerAcre,
    customRateApplied: false
  };
}
