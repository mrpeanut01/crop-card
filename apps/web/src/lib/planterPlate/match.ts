import type { CellRecommendation, MatchInput, MatchResult, Plate, PlateSeedType } from './types';
import { MM_TO_64THS } from './types';

const round1 = (n: number) => Math.round(n * 10) / 10;

export function mmToInternal(mm: number): number {
  return mm * MM_TO_64THS;
}

export function internalToMm(internal: number): number {
  return internal / MM_TO_64THS;
}

/**
 * Pure plate matcher. Filters the catalog by structural fields, then ranks
 * by total |dimensions| delta when seed dims are supplied; otherwise sorts
 * by plateNumber.
 */
export function matchPlates(plates: Plate[], input: MatchInput): MatchResult[] {
  const {
    seedType,
    series = 'Both',
    shape = 'Either',
    cells = 'Either',
    dimensions,
    limit = 20
  } = input;

  const isShapeFilterable = seedType === 'Corn' || seedType === 'Soybean';
  const toleranceInternal = input.toleranceInternal ?? 0;

  let pool = plates.filter((p) => p.seedType === seedType);
  if (series !== 'Both') pool = pool.filter((p) => p.series === series);
  if (isShapeFilterable && shape !== 'Either') pool = pool.filter((p) => p.shape === shape);
  if (cells !== 'Either' && typeof cells === 'number') pool = pool.filter((p) => p.cells === cells);

  if (dimensions) {
    const { L, D, T } = dimensions;
    const budget = toleranceInternal * 3;
    const scored: MatchResult[] = [];
    for (const p of pool) {
      const d = Math.abs(p.L - L) + Math.abs(p.D - D) + Math.abs(p.T - T);
      if (d <= budget) scored.push({ ...p, delta: round1(d) });
    }
    scored.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
    return scored.slice(0, limit);
  }

  return [...pool].sort((a, b) => a.plateNumber.localeCompare(b.plateNumber)).slice(0, limit);
}

/**
 * Cell-count recommendation derived from target planting density. Corn only —
 * the 16-vs-24 framing comes from the Lincoln Ag sprocket charts where a
 * 24-cell plate plants 1.5× as many seeds/acre as a 16-cell at identical
 * sprockets. Thresholds keep the target population in the middle of the chart.
 *
 * Inputs: in-row spacing in inches; row spacing in inches (defaults to 30").
 * Returns null when inputs are missing/invalid.
 */
export function cellCountRecommendation(
  inRowInches: number | undefined,
  rowInches: number | undefined
): CellRecommendation | null {
  if (!inRowInches || inRowInches <= 0) return null;
  const row = rowInches ?? 30;
  if (!row || row <= 0) return null;
  const ppa = Math.round((43560 * 144) / (inRowInches * row));
  const ppaStr = ppa.toLocaleString();
  if (ppa <= 22_000) {
    return {
      cells: 16,
      band: 'low',
      plantsPerAcre: ppa,
      note: `${ppaStr} plants/acre is a sparse stand — a 16-cell plate matches at standard sprockets.`
    };
  }
  if (ppa >= 26_000) {
    return {
      cells: 24,
      band: 'high',
      plantsPerAcre: ppa,
      note: `${ppaStr} plants/acre is a typical/high stand — a 24-cell plate matches at standard sprockets.`
    };
  }
  return {
    cells: 24,
    band: 'mid',
    plantsPerAcre: ppa,
    note: `${ppaStr} plants/acre is between 22k–26k — either works, but 24-cell gives more downward sprocket headroom.`
  };
}

/**
 * Confidence assessment for an auto-pick. Returns `lowConfidence: true`
 * when the matcher had to settle for a weak signal (no input dims, multiple
 * candidates tied at the top, or the best match is still far from input).
 */
export function isLowConfidence(
  results: MatchResult[],
  hadInputDims: boolean
): { lowConfidence: boolean; reason: string | null } {
  if (results.length === 0) return { lowConfidence: true, reason: 'no candidates' };
  if (!hadInputDims) return { lowConfidence: true, reason: 'no seed dimensions provided' };
  const top = results[0];
  const second = results[1];
  if (top.delta === undefined) return { lowConfidence: true, reason: 'top result has no score' };
  if (top.delta > 6)
    return { lowConfidence: true, reason: `top match Δ=${top.delta} > 6 (poor fit)` };
  if (second && second.delta !== undefined && second.delta === top.delta) {
    return { lowConfidence: true, reason: 'multiple candidates tied for top' };
  }
  return { lowConfidence: false, reason: null };
}

/**
 * Class-level kernel dimensions in mm — used as a fallback when the AI can't
 * find variety-specific data. Values are typical published ranges from
 * seed-conditioning and grain-grading literature (USDA, university extension,
 * and Lincoln Ag's own grade-size charts), rounded to whole millimeters.
 *
 * These are *coarse* — good enough to land within the matcher's tolerance and
 * surface plausible candidates, but always tagged low-confidence so the
 * operator verifies against the actual seed lot. Shape is included so the
 * matcher can pre-filter corn/soybean appropriately.
 */
export const CLASS_DEFAULT_DIMS_MM: Record<
  PlateSeedType,
  { L: number; D: number; T: number; shape?: 'Round' | 'Flat'; note: string } | null
> = {
  // Most field/dent/flour corn is medium-flat with these proportions. Sweet
  // and popcorn run smaller but the same plate family generally works.
  Corn: {
    L: 11,
    D: 9,
    T: 5,
    shape: 'Flat',
    note: 'class-level estimate: medium-flat dent/flour corn'
  },
  // Sorghum kernels are small and round; the 30/60-cell sorghum plates target
  // these dims with high precision.
  Sorghum: {
    L: 4,
    D: 4,
    T: 3,
    shape: 'Round',
    note: 'class-level estimate: typical grain sorghum'
  },
  // Soybeans are roughly spherical and large.
  Soybean: {
    L: 7,
    D: 7,
    T: 6,
    shape: 'Round',
    note: 'class-level estimate: typical commercial soybean'
  },
  // Sunflower kernels are elongated; confectionary is larger, oilseed smaller.
  // Mid-size is a reasonable default.
  Sunflower: { L: 12, D: 6, T: 4, note: 'class-level estimate: mid-size sunflower kernel' },
  // Sugar beet has no plates in this catalog — return null so callers skip.
  'Sugar Beet': null
};

/** Inverse mapping from a taxonomy/type label to the catalog's seedType enum. */
export function inferSeedTypeFromName(name: string | null | undefined): PlateSeedType | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/sugar\s*beet|sugarbeet/.test(n)) return 'Sugar Beet';
  if (/sunflower/.test(n)) return 'Sunflower';
  if (/soy\s*bean|soybean|soya/.test(n)) return 'Soybean';
  if (/sorghum|milo/.test(n)) return 'Sorghum';
  if (/corn|maize|popcorn/.test(n)) return 'Corn';
  return null;
}
