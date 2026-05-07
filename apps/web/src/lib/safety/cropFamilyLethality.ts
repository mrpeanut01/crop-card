/**
 * Plugin-immune kill matrix: which chemistry classes are lethal to which
 * crop families. The Safety Kernel reads from this to enforce FR-03's
 * "block eligibility = intersection of safe crops" rule. Plugin files
 * cannot widen safety — they reference a `chemistryClass` from this enum
 * and the kernel decides what it kills.
 *
 * Adding or relaxing entries is a kernel change: bump RULES_VERSION and
 * write tests against the spec's herbicide-compatibility table (§4.4).
 */

import type { ChemistryClass } from './types';

export const CROP_FAMILIES = [
  // Legacy v1 families
  'corn',
  'cucurbit',
  'legume',
  'broadleaf-companion',
  'orchard',
  'cover-grass',
  'cover-legume',
  // Phase 9 expansion — botanical taxonomy used by extension services
  'solanaceae',       // tomato, pepper, eggplant, potato, tomatillo
  'brassica',         // cabbage, broccoli, cauliflower, kale, collards, radish, turnip, mustard greens
  'allium',           // onion, garlic, leek, shallot, scallion
  'leafy-green',      // lettuce, spinach, swiss-chard, arugula
  'root',             // carrot, beet, parsnip, sweet-potato, radish-root
  'apiaceae',         // celery, parsley, dill, fennel, cilantro
  'small-fruit',      // strawberry, blueberry, currant, gooseberry, elderberry
  'bramble',          // raspberry, blackberry (Rubus)
  'vine-fruit',       // grape (Vitis), kiwi
  'stone-fruit',      // peach, plum, cherry, apricot, nectarine (Prunus)
  'cereal-grain',     // wheat, oats, barley, rye-grain, sorghum, millet (cash crop, not cover)
  'forage',           // alfalfa, clover-hay, timothy, orchard-grass-hay
  'herb-culinary'     // basil, oregano, thyme, rosemary, sage, mint, chives
] as const;

export type CropFamily = (typeof CROP_FAMILIES)[number];

export interface ChemistryProfile {
  killsFamilies: ReadonlyArray<CropFamily>;
  notes: string;
  /** HRAC global mode-of-action group number. Used for UI badges + resistance hints. */
  hracGroup: number;
}

/**
 * All non-glyphosate, non-burndown chemistries are tolerant on `cereal-grain`
 * (wheat/oats/barley) only when the label explicitly claims that crop. This
 * matrix takes the conservative position: if a class is not commonly used
 * in cereals, it's listed as lethal there. Plugins can claim safety for
 * specific cultivars via labelClaims.safeForCropPluginIds.
 */
