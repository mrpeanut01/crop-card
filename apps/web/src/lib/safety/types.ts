/**
 * Shared types for the safety kernel.
 *
 * Plugins declare a `chemistryClass` per active ingredient. The kernel reasons
 * over those classes — never over plugin-supplied compatibility claims.
 */

export const CHEMISTRY_CLASSES = [
  // Legacy v1 classes (HRAC mapping in cropFamilyLethality.ts → ChemistryProfile.hracGroup)
  'synthetic-auxin', // HRAC 4 — 2,4-D, dicamba
  'chloroacetamide', // HRAC 15 (legacy K3) — S-metolachlor, acetochlor
  'hppd-inhibitor', // HRAC 27 — mesotrione, tembotrione
  'accase-inhibitor', // HRAC 1 — clethodim, sethoxydim, fluazifop
  'glyphosate', // HRAC 9 — glyphosate (non-selective)
  'sulfonylurea', // HRAC 2 — Stadia-class, halosulfuron, nicosulfuron
  // Phase 9 expansion (HRAC-aligned, friendly names kept for plugin readability)
  'microtubule-inhibitor', // HRAC 3 — pendimethalin, trifluralin (dinitroanilines)
  'photosystem-ii-triazine', // HRAC 5 — atrazine, simazine, metribuzin
  'photosystem-i-diquat', // HRAC 22 — paraquat, diquat
  'glufosinate', // HRAC 10 — Liberty (glutamine synthetase inhibitor)
  'ppo-inhibitor', // HRAC 14 — fomesafen, flumioxazin, sulfentrazone, lactofen
  'als-imidazolinone', // HRAC 2 (IMI subset) — imazethapyr, imazamox, imazaquin
  'vlcfa-pyroxasulfone', // HRAC 15 — pyroxasulfone (newer VLCFA inhibitor)
  'clomazone' // HRAC 13 — clomazone (carotenoid biosynthesis)
] as const;

export type ChemistryClass = (typeof CHEMISTRY_CLASSES)[number];

/**
 * Coarse pesticide-category load tokens for the sprayer state machine ONLY
 * (#321). Insecticides carry IRAC groups and fungicides carry FRAC codes —
 * neither is an HRAC `ChemistryClass`, and neither belongs in the herbicide
 * kill-matrix (`CHEMISTRY_KILL_MATRIX`). But the cross-contamination gate
 * (UC-04 / UC-32) still needs to know that a *non-herbicide* load passed
 * through the tank so the next different-chemistry pass routes to decon.
 *
 * `SprayerLoadClass` widens the state-machine chemistry token without
 * touching `ChemistryClass`, so the kill-matrix and every herbicide-only
 * consumer stay HRAC-pure. `checkCrossContamination` fires on any distinct
 * token: herbicide→insecticide, insecticide→herbicide, and
 * fungicide→herbicide sequences all trigger the decon requirement.
 */
export const SPRAYER_LOAD_CLASSES = ['insecticide-load', 'fungicide-load'] as const;

export type SprayerLoadClass = ChemistryClass | (typeof SPRAYER_LOAD_CLASSES)[number];

export interface ActiveIngredient {
  name: string;
  chemistryClass: ChemistryClass;
}

export interface HerbicideProduct {
  pluginId: string;
  displayName: string;
  activeIngredients: ActiveIngredient[];
  labelClaims?: { safeForCropPluginIds?: string[] };
  /**
   * Per-claim trait gates (Phase 11). When the planted cultivar's
   * `cropPluginId` matches an entry here AND every listed trait is on
   * the crop's `traits[]`, the family-kill compatibility check is
   * bypassed for that (product, crop) pair only. Other claims of the
   * same product over different crops are unaffected.
   */
  traitGatedSafeFor?: Array<{ cropPluginId: string; requiresTraits: string[] }>;
}

export interface CropStage {
  cropPluginId: string;
  /** Family used by the chemistry-kill matrix. Optional for back-compat with
   *  earlier callers; new code should always supply it. */
  cropFamily?: import('./cropFamilyLethality').CropFamily;
  /** Heights in inches — agronomic convention for row crops in this market. */
  heightInches?: number;
  growthStage?: string;
  /**
   * Genetic / breeding traits the cultivar carries (Phase 11). The kernel
   * uses this to grant per-product trait overrides on the family-kill check.
   * Omitting this is equivalent to `[]` — no trait protection.
   */
  traits?: readonly string[];
}

/**
 * A field block may have multiple co-planted crops (Three Sisters, companion
 * planting). The kernel evaluates herbicide eligibility against the union of
 * all crop families present — block eligibility = intersection of safe crops.
 */
export interface BlockCrops {
  /** The primary crop being targeted by the spray (drives stage gates). */
  primary: CropStage;
  /** Other crops in the same block. Their families are checked for
   *  chemistry lethality but their stages do not gate the spray. */
  coPlanted?: ReadonlyArray<CropStage>;
}

export interface SprayerState {
  id: string;
  /** Widened to `SprayerLoadClass` (#321) so insecticide (`insecticide-load`)
   *  and fungicide (`fungicide-load`) passes participate in the
   *  cross-contamination state machine alongside HRAC herbicide classes. */
  lastChemistryClass?: SprayerLoadClass;
  lastSprayedAt?: number;
  lastDeconAt?: number;
}

export interface EnvironmentalConditions {
  windMph: number;
  tempF: number;
  rainForecastMmNext24h: number;
}

export interface SprayContext {
  occurredAt: number;
  products: HerbicideProduct[];
  crop: CropStage;
  /** Optional list of co-planted crops in the same block. When present,
   *  the kernel adds a CROP_INCOMPATIBLE check against each one. */
  coPlantedCrops?: ReadonlyArray<CropStage>;
  sprayer: SprayerState;
  conditions: EnvironmentalConditions;
}

export type ViolationCode =
  | 'CHEMISTRY_INCOMPATIBLE'
  | 'CROP_INCOMPATIBLE'
  | 'CROP_STAGE_BLOCK'
  | 'TANK_MIX_PROHIBITED'
  | 'TANK_MIX_SEPARATION'
  | 'CROSS_CONTAMINATION'
  | 'ENV_WIND'
  | 'ENV_TEMP'
  | 'ENV_RAIN'
  // Phase 25d (#89) — three new evaluators driven by plugin discriminators
  // backfilled in 25c.0 (#87). Wired into insecticide + fungicide record
  // endpoints behind KERNEL_DRY_RUN until the 14-day false-positive window
  // closes.
  | 'FRAC_ROTATION_BLOCK'
  | 'IPM_THRESHOLD_NOT_MET'
  | 'POLLINATOR_BLOOM_BLOCK';

export interface SafetyViolation {
  code: ViolationCode;
  message: string;
  /** Optional structured detail for UI to render specific guidance. */
  detail?: Record<string, unknown>;
}

/**
 * Shape of an individual crop entry inside a consolidated CROP_INCOMPATIBLE
 * violation's `detail.crops[]`. Phase 23 #53-half-1 collapses the historical
 * one-violation-per-(product × crop) emission into one violation per
 * (product × chemistryClass) carrying this list.
 */
export interface CropIncompatibilityCrop {
  cropPluginId: string;
  cropFamily: import('./cropFamilyLethality').CropFamily;
  isCoPlanted: boolean;
}

export interface SafetyResult {
  ok: boolean;
  violations: SafetyViolation[];
  /** True when the kernel wants the UI to route to the decon wizard. */
  requiresDecon: boolean;
}
