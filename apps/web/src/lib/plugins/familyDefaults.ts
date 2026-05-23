/**
 * Centralized family-keyed defaults for crop agronomy. Phase 17 (Track 1).
 *
 * Engines previously held their own per-family lookup tables (rotation
 * lookback, seed density, emergence days, perennial detection). This file
 * unifies them so engines call `resolveCropAgronomy(crop)` instead of
 * branching on `crop.cropFamily` directly.
 *
 * Per-plugin `agronomy` and `plantingGuide` fields take precedence; family
 * defaults are the fallback. Adding a new variety with non-default
 * agronomy is a plugin-data edit, not a TypeScript change.
 *
 * Note: the safety kernel (cropFamilyLethality, cropStage) is intentionally
 * NOT covered by this layer — those rules are plugin-immune by design
 * (CLAUDE.md invariant #1). This file is for agronomic policy only.
 */

import type { CropPlugin, CropLifecycle } from './schemas';

/** Years to wait before replanting the same family in the same block.
 *  Conservative defaults; cover crops + perennials are rotation-exempt. */
const ROTATION_LOOKBACK_YEARS_BY_FAMILY: Record<string, number> = {
  brassica: 3,
  allium: 3,
  solanaceae: 4,
  cucurbit: 2,
  legume: 1,
  corn: 1,
  cover: 0,
  'cover-grass': 0,
  'cover-legume': 0,
  orchard: 0,
  'stone-fruit': 0,
  bramble: 0,
  'small-fruit': 0,
  'vine-fruit': 0,
  forage: 0,
  hay: 0,
  'small-grain': 0
};

const SEEDS_PER_LB_BY_FAMILY: Record<string, number> = {
  corn: 1500,
  'cereal-grain': 12000,
  legume: 2000,
  'cover-grass': 250000,
  'cover-legume': 15000,
  brassica: 130000,
  cucurbit: 3000,
  solanaceae: 130000,
  apiaceae: 250000,
  'leafy-green': 350000,
  root: 250000,
  allium: 130000
};

/** Reference seeding density used by the swim-lane shade heuristic when
 *  comparing actual planted density against a "typical" rate. */
const REFERENCE_DENSITY_BY_FAMILY: Record<string, number> = {
  corn: 30000,
  cucurbit: 5000,
  legume: 140000,
  'cereal-grain': 1_400_000,
  solanaceae: 4500,
  brassica: 30000,
  'leafy-green': 200000,
  root: 200000,
  apiaceae: 200000,
  allium: 80000,
  'herb-culinary': 60000,
  forage: 200000,
  'cover-grass': 1_000_000,
  'cover-legume': 500_000,
  'broadleaf-companion': 60000
};

const PERENNIAL_FAMILIES: ReadonlySet<string> = new Set([
  'orchard',
  'stone-fruit',
  'small-fruit',
  'bramble',
  'vine-fruit',
  'forage'
]);

const COVER_FAMILIES: ReadonlySet<string> = new Set(['cover-grass', 'cover-legume', 'cover']);

/** Families that cast shade by default when no plugin shadeCasting/matureHeightFt
 *  is declared. Today only corn (tall, dense canopy). Other families with tall
 *  individuals (sunflower, sorghum) should declare it explicitly. */
const SHADE_CASTING_FAMILIES: ReadonlySet<string> = new Set(['corn']);

/** Days from planting until visible emergence — global default when neither
 *  the plugin nor the family carries a more specific window. */
const DEFAULT_EMERGENCE_DAYS = { min: 7, max: 14 } as const;

/** Cover-crop minimum termination lead before next cash crop (FR-18). */
const DEFAULT_COVER_TERMINATION_LEAD_DAYS = 14;

export interface ResolvedAgronomy {
  /** Annual / biennial / perennial. */
  lifecycle: CropLifecycle;
  /** Years before the same family may replant the same block. */
  rotationLookbackYears: number;
  /** Seed count per pound; null when no plugin or family default applies. */
  seedsPerLb: number | null;
  /** Reference density used by the shade-modeling heuristic. */
  referenceDensitySeedsPerAcre: number | null;
  /** Days-from-planting window for emergence. */
  emergenceDays: { min: number; max: number };
  /** Cover-crop only — minimum days between termination and next cash crop. */
  terminationLeadDaysMin: number;
  /** Whether this crop should render multi-year (perennial families). */
  isPerennial: boolean;
  /** Whether this is a cover crop (drives FR-18 termination flow). */
  isCoverCrop: boolean;
  /** Provenance of each derived field — useful for UI / debugging. */
  source: {
    lifecycle: 'plugin' | 'family' | 'default';
    rotationLookbackYears: 'plugin' | 'family' | 'default';
    seedsPerLb: 'plugin-direct' | 'plugin-derived' | 'family' | 'none';
    referenceDensitySeedsPerAcre: 'plugin' | 'family' | 'none';
    emergenceDays: 'plugin' | 'default';
    terminationLeadDaysMin: 'plugin' | 'default';
  };
}

/**
 * Resolve all engine-relevant agronomic parameters for a crop, merging
 * plugin-declared values with family defaults.
 */
