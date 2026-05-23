/**
 * Family-default growth-stage tables.
 *
 * Every cropFamily gets one canonical stage table that varieties inherit when
 * they don't author their own. Day-from-planting offsets are *reference* values
 * authored against `referenceDtmDays`; the projection layer scales them by
 * `actualDtm.midpoint / referenceDtmDays` so a 75-day sweet corn and a 100-day
 * dent corn both work off the same V/R skeleton.
 *
 * Perennial families (`orchard`, `stone-fruit`, `small-fruit`, `bramble`,
 * `vine-fruit`) anchor on calendar `dayOfYear`, not days-from-planting; their
 * tables live in PERENNIAL_DAYOFYEAR_TEMPLATES and are projected separately.
 */

import type { CropFamily } from '$lib/safety/cropFamilyLethality';
import type { CropPlugin, GrowthStage, GrowthStageTable, HarvestTarget } from './schemas';

type ZadoksLegacy = NonNullable<CropPlugin['zadoksStages']>;

const stage = (
  code: string,
  name: string,
  min: number,
  max: number,
  bodyKind: GrowthStage['bodyKind'],
  inspect?: string
): GrowthStage => ({
  code,
  name,
  daysFromPlanting: { min, max },
  bodyKind,
  ...(inspect ? { inspect } : {})
});

const target = (
  stageCode: string,
  label: string,
  useCase?: HarvestTarget['useCase']
): HarvestTarget => ({
  stageCode,
  label,
  ...(useCase ? { useCase } : {})
});

const cornVRStages: GrowthStage[] = [
  stage('VE', 'Emergence', 5, 10, 'vegetative', 'Coleoptile breaks soil; check stand uniformity.'),
  stage(
    'V2',
    '2-leaf collar',
    14,
    21,
    'vegetative',
    'Two visible leaf collars. POST broadleaf scout window opens.'
  ),
  stage(
    'V4',
    '4-leaf collar',
    24,
    32,
    'vegetative',
    'Growing point near soil. Late POST grass + broadleaf window.'
  ),
  stage(
    'V6',
    '6-leaf collar',
    32,
    42,
    'vegetative',
    'Growing point above soil; ear shoots forming. Sidedress N now.'
  ),
  stage(
    'V8',
    '8-leaf collar',
    40,
    50,
    'vegetative',
    'Lower leaves may be lost — count from top down. Tassel initiation.'
  ),
  stage(
    'VT',
    'Tasseling',
    55,
    65,
    'reproductive',
    'Last branch of tassel fully visible. Pollen shed begins ~2-3d later.'
  ),
  stage(
    'R1',
    'Silking',
    60,
    70,
    'reproductive',
    'Silks emerge from husks. Critical pollination window — drought stress now hurts most.'
  ),
  stage(
    'R2',
    'Blister',
    70,
    78,
    'reproductive',
    'Kernel white blister, ~85% moisture. Clear fluid inside.'
  ),
  stage(
    'R3',
    'Milk',
    78,
    88,
    'reproductive',
    'Kernel yellow, fluid milky-white. SWEET CORN HARVEST: thumb-test for soft milky sap.'
  ),
  stage('R4', 'Dough', 88, 98, 'ripening', 'Kernel paste-like, ~70% moisture. Past sweet eating.'),
  stage(
    'R5',
    'Dent',
    95,
    110,
    'ripening',
    'Dent forms at top of kernel. Milk line descends from top to base.'
  ),
  stage(
    'R6',
    'Black layer / physiological maturity',
    110,
    130,
    'ripening',
    'Black abscission layer at kernel base. ~30-35% kernel moisture. DENT/POPCORN/FLOUR HARVEST when field-dry.'
  )
];

const cornVRTable: GrowthStageTable = {
  system: 'vr-corn',
  referenceDtmDays: 95,
  stages: cornVRStages,
  harvestTargets: [target('R3', 'Sweet', 'fresh-eating'), target('R6', 'Dent', 'dry-storage')]
};

