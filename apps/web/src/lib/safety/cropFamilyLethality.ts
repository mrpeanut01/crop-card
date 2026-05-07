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
  'corn',
  'cucurbit',
  'legume',
  'broadleaf-companion',
  'orchard',
  'cover-grass',
  'cover-legume'
] as const;

export type CropFamily = (typeof CROP_FAMILIES)[number];

export interface ChemistryProfile {
  killsFamilies: ReadonlyArray<CropFamily>;
  notes: string;
}

export const CHEMISTRY_KILL_MATRIX: Readonly<Record<ChemistryClass, ChemistryProfile>> = {
  'synthetic-auxin': {
    killsFamilies: ['cucurbit', 'legume', 'broadleaf-companion', 'orchard'],
    notes: '2,4-D and similar. Highly drift-prone over broadleaves.'
  },
  chloroacetamide: {
    killsFamilies: ['cucurbit', 'legume', 'broadleaf-companion', 'orchard'],
    notes: 'Me-Too-Lachlor / metolachlor. Soil-active; persistent residue.'
  },
  'hppd-inhibitor': {
    killsFamilies: ['cucurbit', 'legume', 'broadleaf-companion', 'orchard'],
    notes: 'Mesotrione. Corn-tolerant only; lethal to broadleaves.'
  },
  'accase-inhibitor': {
    killsFamilies: ['corn', 'cover-grass'],
    notes: 'Clethodim. Selective grass killer — DO NOT spray over corn.'
  },
  glyphosate: {
    killsFamilies: [
      'corn',
      'cucurbit',
      'legume',
      'broadleaf-companion',
      'orchard',
      'cover-grass',
      'cover-legume'
    ],
    notes: 'Non-selective. Pre-plant burndown only; never over standing crop.'
  },
  sulfonylurea: {
    killsFamilies: ['legume', 'broadleaf-companion'],
    notes: 'Stadia-class. Corn-tolerant POST; check pumpkin label for stage window.'
  }
} as const;

export function killedFamilies(cls: ChemistryClass): ReadonlySet<CropFamily> {
  return new Set(CHEMISTRY_KILL_MATRIX[cls].killsFamilies);
}

export function killsFamily(cls: ChemistryClass, family: CropFamily): boolean {
  return CHEMISTRY_KILL_MATRIX[cls].killsFamilies.includes(family);
}
