/**
 * The demo farm's fixed content: Areas, beds, gear, products and the crop
 * templates the season timeline instantiates. Client-safe data only. Plugin
 * figures (days to maturity, rates, REI/PHI, chemistry) are copied from the
 * shipped plugin files; `catalog.test.ts` fails when they drift.
 */

import type { AreaDetails, AreaKind, BedStyle, BlockKind } from '$lib/farm/areaKinds';

export const DEMO_FARM_NAME = 'Willow Run Farm';

// ─── Areas and beds ─────────────────────────────────────────────────────

export type DemoAreaKey =
  | 'house'
  | 'barn'
  | 'coop'
  | 'garden'
  | 'tunnel'
  | 'orchard'
  | 'goatPasture'
  | 'hayMeadow'
  | 'northField';

export interface DemoArea {
  key: DemoAreaKey;
  name: string;
  kind: AreaKind;
  details: AreaDetails | null;
  /** Centre of the Area, in feet east/north of the farmhouse. */
  cxFt: number;
  cyFt: number;
  /** East-west and north-south extent in feet. */
  widthFt: number;
  lengthFt: number;
  notes?: string;
}

export const DEMO_AREAS: readonly DemoArea[] = [
  {
    key: 'house',
    name: 'Farmhouse',
    kind: 'residence',
    details: null,
    cxFt: 0,
    cyFt: 0,
    widthFt: 50,
    lengthFt: 40
  },
  {
    key: 'barn',
    name: 'Bank Barn',
    kind: 'barn',
    details: { washPack: true, coldStorage: false, chemicalStorage: true },
    cxFt: 130,
    cyFt: 10,
    widthFt: 80,
    lengthFt: 60,
    notes: 'Locked pesticide cabinet on the lower level, east wall.'
  },
  {
    key: 'coop',
    name: 'Chicken Coop',
    kind: 'coop_pen',
    details: {
      speciesId: 'chicken',
      space: 'both',
      shelterSqFt: 64,
      runSqFt: 240,
      capacity: 18,
      capacityProvenance: 'manual'
    },
    cxFt: 70,
    cyFt: -90,
    widthFt: 24,
    lengthFt: 30
  },
  {
    key: 'garden',
    name: 'Kitchen Garden',
    kind: 'garden',
    details: { organicStatus: 'non-organic', irrigation: 'drip' },
    cxFt: -110,
    cyFt: -60,
    widthFt: 40,
    lengthFt: 60
  },
  {
    key: 'tunnel',
    name: 'High Tunnel',
    kind: 'greenhouse',
    details: { structure: 'high-tunnel', heated: false, supplementalLight: false },
    cxFt: -110,
    cyFt: 50,
    widthFt: 30,
    lengthFt: 72
  },
  {
    key: 'orchard',
    name: 'Home Orchard',
    kind: 'orchard',
    details: { rowSpacingFt: 18, treeSpacingFt: 12 },
    cxFt: -260,
    cyFt: -40,
    widthFt: 120,
    lengthFt: 200
  },
  {
    key: 'goatPasture',
    name: 'Goat Pasture',
    kind: 'pasture',
    details: { use: 'graze' },
    cxFt: 260,
    cyFt: -220,
    widthFt: 300,
    lengthFt: 300
  },
  {
    key: 'hayMeadow',
    name: 'Lower Hay Meadow',
    kind: 'pasture',
    details: { use: 'hay' },
    cxFt: -150,
    cyFt: -520,
    widthFt: 600,
    lengthFt: 360
  },
  {
    key: 'northField',
    name: 'North Field',
    kind: 'field',
    details: null,
    cxFt: 0,
    cyFt: 720,
    widthFt: 660,
    lengthFt: 600,
    notes: 'Corn, soybean and wheat rotation. Tile drain outlet at the NE corner.'
  }
];

export type DemoBedKey =
  | 'nfA'
  | 'nfB'
  | 'nfC'
  | 'hay'
  | 'g1'
  | 'g2'
  | 'g3'
  | 'g4'
  | 'g5'
  | 'g6'
  | 'g7'
  | 'g8'
  | 'tE'
  | 'tW'
  | 'apple'
  | 'peach';

export interface DemoBed {
  key: DemoBedKey;
  area: DemoAreaKey;
  name: string;
  kind: BlockKind;
  widthFt: number;
  lengthFt: number;
  /** Map position: centre in feet from the farmhouse (blocks only). */
  cxFt?: number;
  cyFt?: number;
  /** Designer position inside the Area (beds only). */
  xFt?: number;
  yFt?: number;
  bedStyle?: BedStyle;
  tillage?: 'conventional' | 'reduced-till' | 'no-till';
}

const gardenBed = (key: DemoBedKey, n: number, xFt: number, yFt: number): DemoBed => ({
  key,
  area: 'garden',
  name: `Bed ${n}`,
  kind: 'bed',
  widthFt: 4,
  lengthFt: 16,
  xFt,
  yFt,
  bedStyle: 'raised'
});