export function resolveCropAgronomy(crop: CropPlugin): ResolvedAgronomy {
  const family = crop.cropFamily;
  const ag = crop.agronomy;
  const guide = crop.plantingGuide;

  const lifecycleSource: ResolvedAgronomy['source']['lifecycle'] = ag?.lifecycle
    ? 'plugin'
    : PERENNIAL_FAMILIES.has(family)
      ? 'family'
      : 'default';
  const lifecycle: CropLifecycle =
    ag?.lifecycle ?? (PERENNIAL_FAMILIES.has(family) ? 'perennial' : 'annual');

  const rotationLookbackYears =
    ag?.rotationLookbackYears ?? ROTATION_LOOKBACK_YEARS_BY_FAMILY[family] ?? 1;
  const rotationLookbackSource: ResolvedAgronomy['source']['rotationLookbackYears'] =
    ag?.rotationLookbackYears !== undefined
      ? 'plugin'
      : ROTATION_LOOKBACK_YEARS_BY_FAMILY[family] !== undefined
        ? 'family'
        : 'default';

  const { seedsPerLb, seedsPerLbSource } = resolveSeedsPerLb(crop);

  const referenceDensitySeedsPerAcre =
    guide?.referenceDensitySeedsPerAcre ?? REFERENCE_DENSITY_BY_FAMILY[family] ?? null;
  const referenceDensitySource: ResolvedAgronomy['source']['referenceDensitySeedsPerAcre'] =
    guide?.referenceDensitySeedsPerAcre !== undefined
      ? 'plugin'
      : REFERENCE_DENSITY_BY_FAMILY[family] !== undefined
        ? 'family'
        : 'none';

  const emergenceDays = guide?.emergenceDays ?? DEFAULT_EMERGENCE_DAYS;
  const emergenceSource: ResolvedAgronomy['source']['emergenceDays'] = guide?.emergenceDays
    ? 'plugin'
    : 'default';

  const isCoverCrop = COVER_FAMILIES.has(family);
  const terminationLeadDaysMin = isCoverCrop
    ? (ag?.terminationLeadDaysMin ?? DEFAULT_COVER_TERMINATION_LEAD_DAYS)
    : 0;
  const terminationLeadSource: ResolvedAgronomy['source']['terminationLeadDaysMin'] =
    ag?.terminationLeadDaysMin !== undefined ? 'plugin' : 'default';

  return {
    lifecycle,
    rotationLookbackYears,
    seedsPerLb,
    referenceDensitySeedsPerAcre,
    emergenceDays,
    terminationLeadDaysMin,
    isPerennial: lifecycle === 'perennial',
    isCoverCrop,
    source: {
      lifecycle: lifecycleSource,
      rotationLookbackYears: rotationLookbackSource,
      seedsPerLb: seedsPerLbSource,
      referenceDensitySeedsPerAcre: referenceDensitySource,
      emergenceDays: emergenceSource,
      terminationLeadDaysMin: terminationLeadSource
    }
  };
}

/** Standalone seeds-per-lb resolver — exposed for `seed/quantity.ts` which
 *  has callers that pass a thin shape rather than a full CropPlugin. */
export function resolveSeedsPerLb(plugin: {
  cropFamily?: string;
  plantingGuide?: { seedsPerLb?: number; seedsPerAcre?: number; recommendedLbsPerAcre?: number };
}): { seedsPerLb: number | null; seedsPerLbSource: ResolvedAgronomy['source']['seedsPerLb'] } {
  const guide = plugin.plantingGuide;
  if (guide?.seedsPerLb && guide.seedsPerLb > 0) {
    return { seedsPerLb: guide.seedsPerLb, seedsPerLbSource: 'plugin-direct' };
  }
  if (guide?.seedsPerAcre && guide?.recommendedLbsPerAcre && guide.recommendedLbsPerAcre > 0) {
    return {
      seedsPerLb: guide.seedsPerAcre / guide.recommendedLbsPerAcre,
      seedsPerLbSource: 'plugin-derived'
    };
  }
  const family = plugin.cropFamily;
  if (family && family in SEEDS_PER_LB_BY_FAMILY) {
    return { seedsPerLb: SEEDS_PER_LB_BY_FAMILY[family], seedsPerLbSource: 'family' };
  }
  return { seedsPerLb: null, seedsPerLbSource: 'none' };
}

/** Used by rotation.ts callers that don't have a full CropPlugin in hand. */
export function rotationLookbackForFamily(family: string | undefined): number {
  if (!family) return 0;
  return ROTATION_LOOKBACK_YEARS_BY_FAMILY[family] ?? 1;
}

/** Used by engine.ts shade modeling — kept as a thin export so the engine
 *  doesn't need to import the full ResolvedAgronomy. */
export function familyReferenceSeedsPerAcre(family: string): number | undefined {
  return REFERENCE_DENSITY_BY_FAMILY[family];
}

/** Used by engine.ts seasonalTasks rendering — annuals fire one year,
 *  perennials fire across multiple years. Kept as a thin export. */
export function isPerennialFamily(family: string): boolean {
  return PERENNIAL_FAMILIES.has(family);
}

export function isCoverCropFamily(family: string): boolean {
  return COVER_FAMILIES.has(family);
}

/**
 * Resolve whether a crop casts shade. Plugin `shadeCasting` (boolean) wins;
 * `matureHeightFt ≥ 5` infers true; otherwise falls through to the family
 * default set (today: corn). Replaces the inline `cropFamily === 'corn'`
 * fallback that lived in `engine.ts`.
 */
export function resolveCastsShade(crop: {
  shadeCasting?: boolean;
  matureHeightFt?: number;
  cropFamily: string;
}): boolean {
  if (typeof crop.shadeCasting === 'boolean') return crop.shadeCasting;
  if (typeof crop.matureHeightFt === 'number') return crop.matureHeightFt >= 5;
  return SHADE_CASTING_FAMILIES.has(crop.cropFamily);
}

/** Re-exported for tests + callers that want to know the global emergence
 *  window without resolving an entire crop. */
export { DEFAULT_EMERGENCE_DAYS, DEFAULT_COVER_TERMINATION_LEAD_DAYS };