const soybeanRStages: GrowthStage[] = [
  stage('VE', 'Emergence', 5, 12, 'vegetative', 'Cotyledons above soil.'),
  stage('V2', '2 trifoliates', 14, 22, 'vegetative', 'Two unrolled trifoliates.'),
  stage(
    'V4',
    '4 trifoliates',
    24,
    35,
    'vegetative',
    'Sidedress / POST window for narrow-row beans.'
  ),
  stage(
    'R1',
    'Begin bloom',
    45,
    60,
    'reproductive',
    'One open flower at any node. Critical N-fixation activity.'
  ),
  stage('R3', 'Begin pod', 60, 75, 'reproductive', '5mm pod at one of the 4 uppermost nodes.'),
  stage(
    'R5',
    'Begin seed',
    75,
    90,
    'ripening',
    'Seed is 3mm long in pod at one of the 4 uppermost nodes.'
  ),
  stage(
    'R7',
    'Begin maturity',
    95,
    110,
    'ripening',
    'One pod on the main stem reaching mature pod color.'
  ),
  stage(
    'R8',
    'Full maturity',
    105,
    120,
    'ripening',
    '95% of pods have reached mature pod color. Harvest at ≤14% moisture.'
  )
];

const soybeanRTable: GrowthStageTable = {
  system: 'r-soybean',
  referenceDtmDays: 110,
  stages: soybeanRStages,
  harvestTargets: [target('R8', 'Dry-storage harvest', 'dry-storage')]
};

const zadoksStages: GrowthStage[] = [
  stage('Z10', 'Coleoptile through soil', 5, 14, 'vegetative', 'First leaf through coleoptile.'),
  stage(
    'Z20',
    'Tillering begins',
    30,
    60,
    'vegetative',
    'Main shoot + first tiller. Stand-count window.'
  ),
  stage(
    'Z30',
    'Stem extension / jointing',
    90,
    130,
    'vegetative',
    'First node detectable. N topdress + cover-crop termination window. Fungicide window opens.'
  ),
  stage(
    'Z39',
    'Flag leaf fully emerged',
    130,
    160,
    'vegetative',
    'Flag leaf ligule visible. Critical fungicide timing for septoria/rust.'
  ),
  stage('Z55', 'Heading', 150, 180, 'reproductive', 'Half of inflorescence emerged.'),
  stage(
    'Z65',
    'Anthesis (flowering)',
    160,
    190,
    'reproductive',
    'Mid-flowering. Fusarium head-blight watch — fungicide window for FHB.'
  ),
  stage('Z75', 'Milk development', 180, 210, 'ripening', 'Kernel content milky.'),
  stage('Z83', 'Early dough', 200, 225, 'ripening', 'Begin harvest moisture watch.'),
  stage(
    'Z89',
    'Fully ripe',
    215,
    245,
    'ripening',
    'Kernel hard, hard to divide with thumbnail. Wheat 13-14%, barley 12-14%, oats 14% target moisture.'
  )
];

const zadoksTable: GrowthStageTable = {
  system: 'zadoks',
  referenceDtmDays: 240,
  stages: zadoksStages,
  harvestTargets: [target('Z89', 'Dry-storage grain', 'dry-storage')]
};

const cucurbitBBCHStages: GrowthStage[] = [
  stage('BBCH-09', 'Emergence', 5, 12, 'vegetative', 'Cotyledons unfolded.'),
  stage('BBCH-15', '5-leaf', 18, 28, 'vegetative', 'Vine begins to run. POST grass window opens.'),
  stage(
    'BBCH-51',
    'First flower visible',
    28,
    42,
    'reproductive',
    'First male flowers usually first; female flowers 7-10d later.'
  ),
  stage(
    'BBCH-65',
    'Full flower',
    35,
    50,
    'reproductive',
    'Most flowers open. Pollinator activity critical.'
  ),
  stage(
    'BBCH-71',
    'Fruit set',
    45,
    60,
    'reproductive',
    'Fruit detectable; fruit drop normal at this stage.'
  ),
  stage(
    'BBCH-81',
    'Fruit color change',
    55,
    75,
    'ripening',
    'Color shift on cucurbits with rind change.'
  ),
  stage(
    'BBCH-89',
    'Fully ripe',
    60,
    85,
    'ripening',
    'Slip-test the stem (melons), hollow sound (squash), color/size for cucumber.'
  )
];

const cucurbitBBCHTable: GrowthStageTable = {
  system: 'bbch',
  referenceDtmDays: 65,
  stages: cucurbitBBCHStages,
  harvestTargets: [target('BBCH-89', 'Fresh eating', 'fresh-eating')]
};