export const DEMO_BEDS: readonly DemoBed[] = [
  {
    key: 'nfA',
    area: 'northField',
    name: 'North Field A',
    kind: 'block',
    widthFt: 220,
    lengthFt: 600,
    cxFt: -220,
    cyFt: 720,
    tillage: 'no-till'
  },
  {
    key: 'nfB',
    area: 'northField',
    name: 'North Field B',
    kind: 'block',
    widthFt: 220,
    lengthFt: 600,
    cxFt: 0,
    cyFt: 720,
    tillage: 'no-till'
  },
  {
    key: 'nfC',
    area: 'northField',
    name: 'North Field C',
    kind: 'block',
    widthFt: 220,
    lengthFt: 600,
    cxFt: 220,
    cyFt: 720,
    tillage: 'no-till'
  },
  {
    key: 'hay',
    area: 'hayMeadow',
    name: 'Hay Meadow',
    kind: 'block',
    widthFt: 600,
    lengthFt: 360,
    cxFt: -150,
    cyFt: -520,
    tillage: 'no-till'
  },
  gardenBed('g1', 1, 3, 6),
  gardenBed('g2', 2, 13, 6),
  gardenBed('g3', 3, 23, 6),
  gardenBed('g4', 4, 33, 6),
  gardenBed('g5', 5, 3, 36),
  gardenBed('g6', 6, 13, 36),
  gardenBed('g7', 7, 23, 36),
  gardenBed('g8', 8, 33, 36),
  {
    key: 'tE',
    area: 'tunnel',
    name: 'Tunnel East Bed',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 64,
    xFt: 21,
    yFt: 4,
    bedStyle: 'in-ground'
  },
  {
    key: 'tW',
    area: 'tunnel',
    name: 'Tunnel West Bed',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 64,
    xFt: 5,
    yFt: 4,
    bedStyle: 'in-ground'
  },
  {
    key: 'apple',
    area: 'orchard',
    name: 'Apple Row',
    kind: 'row',
    widthFt: 30,
    lengthFt: 190,
    cxFt: -290,
    cyFt: -40
  },
  {
    key: 'peach',
    area: 'orchard',
    name: 'Peach Row',
    kind: 'row',
    widthFt: 30,
    lengthFt: 190,
    cxFt: -230,
    cyFt: -40
  }
];

export function bedAcres(bed: Pick<DemoBed, 'widthFt' | 'lengthFt'>): number {
  return (bed.widthFt * bed.lengthFt) / 43_560;
}

// ─── Gear ───────────────────────────────────────────────────────────────

export type DemoEquipmentKey =
  | 'tractor'
  | 'boom'
  | 'backpack'
  | 'atv'
  | 'planter'
  | 'drill'
  | 'mower'
  | 'tedder'
  | 'rake'
  | 'baler';

export type DemoSprayerKey = 'boom' | 'backpack' | 'atv';

export interface DemoEquipment {
  key: DemoEquipmentKey;
  /** Starter-library template; type and label are copied from it. */
  templateId: string;
  notes?: string;
  calibratedGpa?: number;
  hourMeter?: number;
}

export const DEMO_EQUIPMENT: readonly DemoEquipment[] = [
  {
    key: 'tractor',
    templateId: 'tractor-compact-utility',
    notes: 'Kubota L3901, bought used in 2019. 10W-30 UDT fluid.',
    hourMeter: 1243
  },
  {
    key: 'boom',
    templateId: 'sprayer-50gal-pull',
    notes: 'TeeJet XR11003 tips. Rinse tank after every load.',
    calibratedGpa: 15
  },
  {
    key: 'backpack',
    templateId: 'sprayer-backpack-4gal',
    notes: 'Garden and tunnel only. Flat-fan tip for fungicides.',
    calibratedGpa: 32
  },
  {
    key: 'atv',
    templateId: 'sprayer-25gal-atv',
    notes: 'Orchard handgun. Copper and captan only.',
    calibratedGpa: 20
  },
  { key: 'planter', templateId: 'planter-2row-plate', notes: 'Corn and bean plates in the barn.' },
  { key: 'drill', templateId: 'no-till-drill-7ft', notes: 'Wheat and cover crops.' },
  { key: 'mower', templateId: 'mower-disc-mower-conditioner' },
  { key: 'tedder', templateId: 'tedder-4basket' },
  { key: 'rake', templateId: 'rake-side-delivery' },
  { key: 'baler', templateId: 'baler-small-square', notes: 'Spare shear bolts in the toolbox.' }
];

// ─── Products ───────────────────────────────────────────────────────────

export type DemoProductKind = 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer';

export interface DemoProduct {
  pluginId: string;
  kind: DemoProductKind;
  /** Plugin directory under `plugins/`. */
  dir: 'herbicides' | 'insecticides' | 'fungicides' | 'fertilizers';
  displayName: string;
  /** The plugin's `defaultUnit`; stock is kept in it. */
  unit: 'fl-oz' | 'lb' | 'gal';
  rate?: { amount: number; unit: string };
  /** Herbicide chemistry classes, insecticide IRAC or fungicide FRAC. */
  codes?: string[];
  reiHours?: number;
  phiDays?: number;
  /** Fertilizer guaranteed analysis. */
  npk?: { n: number; p: number; k: number };
  /** Label rate per acre in `unit`, used for stock draw-down. */
  perAcreInUnit?: number;
  /** A backpack load in `unit` for beds and rows (a few gallons of mix). */
  perLoadInUnit?: number;
  /** What a jug, bag or tote holds, in `unit`. */
  packSize: number;
  packCostCents: number;
  supplier: string;
  /** Count of packs bought this season. */
  packs: number;
  reorderAt?: number;
}

