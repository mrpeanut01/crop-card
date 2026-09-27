/**
 * Reads a soil test the way a grower reads the lab sheet: pH class, P and K
 * class for the lab's extraction method, a lime hint and whether the test is
 * too old to lean on. Client-safe and pure.
 *
 * The lab's own typed rating always wins. A computed class is `fallback`
 * and only exists where a published threshold for that extraction method is
 * on file in `SOIL_SOURCES`; every other method reads as unknown.
 */

export const EXTRACTION_METHODS = [
  'mehlich-1',
  'mehlich-3',
  'bray-p1',
  'olsen',
  'morgan',
  'modified-morgan',
  'other'
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const EXTRACTION_METHOD_LABEL: Record<ExtractionMethod, string> = {
  'mehlich-1': 'Mehlich-1',
  'mehlich-3': 'Mehlich-3',
  'bray-p1': 'Bray P1',
  olsen: 'Olsen',
  morgan: 'Morgan',
  'modified-morgan': 'Modified Morgan',
  other: 'Other or not sure'
};

export const UNITS_BASES = ['ppm', 'lb-per-acre'] as const;
export type UnitsBasis = (typeof UNITS_BASES)[number];

export const UNITS_BASIS_LABEL: Record<UnitsBasis, string> = {
  ppm: 'ppm (parts per million)',
  'lb-per-acre': 'lb per acre'
};

export const LAB_RATINGS = [
  'very-low',
  'low',
  'medium',
  'optimum',
  'high',
  'very-high',
  'excessive'
] as const;
export type LabRating = (typeof LAB_RATINGS)[number];

export const LAB_RATING_LABEL: Record<LabRating, string> = {
  'very-low': 'Very low',
  low: 'Low',
  medium: 'Medium',
  optimum: 'Optimum',
  high: 'High',
  'very-high': 'Very high',
  excessive: 'Excessive'
};

export const RATED_NUTRIENTS = ['p', 'k', 'ca', 'mg'] as const;
export type RatedNutrient = (typeof RATED_NUTRIENTS)[number];
export type LabRatings = Partial<Record<RatedNutrient, LabRating>>;

export interface SoilSource {
  url: string;
  publisher: string;
  date: string;
  quote: string;
}

export const SOIL_SOURCES = {
  lbPerAcre: {
    url: 'https://www.udel.edu/academics/colleges/canr/cooperative-extension/fact-sheets/interpreting-soil-phosphorus-and-potassium-tests/',
    publisher: 'University of Delaware Cooperative Extension',
    date: '2026-09-27',
    quote: 'A Mehlich-3 soil test P concentration >150 FIV is equivalent to 150 ppm or 300 lb/ac.'
  },
  mehlich1: {
    url: 'https://www.pubs.ext.vt.edu/452/452-701/452-701.html',
    publisher: 'Virginia Cooperative Extension, Soil Test Note 1 (452-701)',
    date: '2026-09-27',
    quote:
      'An extractable Mehlich-1 level of phosphorus from 12 to 35 pounds per acre (lb/A) is rated as medium or optimum. A medium level of potassium is from 76 to 175 lb/A.'
  },
  mehlich3P: {
    url: 'https://www.udel.edu/academics/colleges/canr/cooperative-extension/fact-sheets/interpreting-soil-phosphorus-and-potassium-tests/',
    publisher: 'University of Delaware Cooperative Extension',
    date: '2026-09-27',
    quote:
      'Fertility index value (FIV) is equivalent to the measured Mehlich 3 soil test phosphorus concentration in parts per million (ppm). The HIGH (50-100 FIV) category indicates the nutrient concentration in the soil is in the range recommended for the growth of all plants.'
  },
  phClasses: {
    url: 'https://www.nrcs.usda.gov/sites/default/files/2022-09/The-Soil-Survey-Manual.pdf',
    publisher: 'USDA NRCS, Soil Survey Manual (Handbook 18, 2017), soil reaction classes',
    date: '2026-09-27',
    quote: 'Moderately acid 5.6-6.0; slightly acid 6.1-6.5; neutral 6.6-7.3.'
  }
} as const satisfies Record<string, SoilSource>;

/** A 6⅔-inch furrow slice weighs about 2 million lb per acre, so 1 ppm is
 *  2 lb/acre (`SOIL_SOURCES.lbPerAcre`). */
export const LB_PER_ACRE_PER_PPM = 2;

export const SOIL_TEST_STALE_YEARS = 3;
const YEAR_MS = 365.25 * 86_400_000;

/** A nutrient value as typed on the lab sheet, converted to ppm. A missing
 *  basis means ppm, which is what every test saved before Phase 32 used. */
export function toPpm(
  value: number | null | undefined,
  basis: UnitsBasis | null | undefined
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return basis === 'lb-per-acre' ? value / LB_PER_ACRE_PER_PPM : value;
}

export function toLbPerAcre(ppm: number | null | undefined): number | null {
  if (ppm == null || !Number.isFinite(ppm)) return null;
  return ppm * LB_PER_ACRE_PER_PPM;
}

export type PhClass =
  | 'ultra-acid'
  | 'extremely-acid'
  | 'very-strongly-acid'
  | 'strongly-acid'
  | 'moderately-acid'
  | 'slightly-acid'
  | 'neutral'
  | 'slightly-alkaline'
  | 'moderately-alkaline'
  | 'strongly-alkaline'
  | 'very-strongly-alkaline';

export const PH_CLASS_LABEL: Record<PhClass, string> = {
  'ultra-acid': 'Ultra acid',
  'extremely-acid': 'Extremely acid',
  'very-strongly-acid': 'Very strongly acid',
  'strongly-acid': 'Strongly acid',
  'moderately-acid': 'Moderately acid',
  'slightly-acid': 'Slightly acid',
  neutral: 'Neutral',
  'slightly-alkaline': 'Slightly alkaline',
  'moderately-alkaline': 'Moderately alkaline',
  'strongly-alkaline': 'Strongly alkaline',
  'very-strongly-alkaline': 'Very strongly alkaline'
};

/** Upper bound (inclusive, at one decimal) of each NRCS reaction class. */
const PH_CLASS_UPPER: ReadonlyArray<readonly [PhClass, number]> = [
  ['ultra-acid', 3.4],
  ['extremely-acid', 4.4],
  ['very-strongly-acid', 5.0],
  ['strongly-acid', 5.5],
  ['moderately-acid', 6.0],
  ['slightly-acid', 6.5],
  ['neutral', 7.3],
  ['slightly-alkaline', 7.8],
  ['moderately-alkaline', 8.4],
  ['strongly-alkaline', 9.0]
];

export function phClass(ph: number | null | undefined): PhClass | null {
  if (ph == null || !Number.isFinite(ph) || ph < 0 || ph > 14) return null;
  const rounded = Math.round(ph * 10) / 10;
  for (const [cls, upper] of PH_CLASS_UPPER) if (rounded <= upper) return cls;
  return 'very-strongly-alkaline';
}

export type NutrientClass = 'low' | 'optimum' | 'high';

export const NUTRIENT_CLASS_LABEL: Record<NutrientClass, string> = {
  low: 'Below optimum',
  optimum: 'Optimum',
  high: 'Above optimum'
};

interface OptimumBand {
  lowPpm: number;
  highPpm: number;
  source: keyof typeof SOIL_SOURCES;
}

/** Published optimum bands in ppm, by extraction method. A method or
 *  nutrient with no sourced band is left out and reads as unknown. */
export const OPTIMUM_BANDS: Partial<
  Record<ExtractionMethod, Partial<Record<'p' | 'k', OptimumBand>>>
> = {
  'mehlich-1': {
    p: { lowPpm: 12 / LB_PER_ACRE_PER_PPM, highPpm: 35 / LB_PER_ACRE_PER_PPM, source: 'mehlich1' },
    k: { lowPpm: 76 / LB_PER_ACRE_PER_PPM, highPpm: 175 / LB_PER_ACRE_PER_PPM, source: 'mehlich1' }
  },
  'mehlich-3': {
    p: { lowPpm: 50, highPpm: 100, source: 'mehlich3P' }
  }
};

export function computedNutrientClass(
  nutrient: 'p' | 'k',
  ppm: number | null,
  method: ExtractionMethod | null | undefined
): NutrientClass | null {
  if (ppm == null || !method) return null;
  const band = OPTIMUM_BANDS[method]?.[nutrient];
  if (!band) return null;
  if (ppm < band.lowPpm) return 'low';
  if (ppm > band.highPpm) return 'high';
  return 'optimum';
}

export type RatingProvenance = 'manual' | 'fallback';

export interface NutrientReading {
  ppm: number | null;
  lbPerAcre: number | null;
  /** What to show: the lab's words when typed, else the computed class. */
  label: string | null;
  provenance: RatingProvenance | null;
  labRating: LabRating | null;
  computed: NutrientClass | null;
}

function readNutrient(
  nutrient: RatedNutrient,
  raw: number | null | undefined,
  basis: UnitsBasis | null | undefined,
  method: ExtractionMethod | null | undefined,
  ratings: LabRatings
): NutrientReading {
  const ppm = toPpm(raw, basis);
  const labRating = ratings[nutrient] ?? null;
  const computed =
    nutrient === 'p' || nutrient === 'k' ? computedNutrientClass(nutrient, ppm, method) : null;
  if (labRating) {
    return {
      ppm,
      lbPerAcre: toLbPerAcre(ppm),
      label: LAB_RATING_LABEL[labRating],
      provenance: 'manual',
      labRating,
      computed
    };
  }
  return {
    ppm,
    lbPerAcre: toLbPerAcre(ppm),
    label: computed ? NUTRIENT_CLASS_LABEL[computed] : null,
    provenance: computed ? 'fallback' : null,
    labRating: null,
    computed
  };
}

export type LimeStatus = 'likely' | 'not-needed' | 'unknown';

export interface LimeEstimate {
  status: LimeStatus;
  provenance: 'fallback';
  text: string;
}

/** A yes-or-no hint only. How much lime to spread depends on buffer pH and
 *  the crop, so the amount always comes from the lab. */
export function limeEstimate(
  ph: number | null | undefined,
  bufferPh?: number | null
): LimeEstimate {
  const cls = phClass(ph);
  const buffer =
    bufferPh != null && Number.isFinite(bufferPh)
      ? ` Your lab measured a buffer pH of ${bufferPh.toFixed(1)}, which is what it uses to set the amount.`
      : '';
  if (!cls) {
    return {
      status: 'unknown',
      provenance: 'fallback',
      text: 'No pH on this test, so there is no lime hint.'
    };
  }
  const idx = PH_CLASS_UPPER.findIndex(([c]) => c === cls);
  const moderatelyAcidIdx = PH_CLASS_UPPER.findIndex(([c]) => c === 'moderately-acid');
  if (idx !== -1 && idx <= moderatelyAcidIdx) {
    return {
      status: 'likely',
      provenance: 'fallback',
      text: `pH ${(ph as number).toFixed(1)} is ${PH_CLASS_LABEL[cls].toLowerCase()}. Most vegetables and field crops grow best in slightly acid soil, so lime is likely needed. Acid-loving crops such as blueberries are the exception.${buffer}`
    };
  }
  return {
    status: 'not-needed',
    provenance: 'fallback',
    text: `pH ${(ph as number).toFixed(1)} is ${PH_CLASS_LABEL[cls].toLowerCase()}, so lime is not likely needed.${buffer}`
  };
}

export function isSoilTestStale(sampledAt: number, now: number): boolean {
  return now - sampledAt > SOIL_TEST_STALE_YEARS * YEAR_MS;
}

export function parseLabRatings(json: string | null | undefined): LabRatings {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const out: LabRatings = {};
  for (const n of RATED_NUTRIENTS) {
    const v = (raw as Record<string, unknown>)[n];
    if (typeof v === 'string' && (LAB_RATINGS as readonly string[]).includes(v)) {
      out[n] = v as LabRating;
    }
  }
  return out;
}

export interface SoilTestReadable {
  sampledAt: number;
  ph?: number | null;
  bufferPh?: number | null;
  phosphorusPpm?: number | null;
  potassiumPpm?: number | null;
  caPpm?: number | null;
  mgPpm?: number | null;
  extractionMethod?: ExtractionMethod | null;
  unitsBasis?: UnitsBasis | null;
  labRatings?: LabRatings | null;
}

export interface SoilInterpretation {
  phClass: PhClass | null;
  p: NutrientReading;
  k: NutrientReading;
  ca: NutrientReading;
  mg: NutrientReading;
  lime: LimeEstimate;
  stale: boolean;
  ageYears: number;
}

export function interpretSoilTest(test: SoilTestReadable, now: number): SoilInterpretation {
  const ratings = test.labRatings ?? {};
  const method = test.extractionMethod ?? null;
  const basis = test.unitsBasis ?? null;
  return {
    phClass: phClass(test.ph),
    p: readNutrient('p', test.phosphorusPpm, basis, method, ratings),
    k: readNutrient('k', test.potassiumPpm, basis, method, ratings),
    ca: readNutrient('ca', test.caPpm, basis, method, ratings),
    mg: readNutrient('mg', test.mgPpm, basis, method, ratings),
    lime: limeEstimate(test.ph, test.bufferPh),
    stale: isSoilTestStale(test.sampledAt, now),
    ageYears: Math.max(0, (now - test.sampledAt) / YEAR_MS)
  };
}
