/**
 * Default nitrogen-credit table for terminated cover crops, used by
 * /fertility's "suggest credit" button. Values are conservative
 * lb-N-per-acre defaults from the Northeast SARE small-farm guides;
 * operators can override on save with a soil-test-grounded number.
 *
 * Plugin-immune by design — like the safety kernel, these are core
 * agronomy constants tied to crop families. If a future plugin claims
 * a different value, it must be reconciled here, not silently widened.
 */

export interface CoverCropCredit {
  /** Conservative lb-N / acre delivered to the following cash crop. */
  nLbPerAcre: number;
  /** Conservative lb-P2O5 / acre. */
  pLbPerAcre: number;
  /** Conservative lb-K2O / acre. */
  kLbPerAcre: number;
  /** Why this number — surfaces in the credit form so the operator sees the rationale. */
  rationale: string;
}

const CREDITS: Record<string, CoverCropCredit> = {
  // Legumes — N-fixers, dominant credit driver
  'crimson-clover-cover': {
    nLbPerAcre: 70,
    pLbPerAcre: 0,
    kLbPerAcre: 0,
    rationale: 'Crimson clover, full bloom termination — 70 lb-N/ac is mid-range Northeast SARE.'
  },
  'austrian-winter-pea-cover': {
    nLbPerAcre: 90,
    pLbPerAcre: 0,
    kLbPerAcre: 0,
    rationale: 'Austrian winter pea, terminated 1–2 wk before planting — 90 lb-N/ac.'
  },
  'red-clover-mammoth': {
    nLbPerAcre: 80,
    pLbPerAcre: 0,
    kLbPerAcre: 0,
    rationale: 'Mammoth red clover, full-season + termination at bloom — 80 lb-N/ac.'
  },
  'white-clover-cover': {
    nLbPerAcre: 50,
    pLbPerAcre: 0,
    kLbPerAcre: 0,
    rationale: 'White clover living mulch — 50 lb-N/ac with normal mowing maintenance.'
  },
  'sunn-hemp-cover': {
    nLbPerAcre: 60,
    pLbPerAcre: 0,
    kLbPerAcre: 0,
    rationale: 'Sunn hemp 60-day summer cover — 60 lb-N/ac.'
  },
  // Brassicas — biofumigation + nutrient scavenging
  'daikon-radish-cover': {
    nLbPerAcre: 30,
    pLbPerAcre: 0,
    kLbPerAcre: 20,
    rationale: 'Daikon radish — minor N release, K scavenged from subsoil.'
  },
  // Grasses — non-fixing; small credit from residue mineralization
  'oats-cover-spring': {
    nLbPerAcre: 15,
    pLbPerAcre: 0,
    kLbPerAcre: 10,
    rationale: 'Spring oats winterkill — small residue credit.'
  },
  'sorghum-sudangrass-cover': {
    nLbPerAcre: 25,
    pLbPerAcre: 0,
    kLbPerAcre: 15,
    rationale: 'Sorghum-sudangrass — large biomass; modest N + K residue credit.'
  },
  'buckwheat-cover': {
    nLbPerAcre: 20,
    pLbPerAcre: 30,
    kLbPerAcre: 10,
    rationale: 'Buckwheat — P-mobilizer; modest credit on all three macros.'
  }
};

/**
 * Default credit for a given cover-crop pluginId; returns undefined if the
 * plugin is unknown so the form falls back to manual entry.
 */
export function defaultCoverCredit(cropPluginId: string): CoverCropCredit | undefined {
  return CREDITS[cropPluginId];
}