export const DEMO_PRODUCTS: Readonly<Record<string, DemoProduct>> = {
  'lumax-ez': {
    pluginId: 'lumax-ez',
    kind: 'herbicide',
    dir: 'herbicides',
    displayName: 'Lumax EZ (Syngenta premix)',
    unit: 'fl-oz',
    rate: { amount: 2.5, unit: 'qt' },
    codes: ['chloroacetamide', 'photosystem-ii-triazine', 'hppd-inhibitor'],
    perAcreInUnit: 80,
    packSize: 320,
    packCostCents: 31_500,
    supplier: 'Southern States, Leesburg',
    packs: 1,
    reorderAt: 160
  },
  callisto: {
    pluginId: 'callisto',
    kind: 'herbicide',
    dir: 'herbicides',
    displayName: 'Callisto (Syngenta mesotrione)',
    unit: 'fl-oz',
    rate: { amount: 3, unit: 'fl-oz' },
    codes: ['hppd-inhibitor'],
    perAcreInUnit: 3,
    packSize: 128,
    packCostCents: 41_000,
    supplier: 'Southern States, Leesburg',
    packs: 1
  },
  'dual-ii-magnum': {
    pluginId: 'dual-ii-magnum',
    kind: 'herbicide',
    dir: 'herbicides',
    displayName: 'Dual II Magnum (Syngenta)',
    unit: 'fl-oz',
    rate: { amount: 1.33, unit: 'pt' },
    codes: ['chloroacetamide'],
    perAcreInUnit: 21.3,
    packSize: 320,
    packCostCents: 28_900,
    supplier: 'Southern States, Leesburg',
    packs: 1
  },
  reflex: {
    pluginId: 'reflex',
    kind: 'herbicide',
    dir: 'herbicides',
    displayName: 'Reflex (Syngenta fomesafen)',
    unit: 'fl-oz',
    rate: { amount: 1.5, unit: 'pt' },
    codes: ['ppo-inhibitor'],
    perAcreInUnit: 24,
    packSize: 320,
    packCostCents: 27_500,
    supplier: 'Southern States, Leesburg',
    packs: 1
  },
  'zidua-sc': {
    pluginId: 'zidua-sc',
    kind: 'herbicide',
    dir: 'herbicides',
    displayName: 'Zidua SC (BASF pyroxasulfone)',
    unit: 'fl-oz',
    rate: { amount: 2.5, unit: 'fl-oz' },
    codes: ['vlcfa-pyroxasulfone'],
    perAcreInUnit: 2.5,
    packSize: 64,
    packCostCents: 16_800,
    supplier: 'Southern States, Leesburg',
    packs: 1
  },
  stinger: {
    pluginId: 'stinger',
    kind: 'herbicide',
    dir: 'herbicides',
    displayName: 'Stinger (Corteva clopyralid)',
    unit: 'fl-oz',
    rate: { amount: 0.25, unit: 'pt' },
    codes: ['synthetic-auxin'],
    perAcreInUnit: 4,
    packSize: 32,
    packCostCents: 9_400,
    supplier: 'Southern States, Leesburg',
    packs: 1
  },
  'kocide-3000-o': {
    pluginId: 'kocide-3000-o',
    kind: 'fungicide',
    dir: 'fungicides',
    displayName: 'Kocide 3000-O (Certis copper hydroxide)',
    unit: 'lb',
    rate: { amount: 1.75, unit: 'lb' },
    codes: ['M01'],
    reiHours: 48,
    phiDays: 1,
    perLoadInUnit: 0.12,
    packSize: 10,
    packCostCents: 13_900,
    supplier: 'Seven Springs Farm Supply',
    packs: 1
  },
  'captan-80wdg': {
    pluginId: 'captan-80wdg',
    kind: 'fungicide',
    dir: 'fungicides',
    displayName: 'Captan 80 WDG (Arysta phthalimide)',
    unit: 'lb',
    rate: { amount: 5, unit: 'lb' },
    codes: ['M04'],
    reiHours: 24,
    phiDays: 0,
    perLoadInUnit: 0.5,
    packSize: 5,
    packCostCents: 6_800,
    supplier: 'Seven Springs Farm Supply',
    packs: 1
  },
  'dipel-df': {
    pluginId: 'dipel-df',
    kind: 'insecticide',
    dir: 'insecticides',
    displayName: 'DiPel DF (Valent Bt kurstaki)',
    unit: 'lb',
    rate: { amount: 1, unit: 'lb' },
    codes: ['11A'],
    reiHours: 4,
    phiDays: 0,
    perLoadInUnit: 0.06,
    packSize: 1,
    packCostCents: 3_600,
    supplier: 'Seven Springs Farm Supply',
    packs: 1,
    reorderAt: 0.5
  },
  'uan-28': {
    pluginId: 'uan-28',
    kind: 'fertilizer',
    dir: 'fertilizers',
    displayName: 'UAN 28% (urea-ammonium nitrate liquid)',
    unit: 'gal',
    npk: { n: 28, p: 0, k: 0 },
    packSize: 60,
    packCostCents: 21_000,
    supplier: 'Southern States, Leesburg',
    packs: 1
  },
  'urea-46-0-0': {
    pluginId: 'urea-46-0-0',
    kind: 'fertilizer',
    dir: 'fertilizers',
    displayName: 'Urea (46-0-0)',
    unit: 'lb',
    npk: { n: 46, p: 0, k: 0 },
    packSize: 50,
    packCostCents: 3_400,
    supplier: 'Southern States, Leesburg',
    packs: 7
  },
  'dap-18-46-0': {
    pluginId: 'dap-18-46-0',
    kind: 'fertilizer',
    dir: 'fertilizers',
    displayName: 'DAP — Diammonium Phosphate (18-46-0)',
    unit: 'lb',
    npk: { n: 18, p: 46, k: 0 },
    packSize: 50,
    packCostCents: 3_900,
    supplier: 'Southern States, Leesburg',
    packs: 10
  },
  'composted-chicken-3-2-2': {
    pluginId: 'composted-chicken-3-2-2',
    kind: 'fertilizer',
    dir: 'fertilizers',
    displayName: 'Composted Chicken Manure (3-2-2)',
    unit: 'lb',
    npk: { n: 3, p: 2, k: 2 },
    packSize: 40,
    packCostCents: 1_299,
    supplier: 'Tractor Supply, Purcellville',
    packs: 4,
    reorderAt: 40
  }
};