export const CHEMISTRY_KILL_MATRIX: Readonly<Record<ChemistryClass, ChemistryProfile>> = {
  // ─── Legacy v1 classes ──────────────────────────────────────────────────
  'synthetic-auxin': {
    hracGroup: 4,
    killsFamilies: [
      'cucurbit',
      'legume',
      'broadleaf-companion',
      'orchard',
      'solanaceae',
      'brassica',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'herb-culinary',
      'cover-legume'
    ],
    notes: '2,4-D, dicamba and similar HRAC 4 auxin mimics. Highly drift-prone over broadleaves. Cereal grain (wheat, oats, barley) and grass hay are class-tolerant — true grasses. Soybean RR2-Xtend / dicamba-tolerant cultivars need explicit cultivar opt-in via labelClaims.safeForCropPluginIds.'
  },
  chloroacetamide: {
    hracGroup: 15,
    killsFamilies: [
      'cucurbit',
      'broadleaf-companion',
      'orchard',
      'solanaceae',
      'brassica',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'herb-culinary',
      'cover-legume'
    ],
    notes: 'Me-Too-Lachlor / S-metolachlor / acetochlor (HRAC 15, formerly K3). Soil-active VLCFA inhibitor; persistent residue. Soybean / corn / cotton / peanut are label-tolerant via deep seed placement; tomato / pepper labels are rate-sensitive — claim explicitly via safeForCropPluginIds.'
  },
  'hppd-inhibitor': {
    hracGroup: 27,
    killsFamilies: [
      'cucurbit',
      'legume',
      'broadleaf-companion',
      'orchard',
      'solanaceae',
      'brassica',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'herb-culinary',
      'cover-legume',
      'forage'
    ],
    notes: 'Mesotrione, tembotrione (HRAC 27). Corn / cereal-tolerant only; lethal to broadleaves.'
  },
  'accase-inhibitor': {
    hracGroup: 1,
    killsFamilies: ['corn', 'cover-grass', 'cereal-grain'],
    notes: 'Clethodim, sethoxydim, fluazifop (HRAC 1). Selective grass killer — DO NOT spray over corn or cereals.'
  },
  glyphosate: {
    hracGroup: 9,
    killsFamilies: [
      'corn',
      'cucurbit',
      'legume',
      'broadleaf-companion',
      'orchard',
      'cover-grass',
      'cover-legume',
      'solanaceae',
      'brassica',
      'allium',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'cereal-grain',
      'forage',
      'herb-culinary'
    ],
    notes: 'Non-selective EPSPS inhibitor (HRAC 9). Pre-plant burndown only; never over standing crop unless trait-resistant + labelClaims.safeForCropPluginIds asserts it.'
  },
  sulfonylurea: {
    hracGroup: 2,
    killsFamilies: [
      'legume',
      'broadleaf-companion',
      'solanaceae',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'herb-culinary',
      'cover-legume'
    ],
    notes: 'Stadia-class (HRAC 2 SU). Corn-tolerant POST; check pumpkin label for stage window. Some cereal-grain SUs exist (e.g., Harmony SG) but default-block.'
  },

  // ─── Phase 9 expansion ──────────────────────────────────────────────────
  'microtubule-inhibitor': {
    hracGroup: 3,
    killsFamilies: [
      'allium'
    ],
    notes: 'Pendimethalin (Prowl H2O), trifluralin (Treflan), HRAC 3 dinitroanilines. PRE soil-active. Corn / soybean / cereals / vegetables are label-tolerant via deep seedbed placement. Alliums (shallow + bulb-sensitive) are not.'
  },
  'photosystem-ii-triazine': {
    hracGroup: 5,
    killsFamilies: [
      'cucurbit',
      'legume',
      'broadleaf-companion',
      'solanaceae',
      'brassica',
      'allium',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'stone-fruit',
      'herb-culinary',
      'cover-legume',
      'forage'
    ],
    notes: 'Atrazine, simazine, metribuzin (HRAC 5). Corn / sorghum tolerant; established orchard / vineyard FLOOR use is label-allowed via simazine (Princep); deeper-rooted perennial trees + vines tolerate residual when foliar contact is avoided. Long soil persistence — rotation restrictions apply.'
  },
  'photosystem-i-diquat': {
    hracGroup: 22,
    killsFamilies: [
      'corn',
      'cucurbit',
      'legume',
      'broadleaf-companion',
      'orchard',
      'cover-grass',
      'cover-legume',
      'solanaceae',
      'brassica',
      'allium',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'cereal-grain',
      'forage',
      'herb-culinary'
    ],
    notes: 'Paraquat (Gramoxone SL), diquat (HRAC 22). Non-selective contact burndown. Restricted-use; strict drift + PPE requirements.'
  },
  glufosinate: {
    hracGroup: 10,
    killsFamilies: [
      'corn',
      'cucurbit',
      'legume',
      'broadleaf-companion',
      'orchard',
      'cover-grass',
      'cover-legume',
      'solanaceae',
      'brassica',
      'allium',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'cereal-grain',
      'forage',
      'herb-culinary'
    ],
    notes: 'Liberty / Liberty Ultra (HRAC 10). Non-selective burndown unless trait-resistant. Tank residue cannot be safely applied over any non-trait crop.'
  },
  'ppo-inhibitor': {
    hracGroup: 14,
    killsFamilies: [
      'cucurbit',
      'broadleaf-companion',
      'solanaceae',
      'brassica',
      'leafy-green',
      'root',
      'apiaceae',
      'herb-culinary',
      'cover-legume'
    ],
    notes: 'Fomesafen (Reflex), flumioxazin (Valor), sulfentrazone, lactofen (Cobra) — HRAC 14 PPO inhibitors. Soybean / dry-bean / snap-bean POST-tolerant; perennial fruit (orchard / blueberry / grape / bramble) labels exist for soil-applied flumioxazin under established stands.'
  },
  'als-imidazolinone': {
    hracGroup: 2,
    killsFamilies: [
      'corn',
      'cucurbit',
      'broadleaf-companion',
      'orchard',
      'solanaceae',
      'brassica',
      'allium',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'cereal-grain',
      'herb-culinary',
      'cover-grass'
    ],
    notes: 'Imazethapyr (Pursuit), imazamox (Beyond) — HRAC 2 IMI subset. Legume + alfalfa-tolerant POST (soybean, dry bean, alfalfa); long soil residual restricts rotation to corn / cucurbits / vegetables for 12-26 mo. Clearfield/IMI-resistant wheat must opt back in via labelClaims.safeForCropPluginIds.'
  },
  'vlcfa-pyroxasulfone': {
    hracGroup: 15,
    killsFamilies: [
      'cucurbit',
      'broadleaf-companion',
      'orchard',
      'solanaceae',
      'brassica',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'herb-culinary',
      'cover-legume'
    ],
    notes: 'Pyroxasulfone (Zidua, Anthem MAXX) — HRAC 15 isoxazoline VLCFA inhibitor. Soil-active PRE; corn / soybean / cereal label-tolerant.'
  },
  clomazone: {
    hracGroup: 13,
    killsFamilies: [
      'corn',
      'broadleaf-companion',
      'orchard',
      'brassica',
      'leafy-green',
      'apiaceae',
      'small-fruit',
      'bramble',
      'stone-fruit',
      'forage',
      'herb-culinary'
    ],
    notes: 'Clomazone (Command 3ME) — HRAC 13 carotenoid biosynthesis inhibitor. Pumpkin / soybean / pepper / tomato tolerant; severe bleaching on broadleaves and corn.'
  }
} as const;

export function killedFamilies(cls: ChemistryClass): ReadonlySet<CropFamily> {
  return new Set(CHEMISTRY_KILL_MATRIX[cls].killsFamilies);
}

export function killsFamily(cls: ChemistryClass, family: CropFamily): boolean {
  return CHEMISTRY_KILL_MATRIX[cls].killsFamilies.includes(family);
}

export function hracGroupOf(cls: ChemistryClass): number {
  return CHEMISTRY_KILL_MATRIX[cls].hracGroup;
}