const solanaceaeBBCHStages: GrowthStage[] = [
  stage('BBCH-09', 'Emergence', 5, 14, 'vegetative', 'Cotyledons above soil (or transplant set).'),
  stage('BBCH-15', '5 true leaves', 14, 28, 'vegetative'),
  stage('BBCH-51', 'First flower buds', 28, 42, 'reproductive', 'Flower buds visible.'),
  stage('BBCH-65', 'Full flowering', 35, 55, 'reproductive', 'Most flowers open.'),
  stage('BBCH-71', 'Fruit set', 45, 65, 'reproductive', 'First fruit detectable.'),
  stage(
    'BBCH-81',
    'Color break',
    60,
    80,
    'ripening',
    'Mature green → first color shift. Picking for ripening off-vine starts here.'
  ),
  stage('BBCH-89', 'Fully ripe', 70, 90, 'ripening', 'Full color, slight give. Vine-ripe harvest.')
];

const solanaceaeBBCHTable: GrowthStageTable = {
  system: 'bbch',
  referenceDtmDays: 75,
  stages: solanaceaeBBCHStages,
  harvestTargets: [
    target('BBCH-81', 'Color-break (ship green / counter-ripen)', 'fresh-eating'),
    target('BBCH-89', 'Vine-ripe', 'fresh-eating')
  ]
};

const brassicaSimpleStages: GrowthStage[] = [
  stage('cotyledon', 'Cotyledon', 4, 10, 'vegetative'),
  stage('true-leaves', 'True leaves', 10, 25, 'vegetative'),
  stage(
    'head-form',
    'Head / curd / sprout formation',
    35,
    55,
    'reproductive',
    'For heading brassicas: head firms up. For sprouting: side-shoots forming.'
  ),
  stage(
    'harvest-size',
    'Harvest size',
    55,
    75,
    'ripening',
    'Head firm, dense. Cut before center yellows or splits.'
  ),
  stage('bolt', 'Bolting', 75, 100, 'transition', 'Past harvest — flower stalks emerge.')
];

const brassicaSimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 65,
  stages: brassicaSimpleStages,
  harvestTargets: [target('harvest-size', 'Fresh eating', 'fresh-eating')]
};

const leafyGreenSimpleStages: GrowthStage[] = [
  stage('cotyledon', 'Cotyledon', 3, 8, 'vegetative'),
  stage('true-leaves', 'True leaves', 8, 20, 'vegetative'),
  stage(
    'harvest-size',
    'Harvest size',
    20,
    45,
    'ripening',
    '3-4in leaves; pre-bolt for milder flavor on bitter greens.'
  ),
  stage('bolt', 'Bolting', 35, 60, 'transition', 'Flower stalk emerges; flavor turns bitter.')
];

const leafyGreenSimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 35,
  stages: leafyGreenSimpleStages,
  harvestTargets: [target('harvest-size', 'Fresh eating', 'fresh-eating')]
};

const rootSimpleStages: GrowthStage[] = [
  stage('emerge', 'Emergence', 5, 14, 'vegetative'),
  stage('true-leaves', 'True leaves', 12, 25, 'vegetative'),
  stage('root-bulk', 'Root bulking', 35, 60, 'ripening', 'Shoulders begin to swell.'),
  stage(
    'harvest-size',
    'Harvest size',
    55,
    80,
    'ripening',
    'Pull a sample and check shoulder width.'
  ),
  stage(
    'over-mature',
    'Over-mature',
    80,
    110,
    'transition',
    'Woody / cracked roots; flavor declines.'
  )
];

const rootSimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 70,
  stages: rootSimpleStages,
  harvestTargets: [target('harvest-size', 'Fresh eating', 'fresh-eating')]
};

const apiaceaeSimpleStages: GrowthStage[] = [
  stage('emerge', 'Emergence', 7, 21, 'vegetative', 'Slow germination — keep moist.'),
  stage('fern-up', 'Fern-up', 18, 40, 'vegetative'),
  stage('harvest-size', 'Harvest size', 50, 80, 'ripening'),
  stage('bolt', 'Bolting', 80, 110, 'transition')
];

const apiaceaeSimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 70,
  stages: apiaceaeSimpleStages,
  harvestTargets: [target('harvest-size', 'Fresh eating', 'fresh-eating')]
};