// ─── Crops ──────────────────────────────────────────────────────────────

/** A calendar date in a season: `yearOffset` years from the season year. */
export interface SeasonDate {
  mmdd: string;
  yearOffset?: number;
}

export type DemoOpAt = { days: number } | SeasonDate;

export type DemoOp =
  | {
      kind: 'spray';
      at: DemoOpAt;
      product: string;
      sprayer: DemoSprayerKey;
      target?: string;
    }
  | {
      kind: 'fertilize';
      at: DemoOpAt;
      product: string;
      ratePerAcre: number;
      rateUnit: string;
    }
  | {
      kind: 'scout';
      at: DemoOpAt;
      pest: string;
      metric: string;
      value: [number, number];
      notes?: string;
    }
  | { kind: 'journal'; at: DemoOpAt; text: string }
  | { kind: 'chore'; at: DemoOpAt; title: string; body?: string };

export type DemoHarvestPlan =
  | {
      kind: 'once';
      /** Days after the window opens, or a calendar date. */
      at: { afterWindowStart: number } | SeasonDate;
      qty: [number, number];
      unit: string;
      moisturePct?: [number, number];
    }
  | {
      kind: 'picks';
      everyDays: number;
      /** Last pick: a date, or a number of picks. */
      until: SeasonDate | { count: number };
      qty: [number, number];
      unit: string;
    }
  | { kind: 'terminate'; at: SeasonDate };

export interface DemoCropTemplate {
  key: string;
  bed: DemoBedKey | ((season: number) => DemoBedKey);
  cropPluginId: string;
  variety: string;
  /** In-ground date. */
  plant: SeasonDate;
  /** The plugin's days to maturity. */
  dtm: [number, number];
  establishment: 'direct-seed' | 'transplant';
  /** Sown indoors this many weeks before the in-ground date. */
  indoorWeeks?: number;
  quantity?: { amount: number; unit: string };
  /** Place in the bed, in inches from the bed's corner, and spacing. */
  footprint?: { x_in: number; y_in: number; w_in: number; l_in: number };
  spacingIn?: number;
  harvest: DemoHarvestPlan;
  ops: DemoOp[];
  /** Also shown as last season's (harvested) planting. */
  history?: boolean;
  /** The seed lot it draws from (a `DEMO_SEEDS` key). */
  seed?: string;
}

const cornBlock = (season: number): DemoBedKey => (season % 2 === 0 ? 'nfA' : 'nfB');
const soyBlock = (season: number): DemoBedKey => (season % 2 === 0 ? 'nfB' : 'nfA');

