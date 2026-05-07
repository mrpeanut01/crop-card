/**
 * Shared types for the safety kernel.
 *
 * Plugins declare a `chemistryClass` per active ingredient. The kernel reasons
 * over those classes — never over plugin-supplied compatibility claims.
 */

export const CHEMISTRY_CLASSES = [
  'synthetic-auxin',
  'chloroacetamide',
  'hppd-inhibitor',
  'accase-inhibitor',
  'glyphosate',
  'sulfonylurea'
] as const;

export type ChemistryClass = (typeof CHEMISTRY_CLASSES)[number];

export interface ActiveIngredient {
  name: string;
  chemistryClass: ChemistryClass;
}

export interface HerbicideProduct {
  pluginId: string;
  displayName: string;
  activeIngredients: ActiveIngredient[];
  labelClaims?: { safeForCropPluginIds?: string[] };
}

export interface CropStage {
  cropPluginId: string;
  /** Family used by the chemistry-kill matrix. Optional for back-compat with
   *  earlier callers; new code should always supply it. */
  cropFamily?: import('./cropFamilyLethality').CropFamily;
  /** Heights in inches — agronomic convention for row crops in this market. */
  heightInches?: number;
  growthStage?: string;
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
  lastChemistryClass?: ChemistryClass;
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
  | 'ENV_RAIN';

export interface SafetyViolation {
  code: ViolationCode;
  message: string;
  /** Optional structured detail for UI to render specific guidance. */
  detail?: Record<string, unknown>;
}

export interface SafetyResult {
  ok: boolean;
  violations: SafetyViolation[];
  /** True when the kernel wants the UI to route to the decon wizard. */
  requiresDecon: boolean;
}