const alliumSimpleStages: GrowthStage[] = [
  stage('emerge', 'Emergence', 7, 21, 'vegetative'),
  stage(
    'leaf-stand',
    'Leaf development',
    25,
    60,
    'vegetative',
    'Each leaf becomes a future bulb scale (onions).'
  ),
  stage(
    'bulb-init',
    'Bulb initiation',
    60,
    90,
    'reproductive',
    'Triggered by daylength; bulbs start swelling.'
  ),
  stage(
    'top-down',
    'Tops fall over',
    90,
    110,
    'ripening',
    'Tops fall — stop watering, begin field-curing.'
  ),
  stage(
    'cure-ready',
    'Cure-ready',
    100,
    125,
    'ripening',
    'Necks dry; lift and cure 2-3 weeks before storage.'
  )
];

const alliumSimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 110,
  stages: alliumSimpleStages,
  harvestTargets: [target('cure-ready', 'Cure & dry-storage', 'dry-storage')]
};

const herbCulinarySimpleStages: GrowthStage[] = [
  stage('establish', 'Establishment', 14, 35, 'vegetative'),
  stage(
    'first-cut',
    'First cut size',
    35,
    50,
    'ripening',
    '6-8in stems; cut above lowest true leaves.'
  ),
  stage(
    'regrowth',
    'Regrowth',
    50,
    75,
    'vegetative',
    'Cut-and-come-again; re-cut every 2-3 weeks.'
  ),
  stage(
    'flower',
    'Flowering',
    75,
    110,
    'transition',
    'Flavor turns bitter post-flower; pinch buds to extend leaf phase.'
  )
];

const herbCulinarySimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 45,
  stages: herbCulinarySimpleStages,
  harvestTargets: [target('first-cut', 'Fresh cutting', 'fresh-eating')]
};

const forageSimpleStages: GrowthStage[] = [
  stage('green-up', 'Spring green-up', 0, 30, 'vegetative'),
  stage(
    'first-cut-bud',
    'First-cut bud / boot',
    35,
    60,
    'ripening',
    'Legumes: bud stage. Grasses: boot. Optimum quality cutting window.'
  ),
  stage('regrowth', 'Regrowth', 60, 90, 'vegetative'),
  stage(
    'subsequent-cut-bud',
    'Subsequent cut bud / boot',
    90,
    130,
    'ripening',
    'Second/third cutting window.'
  )
];

const forageSimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 60,
  stages: forageSimpleStages,
  harvestTargets: [
    target('first-cut-bud', 'First cut hay', 'silage'),
    target('subsequent-cut-bud', 'Subsequent cuttings', 'silage')
  ]
};

const coverSimpleStages: GrowthStage[] = [
  stage('establish', 'Establishment', 7, 35, 'vegetative'),
  stage(
    'canopy-close',
    'Canopy close',
    35,
    75,
    'vegetative',
    'Full ground cover; weed suppression peak.'
  ),
  stage(
    'terminate',
    'Termination window',
    75,
    195,
    'transition',
    'Burndown ≥14d before next cash-crop planting per FR-18.'
  )
];

const coverSimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 90,
  stages: coverSimpleStages,
  harvestTargets: [target('terminate', 'Terminate (no harvest)', 'silage')]
};

const broadleafCompanionSimpleStages: GrowthStage[] = [
  stage('emerge', 'Emergence', 5, 14, 'vegetative'),
  stage('true-leaves', 'True leaves', 12, 30, 'vegetative'),
  stage('flowering', 'Flowering', 35, 60, 'reproductive', 'Pollinator value peaks here.'),
  stage('seed-set', 'Seed set', 60, 90, 'ripening')
];

const broadleafCompanionSimpleTable: GrowthStageTable = {
  system: 'simple',
  referenceDtmDays: 60,
  stages: broadleafCompanionSimpleStages,
  harvestTargets: [target('flowering', 'Pollinator support (no harvest)', 'fresh-eating')]
};

const legumeFallbackTable: GrowthStageTable = {
  ...soybeanRTable
  // Bean / pea / pulse fallback when not specifically soybean — same R-system.
};

/** Day-from-planting templates. Perennial families resolve to null here and
 *  use PERENNIAL_DAYOFYEAR_TEMPLATES instead. */
export const FAMILY_STAGE_TEMPLATES: Record<CropFamily, GrowthStageTable | null> = {
  corn: cornVRTable,
  legume: legumeFallbackTable,
  'cereal-grain': zadoksTable,
  cucurbit: cucurbitBBCHTable,
  solanaceae: solanaceaeBBCHTable,
  brassica: brassicaSimpleTable,
  'leafy-green': leafyGreenSimpleTable,
  root: rootSimpleTable,
  apiaceae: apiaceaeSimpleTable,
  allium: alliumSimpleTable,
  'herb-culinary': herbCulinarySimpleTable,
  forage: forageSimpleTable,
  'cover-grass': coverSimpleTable,
  'cover-legume': coverSimpleTable,
  'broadleaf-companion': broadleafCompanionSimpleTable,
  // Perennial families — null here; calendar engine routes to perennial path.
  orchard: null,
  'stone-fruit': null,
  'small-fruit': null,
  bramble: null,
  'vine-fruit': null
};