export const DEMO_CROPS: readonly DemoCropTemplate[] = [
  {
    key: 'corn',
    bed: cornBlock,
    cropPluginId: 'corn-feed-dent-pioneer',
    variety: 'Pioneer P1257AM field corn',
    plant: { mmdd: '05-01' },
    dtm: [110, 120],
    establishment: 'direct-seed',
    quantity: { amount: 96_000, unit: 'seeds' },
    harvest: {
      kind: 'once',
      at: { afterWindowStart: 38 },
      qty: [480, 525],
      unit: 'bu',
      moisturePct: [14.1, 14.8]
    },
    ops: [
      {
        kind: 'fertilize',
        at: { days: 0 },
        product: 'dap-18-46-0',
        ratePerAcre: 150,
        rateUnit: 'lb'
      },
      { kind: 'spray', at: { days: 1 }, product: 'lumax-ez', sprayer: 'boom' },
      {
        kind: 'scout',
        at: { days: 24 },
        pest: 'broadleaf weeds',
        metric: 'count-per-10sqft',
        value: [1, 3],
        notes: 'Lambsquarters and a few giant ragweed escapes at the south end.'
      },
      { kind: 'spray', at: { days: 30 }, product: 'callisto', sprayer: 'boom' },
      { kind: 'fertilize', at: { days: 36 }, product: 'uan-28', ratePerAcre: 18, rateUnit: 'gal' },
      {
        kind: 'scout',
        at: { days: 63 },
        pest: 'European corn borer',
        metric: 'count-per-plant',
        value: [0, 0.2],
        notes: 'Shot-hole feeding on a handful of plants. Below threshold.'
      }
    ],
    history: true,
    seed: 'corn'
  },
  {
    key: 'soy',
    bed: soyBlock,
    cropPluginId: 'soybean-asgrow-roundup-ready-2-xtend',
    variety: 'Asgrow AG38X8 soybeans',
    plant: { mmdd: '05-15' },
    dtm: [110, 125],
    establishment: 'direct-seed',
    quantity: { amount: 450_000, unit: 'seeds' },
    harvest: {
      kind: 'once',
      at: { afterWindowStart: 22 },
      qty: [150, 172],
      unit: 'bu',
      moisturePct: [12.2, 13.0]
    },
    ops: [
      { kind: 'spray', at: { days: 1 }, product: 'dual-ii-magnum', sprayer: 'boom' },
      {
        kind: 'scout',
        at: { days: 27 },
        pest: 'waterhemp',
        metric: 'count-per-10sqft',
        value: [2, 5],
        notes: 'Waterhemp flushing along the fence row.'
      },
      { kind: 'spray', at: { days: 32 }, product: 'reflex', sprayer: 'boom' },
      {
        kind: 'scout',
        at: { days: 78 },
        pest: 'brown marmorated stink bug',
        metric: 'count-per-sweep',
        value: [0.1, 0.6]
      }
    ],
    history: true,
    seed: 'soy'
  },
  {
    key: 'wheat',
    bed: 'nfC',
    cropPluginId: 'wheat-soft-red-winter',
    variety: 'Hilliard soft red winter wheat',
    plant: { mmdd: '10-12', yearOffset: -1 },
    dtm: [240, 270],
    establishment: 'direct-seed',
    quantity: { amount: 360, unit: 'lb' },
    harvest: {
      kind: 'once',
      at: { mmdd: '06-24' },
      qty: [195, 228],
      unit: 'bu',
      moisturePct: [12.6, 13.2]
    },
    ops: [
      { kind: 'spray', at: { days: 3 }, product: 'zidua-sc', sprayer: 'boom' },
      {
        kind: 'fertilize',
        at: { mmdd: '03-02' },
        product: 'urea-46-0-0',
        ratePerAcre: 100,
        rateUnit: 'lb'
      },
      { kind: 'spray', at: { mmdd: '03-27' }, product: 'stinger', sprayer: 'boom' },
      {
        kind: 'scout',
        at: { mmdd: '04-21' },
        pest: 'powdery mildew',
        metric: 'percent-leaf-area',
        value: [2, 6],
        notes: 'Lower canopy only. Flag leaf clean.'
      },
      {
        kind: 'scout',
        at: { mmdd: '05-12' },
        pest: 'cereal leaf beetle',
        metric: 'count-per-stem',
        value: [0.1, 0.4]
      }
    ],
    history: true,
    seed: 'wheat'
  },
  {
    key: 'rye',
    bed: soyBlock,
    cropPluginId: 'cereal-rye-cover',
    variety: 'Aroostook cereal rye cover',
    plant: { mmdd: '10-03', yearOffset: -1 },
    dtm: [180, 240],
    establishment: 'direct-seed',
    quantity: { amount: 330, unit: 'lb' },
    harvest: { kind: 'terminate', at: { mmdd: '04-28' } },
    ops: [
      {
        kind: 'chore',
        at: { mmdd: '04-24' },
        title: 'Roll-crimp the cereal rye ahead of soybeans',
        body: 'Wait for anthesis (pollen shedding) so it does not stand back up.'
      }
    ],
    seed: 'rye'
  },
  {
    key: 'cherokee',
    bed: 'g1',
    cropPluginId: 'tomato-cherokee-purple',
    variety: 'Cherokee Purple',
    plant: { mmdd: '05-10' },
    dtm: [80, 90],
    establishment: 'transplant',
    indoorWeeks: 7,
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
    spacingIn: 24,
    harvest: { kind: 'picks', everyDays: 8, until: { mmdd: '10-08' }, qty: [6, 14], unit: 'lb' },
    ops: [
      {
        kind: 'fertilize',
        at: { days: -5 },
        product: 'composted-chicken-3-2-2',
        ratePerAcre: 2000,
        rateUnit: 'lb'
      },
      {
        kind: 'journal',
        at: { days: 1 },
        text: 'Set out 8 Cherokee Purple on the drip line, staked and watered in. Stems buried to the first true leaves.'
      },
      { kind: 'spray', at: { days: 35 }, product: 'kocide-3000-o', sprayer: 'backpack' },
      {
        kind: 'scout',
        at: { days: 45 },
        pest: 'tomato hornworm',
        metric: 'count-per-plant',
        value: [0, 1],
        notes: 'Two hornworms hand-picked. Frass on the lower leaves.'
      },
      { kind: 'spray', at: { days: 49 }, product: 'kocide-3000-o', sprayer: 'backpack' },
      {
        kind: 'spray',
        at: { days: 58 },
        product: 'dipel-df',
        sprayer: 'backpack',
        target: 'tomato hornworm'
      },
      { kind: 'spray', at: { days: 63 }, product: 'kocide-3000-o', sprayer: 'backpack' },
      {
        kind: 'journal',
        at: { days: 84 },
        text: 'First ripe Cherokee Purples. Some cracking at the shoulders after the heavy rain.'
      },
      { kind: 'spray', at: { days: 77 }, product: 'kocide-3000-o', sprayer: 'backpack' }
    ],
    history: true,
    seed: 'cherokee'
  },
  {
    key: 'sungold',
    bed: 'g1',
    cropPluginId: 'tomato-sun-gold-f1',
    variety: 'Sun Gold cherry tomato',
    plant: { mmdd: '05-10' },
    dtm: [57, 65],
    establishment: 'transplant',
    indoorWeeks: 7,
    footprint: { x_in: 0, y_in: 96, w_in: 48, l_in: 96 },
    spacingIn: 24,
    harvest: { kind: 'picks', everyDays: 7, until: { mmdd: '10-10' }, qty: [3, 7], unit: 'lb' },
    ops: [
      {
        kind: 'journal',
        at: { days: 62 },
        text: 'Sun Golds are splitting after rain. Picking every few days at the orange stage.'
      }
    ],
    seed: 'sungold'
  },
  {
    key: 'bell',
    bed: 'g2',
    cropPluginId: 'pepper-bell-california-wonder',
    variety: 'California Wonder bell pepper',
    plant: { mmdd: '05-20' },
    dtm: [70, 75],
    establishment: 'transplant',
    indoorWeeks: 9,
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
    spacingIn: 18,
    harvest: { kind: 'picks', everyDays: 7, until: { mmdd: '10-10' }, qty: [3, 6], unit: 'lb' },
    ops: [
      {
        kind: 'scout',
        at: { days: 40 },
        pest: 'green peach aphid',
        metric: 'count-per-leaf',
        value: [1, 4]
      }
    ],
    seed: 'bell'
  },
  {
    key: 'jalapeno',
    bed: 'g2',
    cropPluginId: 'pepper-jalapeno',
    variety: 'Early Jalapeño',
    plant: { mmdd: '05-20' },
    dtm: [70, 80],
    establishment: 'transplant',
    indoorWeeks: 9,
    footprint: { x_in: 0, y_in: 96, w_in: 48, l_in: 96 },
    spacingIn: 18,
    harvest: { kind: 'picks', everyDays: 7, until: { mmdd: '10-10' }, qty: [1, 3], unit: 'lb' },
    ops: []
  },
  {
    key: 'buttercrunch',
    bed: 'g3',
    cropPluginId: 'lettuce-buttercrunch',
    variety: 'Buttercrunch lettuce',
    plant: { mmdd: '04-01' },
    dtm: [50, 60],
    establishment: 'transplant',
    indoorWeeks: 4,
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
    spacingIn: 8,
    harvest: { kind: 'picks', everyDays: 6, until: { count: 4 }, qty: [2, 4], unit: 'lb' },
    ops: [
      {
        kind: 'journal',
        at: { days: 3 },
        text: 'Row cover on for the cold snap. Hardened off a week on the porch first.'
      }
    ],
    seed: 'lettuce'
  },
  {
    key: 'redsails',
    bed: 'g3',
    cropPluginId: 'lettuce-red-sails',
    variety: 'Red Sails lettuce (fall succession)',
    plant: { mmdd: '08-12' },
    dtm: [45, 55],
    establishment: 'transplant',
    indoorWeeks: 4,
    footprint: { x_in: 0, y_in: 96, w_in: 48, l_in: 96 },
    spacingIn: 10,
    harvest: { kind: 'picks', everyDays: 6, until: { count: 4 }, qty: [1.5, 3], unit: 'lb' },
    ops: [],
    seed: 'lettuce'
  },
  {
    key: 'beans',
    bed: 'g4',
    cropPluginId: 'bush-bean-provider',
    variety: 'Provider bush bean',
    plant: { mmdd: '05-20' },
    dtm: [50, 55],
    establishment: 'direct-seed',
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 192 },
    spacingIn: 6,
    harvest: { kind: 'picks', everyDays: 4, until: { count: 6 }, qty: [3, 6], unit: 'lb' },
    ops: [
      {
        kind: 'scout',
        at: { days: 30 },
        pest: 'Mexican bean beetle',
        metric: 'count-per-plant',
        value: [0, 0.5]
      }
    ],
    seed: 'beans'
  },
  {
    key: 'zucchini',
    bed: 'g5',
    cropPluginId: 'zucchini-black-beauty',
    variety: 'Black Beauty zucchini',
    plant: { mmdd: '05-25' },
    dtm: [50, 60],
    establishment: 'direct-seed',
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
    spacingIn: 24,
    harvest: { kind: 'picks', everyDays: 6, until: { mmdd: '09-05' }, qty: [4, 9], unit: 'lb' },
    ops: [
      {
        kind: 'scout',
        at: { days: 35 },
        pest: 'squash bug',
        metric: 'count-per-plant',
        value: [0.5, 2],
        notes: 'Egg clusters scraped off the leaf undersides.'
      }
    ]
  },
  {
    key: 'butternut',
    bed: 'g5',
    cropPluginId: 'butternut-squash-waltham',
    variety: 'Waltham butternut',
    plant: { mmdd: '06-01' },
    dtm: [95, 105],
    establishment: 'direct-seed',
    footprint: { x_in: 0, y_in: 96, w_in: 48, l_in: 96 },
    spacingIn: 36,
    harvest: { kind: 'once', at: { afterWindowStart: 16 }, qty: [30, 42], unit: 'squash' },
    ops: [],
    history: true
  },
  {
    key: 'garlic',
    bed: 'g6',
    cropPluginId: 'garlic-music-hardneck',
    variety: 'Music hardneck garlic',
    plant: { mmdd: '10-20', yearOffset: -1 },
    dtm: [240, 270],
    establishment: 'direct-seed',
    quantity: { amount: 3, unit: 'lb' },
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 192 },
    spacingIn: 6,
    harvest: { kind: 'once', at: { mmdd: '07-02' }, qty: [160, 190], unit: 'bulbs' },
    ops: [
      {
        kind: 'fertilize',
        at: { days: -3 },
        product: 'composted-chicken-3-2-2',
        ratePerAcre: 2000,
        rateUnit: 'lb'
      },
      {
        kind: 'journal',
        at: { days: 1 },
        text: 'Planted the biggest cloves 6 in apart, mulched with straw.'
      },
      {
        kind: 'scout',
        at: { mmdd: '04-16' },
        pest: 'onion thrips',
        metric: 'count-per-plant',
        value: [0, 2]
      },
      {
        kind: 'chore',
        at: { mmdd: '06-05' },
        title: 'Snap garlic scapes in Bed 6',
        body: 'Pull scapes once they curl so the bulbs size up.'
      }
    ],
    seed: 'garlic'
  },
  {
    key: 'basil',
    bed: 'g7',
    cropPluginId: 'basil-genovese',
    variety: 'Genovese basil',
    plant: { mmdd: '05-15' },
    dtm: [60, 80],
    establishment: 'transplant',
    indoorWeeks: 6,
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
    spacingIn: 12,
    harvest: {
      kind: 'picks',
      everyDays: 10,
      until: { mmdd: '09-25' },
      qty: [0.5, 1.5],
      unit: 'lb'
    },
    ops: []
  },
  {
    key: 'carrots',
    bed: 'g8',
    cropPluginId: 'carrot-scarlet-nantes-seed',
    variety: 'Scarlet Nantes carrot',
    plant: { mmdd: '04-10' },
    dtm: [68, 68],
    establishment: 'direct-seed',
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
    spacingIn: 2,
    harvest: { kind: 'once', at: { afterWindowStart: 6 }, qty: [18, 26], unit: 'lb' },
    ops: [
      {
        kind: 'journal',
        at: { days: 12 },
        text: 'Good germination under the board. Thinned to 2 in.'
      }
    ],
    seed: 'carrots'
  },
  {
    key: 'kale',
    bed: 'g8',
    cropPluginId: 'kale-lacinato',
    variety: 'Lacinato (dinosaur) kale',
    plant: { mmdd: '08-08' },
    dtm: [55, 65],
    establishment: 'transplant',
    indoorWeeks: 5,
    footprint: { x_in: 0, y_in: 96, w_in: 48, l_in: 96 },
    spacingIn: 12,
    harvest: { kind: 'picks', everyDays: 10, until: { mmdd: '12-15' }, qty: [1, 3], unit: 'lb' },
    ops: [
      {
        kind: 'scout',
        at: { days: 18 },
        pest: 'imported cabbageworm',
        metric: 'count-per-plant',
        value: [0.4, 1.2]
      },
      {
        kind: 'spray',
        at: { days: 21 },
        product: 'dipel-df',
        sprayer: 'backpack',
        target: 'imported cabbageworm'
      }
    ]
  },
  {
    key: 'juliet',
    bed: 'tE',
    cropPluginId: 'tomato-juliet-f1',
    variety: 'Juliet grape tomato',
    plant: { mmdd: '04-08' },
    dtm: [60, 70],
    establishment: 'transplant',
    indoorWeeks: 8,
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 384 },
    spacingIn: 24,
    harvest: { kind: 'picks', everyDays: 9, until: { mmdd: '10-28' }, qty: [3, 6], unit: 'lb' },
    ops: [
      {
        kind: 'scout',
        at: { days: 30 },
        pest: 'aphids',
        metric: 'count-per-leaf',
        value: [1, 3]
      },
      { kind: 'spray', at: { days: 42 }, product: 'kocide-3000-o', sprayer: 'backpack' },
      { kind: 'spray', at: { days: 56 }, product: 'kocide-3000-o', sprayer: 'backpack' }
    ],
    seed: 'juliet'
  },
  {
    key: 'cukes',
    bed: 'tW',
    cropPluginId: 'cucumber-marketmore-76',
    variety: 'Marketmore 76 cucumber',
    plant: { mmdd: '04-12' },
    dtm: [55, 65],
    establishment: 'transplant',
    indoorWeeks: 3,
    footprint: { x_in: 0, y_in: 384, w_in: 48, l_in: 384 },
    spacingIn: 12,
    harvest: { kind: 'picks', everyDays: 6, until: { mmdd: '08-20' }, qty: [4, 8], unit: 'lb' },
    ops: []
  },
  {
    key: 'spinach',
    bed: 'tW',
    cropPluginId: 'spinach-bloomsdale-long-standing',
    variety: 'Bloomsdale Long Standing spinach',
    plant: { mmdd: '09-25', yearOffset: -1 },
    dtm: [40, 55],
    establishment: 'direct-seed',
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 384 },
    spacingIn: 4,
    harvest: {
      kind: 'picks',
      everyDays: 14,
      until: { mmdd: '03-20' },
      qty: [1.5, 3],
      unit: 'lb'
    },
    ops: [
      {
        kind: 'journal',
        at: { days: 70 },
        text: 'Double row cover inside the tunnel tonight, low of 14°F forecast.'
      }
    ],
    seed: 'spinach'
  }
];

