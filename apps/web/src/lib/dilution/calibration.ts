/**
 * GPA calibration via the 1/128-acre method (UC-10, FR-12).
 *
 * Why 1/128-acre: 128 fl oz = 1 gallon. If you spray 1/128 of an acre and
 * collect the output in fluid ounces, that ounces value equals the rig's
 * gallons per acre. The math collapses to a one-step conversion.
 *
 * Field workflow:
 *   1. Measure the boom or single-nozzle effective spray width (W, inches).
 *   2. App computes the calibration distance (D, feet) such that walking
 *      that distance at width W covers exactly 1/128 acre.
 *   3. Operator walks D at normal spray speed, collecting output the whole
 *      time, then enters fluid ounces collected.
 *   4. Ounces ≈ GPA. Save to the sprayer.
 *
 * Distance formula: 1/128 acre = 340.3125 sq ft = 49,005 sq in.
 *   D (in) = 49,005 / W;  D (ft) = 49,005 / (W * 12) ≈ 4083.75 / W.
 *
 * Step count assumes a 2.5 ft natural stride; operator can override.
 */

const SQ_INCHES_PER_128TH_ACRE = 49_005;
const DEFAULT_STRIDE_FEET = 2.5;

export interface CalibrationDistance {
  spreadInches: number;
  distanceFeet: number;
  steps: number;
  strideFeet: number;
}

export interface CalibrationResult {
  spreadInches: number;
  distanceFeet: number;
  ouncesCollected: number;
  /** GPA equals ounces in the 1/128-acre method. */
  gpa: number;
  /** True if outside the 5–60 GPA sanity range — operator should re-run. */
  outsideSanityBand: boolean;
}

export function calibrationDistance(
  spreadInches: number,
  strideFeet: number = DEFAULT_STRIDE_FEET
): CalibrationDistance {
  if (!Number.isFinite(spreadInches) || spreadInches <= 0) {
    throw new Error('spreadInches must be a positive number');
  }
  if (!Number.isFinite(strideFeet) || strideFeet <= 0) {
    throw new Error('strideFeet must be a positive number');
  }
  const distanceInches = SQ_INCHES_PER_128TH_ACRE / spreadInches;
  const distanceFeet = distanceInches / 12;
  const steps = Math.round(distanceFeet / strideFeet);
  return {
    spreadInches,
    distanceFeet: round1(distanceFeet),
    steps,
    strideFeet
  };
}

export function computeCalibratedGpa(
  spreadInches: number,
  ouncesCollected: number
): CalibrationResult {
  if (!Number.isFinite(ouncesCollected) || ouncesCollected < 0) {
    throw new Error('ouncesCollected must be a non-negative number');
  }
  const { distanceFeet } = calibrationDistance(spreadInches);
  const gpa = ouncesCollected;
  const outsideSanityBand = gpa < 5 || gpa > 60;
  return {
    spreadInches,
    distanceFeet,
    ouncesCollected,
    gpa: round1(gpa),
    outsideSanityBand
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