/**
 * Perennial calendar templates, keyed by `dayOfYear`. The calendar engine
 * projects these against the current calendar year, ignoring `plantingDate`.
 */
export interface PerennialStageEntry {
  code: string;
  name: string;
  dayOfYearStart: number;
  dayOfYearEnd: number;
  bodyKind: GrowthStage['bodyKind'];
  inspect?: string;
}

export interface PerennialStageTemplate {
  stages: PerennialStageEntry[];
  harvestStageCode: string;
  harvestLabel: string;
}

const perennialDeciduousFruit: PerennialStageTemplate = {
  stages: [
    {
      code: 'dormant',
      name: 'Dormant',
      dayOfYearStart: 1,
      dayOfYearEnd: 50,
      bodyKind: 'dormant',
      inspect: 'Dormant pruning + dormant oil window.'
    },
    {
      code: 'swollen-bud',
      name: 'Swollen bud',
      dayOfYearStart: 51,
      dayOfYearEnd: 75,
      bodyKind: 'transition',
      inspect: 'Buds swelling; copper window for some diseases.'
    },
    {
      code: 'bud-break',
      name: 'Bud break',
      dayOfYearStart: 76,
      dayOfYearEnd: 95,
      bodyKind: 'vegetative',
      inspect: 'Green tip / pink bud; first fungicide for apple scab / peach leaf curl.'
    },
    {
      code: 'bloom',
      name: 'Bloom',
      dayOfYearStart: 96,
      dayOfYearEnd: 120,
      bodyKind: 'reproductive',
      inspect: 'Pollinator activity critical; AVOID insecticides.'
    },
    {
      code: 'petal-fall',
      name: 'Petal fall',
      dayOfYearStart: 121,
      dayOfYearEnd: 135,
      bodyKind: 'reproductive',
      inspect: 'First post-bloom cover spray window.'
    },
    {
      code: 'fruit-set',
      name: 'Fruit set',
      dayOfYearStart: 136,
      dayOfYearEnd: 165,
      bodyKind: 'reproductive',
      inspect: 'Hand-thinning window for stone fruit.'
    },
    {
      code: 'sizing',
      name: 'Fruit sizing',
      dayOfYearStart: 166,
      dayOfYearEnd: 220,
      bodyKind: 'ripening',
      inspect: 'Cover spray rotation; summer pruning.'
    },
    {
      code: 'color-change',
      name: 'Color change',
      dayOfYearStart: 221,
      dayOfYearEnd: 260,
      bodyKind: 'ripening',
      inspect: 'Brix climbs; pre-harvest fungicide PHI window opens.'
    },
    {
      code: 'harvest',
      name: 'Harvest',
      dayOfYearStart: 240,
      dayOfYearEnd: 305,
      bodyKind: 'ripening',
      inspect: 'Pick when characteristic flavor + color hits.'
    }
  ],
  harvestStageCode: 'harvest',
  harvestLabel: 'Fresh / market'
};

const perennialVineFruit: PerennialStageTemplate = {
  stages: [
    {
      code: 'dormant',
      name: 'Dormant',
      dayOfYearStart: 1,
      dayOfYearEnd: 60,
      bodyKind: 'dormant',
      inspect: 'Cane pruning window (Concord = 4-arm Kniffin).'
    },
    {
      code: 'bud-break',
      name: 'Bud break',
      dayOfYearStart: 90,
      dayOfYearEnd: 120,
      bodyKind: 'vegetative'
    },
    {
      code: 'bloom',
      name: 'Bloom',
      dayOfYearStart: 140,
      dayOfYearEnd: 165,
      bodyKind: 'reproductive',
      inspect: 'Pre-bloom mancozeb / copper for black rot + downy mildew.'
    },
    {
      code: 'fruit-set',
      name: 'Fruit set',
      dayOfYearStart: 165,
      dayOfYearEnd: 200,
      bodyKind: 'reproductive'
    },
    {
      code: 'veraison',
      name: 'Veraison',
      dayOfYearStart: 200,
      dayOfYearEnd: 240,
      bodyKind: 'ripening',
      inspect: 'Color change begins; sugar accumulation accelerates.'
    },
    {
      code: 'harvest',
      name: 'Harvest',
      dayOfYearStart: 240,
      dayOfYearEnd: 290,
      bodyKind: 'ripening',
      inspect: 'Brix ≥16 + characteristic foxy aroma (Concord).'
    }
  ],
  harvestStageCode: 'harvest',
  harvestLabel: 'Juice / table'
};