/** Perennials are planted once, years before the season on show. */
export interface DemoPerennial {
  key: string;
  bed: DemoBedKey;
  cropPluginId: string;
  variety: string;
  /** Planted on `mmdd` this many years before the season on show, so its
   *  planting date stays put as the demo date moves within a season. */
  planted: { mmdd: string; yearsAgo: number };
  dtm: [number, number];
  picks?: { start: string; everyDays: number; count: number; qty: [number, number]; unit: string };
  ops: Array<{
    mmdd: string;
    product: string;
    sprayer: DemoSprayerKey;
    target?: string;
  }>;
  /** Hay cuttings: mow dates in each season. */
  cuttings?: string[];
}

export const DEMO_PERENNIALS: readonly DemoPerennial[] = [
  {
    key: 'apple',
    bed: 'apple',
    cropPluginId: 'apple-honeycrisp',
    variety: 'Honeycrisp apple on G.41',
    planted: { mmdd: '03-25', yearsAgo: 4 },
    dtm: [1095, 1825],
    picks: { start: '09-08', everyDays: 7, count: 4, qty: [3, 6], unit: 'bu' },
    ops: [
      { mmdd: '03-22', product: 'kocide-3000-o', sprayer: 'atv', target: 'fire blight' },
      { mmdd: '05-06', product: 'captan-80wdg', sprayer: 'atv', target: 'apple scab' }
    ]
  },
  {
    key: 'peach',
    bed: 'peach',
    cropPluginId: 'peach-redhaven',
    variety: 'Redhaven peach',
    planted: { mmdd: '03-20', yearsAgo: 3 },
    dtm: [1095, 1460],
    picks: { start: '07-18', everyDays: 5, count: 4, qty: [1, 3], unit: 'bu' },
    ops: [
      { mmdd: '03-06', product: 'kocide-3000-o', sprayer: 'atv', target: 'peach leaf curl' },
      { mmdd: '11-18', product: 'kocide-3000-o', sprayer: 'atv', target: 'peach leaf curl' }
    ]
  },
  {
    key: 'orchardgrass',
    bed: 'hay',
    cropPluginId: 'orchard-grass-potomac',
    variety: 'Potomac orchardgrass hay',
    planted: { mmdd: '09-05', yearsAgo: 4 },
    dtm: [365, 1825],
    ops: [],
    cuttings: ['05-18', '06-29', '08-13', '09-27']
  }
];