const perennialSmallFruit: PerennialStageTemplate = {
  stages: [
    { code: 'dormant', name: 'Dormant', dayOfYearStart: 1, dayOfYearEnd: 60, bodyKind: 'dormant' },
    {
      code: 'bud-break',
      name: 'Bud break',
      dayOfYearStart: 70,
      dayOfYearEnd: 100,
      bodyKind: 'vegetative'
    },
    {
      code: 'bloom',
      name: 'Bloom',
      dayOfYearStart: 100,
      dayOfYearEnd: 130,
      bodyKind: 'reproductive'
    },
    {
      code: 'fruit-set',
      name: 'Fruit set',
      dayOfYearStart: 125,
      dayOfYearEnd: 155,
      bodyKind: 'reproductive'
    },
    {
      code: 'sizing',
      name: 'Fruit sizing',
      dayOfYearStart: 145,
      dayOfYearEnd: 180,
      bodyKind: 'ripening'
    },
    {
      code: 'harvest',
      name: 'Harvest',
      dayOfYearStart: 160,
      dayOfYearEnd: 230,
      bodyKind: 'ripening'
    }
  ],
  harvestStageCode: 'harvest',
  harvestLabel: 'Fresh / U-pick'
};

export const PERENNIAL_DAYOFYEAR_TEMPLATES: Partial<Record<CropFamily, PerennialStageTemplate>> = {
  orchard: perennialDeciduousFruit,
  'stone-fruit': perennialDeciduousFruit,
  'vine-fruit': perennialVineFruit,
  'small-fruit': perennialSmallFruit,
  bramble: perennialSmallFruit
};

/**
 * Resolve which growth-stage table applies to a given crop plugin:
 *   1. Plugin's own `growthStageTable` if authored.
 *   2. Legacy `zadoksStages` normalized into a Zadoks-system table.
 *   3. Family default from FAMILY_STAGE_TEMPLATES.
 *   4. null when the family has no day-from-planting template (perennials).
 *      Caller should consult PERENNIAL_DAYOFYEAR_TEMPLATES instead.
 */
export function resolveGrowthStageTable(plug: CropPlugin): GrowthStageTable | null {
  if (plug.growthStageTable) return plug.growthStageTable;
  if (plug.zadoksStages?.length) {
    const normalized = normalizeZadoksToGrowthStageTable(plug.zadoksStages);
    if (normalized) return normalized;
  }
  return FAMILY_STAGE_TEMPLATES[plug.cropFamily] ?? null;
}

export function resolvePerennialTemplate(plug: CropPlugin): PerennialStageTemplate | null {
  return PERENNIAL_DAYOFYEAR_TEMPLATES[plug.cropFamily] ?? null;
}

/** Convert legacy `zadoksStages` shape into the v1.3 GrowthStageTable. */
export function normalizeZadoksToGrowthStageTable(
  legacy: ZadoksLegacy | undefined
): GrowthStageTable | null {
  if (!legacy?.length) return null;
  const stages: GrowthStage[] = legacy
    .slice()
    .sort((a, b) => a.daysFromPlanting.min - b.daysFromPlanting.min)
    .map((z) => ({
      code: z.stage,
      name: z.name,
      daysFromPlanting: { ...z.daysFromPlanting },
      bodyKind: zadoksBodyKind(z.stage)
    }));
  const last = stages[stages.length - 1];
  return {
    system: 'zadoks',
    referenceDtmDays: 240,
    stages,
    harvestTargets: [
      {
        stageCode: last.code,
        label: 'Dry-storage grain',
        useCase: 'dry-storage'
      }
    ]
  };
}

function zadoksBodyKind(code: string): GrowthStage['bodyKind'] {
  const n = parseInt(code.slice(1, 3), 10);
  if (Number.isNaN(n)) return 'transition';
  if (n < 30) return 'vegetative';
  if (n < 60) return 'reproductive';
  return 'ripening';
}