// ─── Seed ───────────────────────────────────────────────────────────────

export interface DemoSeed {
  key: string;
  cropPluginId: string;
  displayName: string;
  unit: 'seeds' | 'lb' | 'oz' | 'g';
  onHand: number;
  costCents: number;
  supplier: string;
  lotNumber: string;
  reorderAt?: number;
  /** An extra lot that is ordered or planned, not on hand yet. */
  pending?: {
    status: 'ordered' | 'planned';
    quantity: number;
    supplier: string;
    costCents?: number;
  };
}

export const DEMO_SEEDS: readonly DemoSeed[] = [
  {
    key: 'corn',
    cropPluginId: 'corn-feed-dent-pioneer',
    displayName: 'Pioneer P1257AM corn seed',
    unit: 'seeds',
    onHand: 160_000,
    costCents: 54_000,
    supplier: 'Pioneer rep (Hamilton)',
    lotNumber: 'P1257-24A'
  },
  {
    key: 'soy',
    cropPluginId: 'soybean-asgrow-roundup-ready-2-xtend',
    displayName: 'Asgrow AG38X8 soybean seed',
    unit: 'seeds',
    onHand: 560_000,
    costCents: 38_500,
    supplier: 'Southern States, Leesburg',
    lotNumber: 'AG38-1127'
  },
  {
    key: 'wheat',
    cropPluginId: 'wheat-soft-red-winter',
    displayName: 'Hilliard wheat seed (certified)',
    unit: 'lb',
    onHand: 450,
    costCents: 19_800,
    supplier: 'Southern States, Leesburg',
    lotNumber: 'HIL-0931'
  },
  {
    key: 'rye',
    cropPluginId: 'cereal-rye-cover',
    displayName: 'Aroostook cereal rye (bin-run)',
    unit: 'lb',
    onHand: 400,
    costCents: 15_600,
    supplier: 'King’s AgriSeeds',
    lotNumber: 'AR-2219'
  },
  {
    key: 'cherokee',
    cropPluginId: 'tomato-cherokee-purple',
    displayName: 'Cherokee Purple tomato seed',
    unit: 'seeds',
    onHand: 40,
    costCents: 495,
    supplier: 'Southern Exposure Seed Exchange',
    lotNumber: 'SESE-61312'
  },
  {
    key: 'sungold',
    cropPluginId: 'tomato-sun-gold-f1',
    displayName: 'Sun Gold F1 tomato seed',
    unit: 'seeds',
    onHand: 15,
    costCents: 625,
    supplier: 'Johnny’s Selected Seeds',
    lotNumber: 'JSS-2771',
    reorderAt: 20,
    pending: {
      status: 'ordered',
      quantity: 25,
      supplier: 'Johnny’s Selected Seeds',
      costCents: 795
    }
  },
  {
    key: 'bell',
    cropPluginId: 'pepper-bell-california-wonder',
    displayName: 'California Wonder pepper seed',
    unit: 'seeds',
    onHand: 120,
    costCents: 395,
    supplier: 'Southern Exposure Seed Exchange',
    lotNumber: 'SESE-50213'
  },
  {
    key: 'lettuce',
    cropPluginId: 'lettuce-buttercrunch',
    displayName: 'Buttercrunch lettuce seed',
    unit: 'g',
    onHand: 4,
    costCents: 375,
    supplier: 'Johnny’s Selected Seeds',
    lotNumber: 'JSS-1180'
  },
  {
    key: 'beans',
    cropPluginId: 'bush-bean-provider',
    displayName: 'Provider bush bean seed',
    unit: 'lb',
    onHand: 1,
    costCents: 1_150,
    supplier: 'Johnny’s Selected Seeds',
    lotNumber: 'JSS-0645'
  },
  {
    key: 'carrots',
    cropPluginId: 'carrot-scarlet-nantes-seed',
    displayName: 'Scarlet Nantes carrot seed',
    unit: 'g',
    onHand: 10,
    costCents: 425,
    supplier: 'Baker Creek',
    lotNumber: 'BC-7782'
  },
  {
    key: 'juliet',
    cropPluginId: 'tomato-juliet-f1',
    displayName: 'Juliet F1 grape tomato seed',
    unit: 'seeds',
    onHand: 30,
    costCents: 650,
    supplier: 'Johnny’s Selected Seeds',
    lotNumber: 'JSS-3302'
  },
  {
    key: 'spinach',
    cropPluginId: 'spinach-bloomsdale-long-standing',
    displayName: 'Bloomsdale spinach seed',
    unit: 'oz',
    onHand: 2,
    costCents: 450,
    supplier: 'Southern Exposure Seed Exchange',
    lotNumber: 'SESE-22104'
  },
  {
    key: 'garlic',
    cropPluginId: 'garlic-music-hardneck',
    displayName: 'Music garlic, seed stock',
    unit: 'lb',
    onHand: 4,
    costCents: 0,
    supplier: 'Saved from last year’s crop',
    lotNumber: 'WR-GARLIC',
    pending: { status: 'planned', quantity: 5, supplier: 'Keene Organics' }
  }
];

// ─── Animals ────────────────────────────────────────────────────────────

export const DEMO_GOATS = [
  { name: 'Clover', tag: 'G-01', breed: 'Nigerian Dwarf' },
  { name: 'Hazel', tag: 'G-02', breed: 'Nigerian Dwarf' },
  { name: 'Juniper', tag: 'G-03', breed: 'Nigerian Dwarf × Alpine' }
] as const;

export const DEMO_FLOCK_SIZE = 15;
