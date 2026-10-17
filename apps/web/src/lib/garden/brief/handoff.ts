/**
 * The brief's hand-off to the planning wizard and the garden designer
 * (Phase 37A, R-27). Pure and client-safe.
 */

import type { FarmAnimalChoice } from '$lib/onboarding/profile';
import type { ShortlistRow } from './schema';

/** Wizard seed entries made for a shortlisted herb with no seed lot. The
 *  commit treats them as "Quantity not set, will size to bed" (#471). */
export const BRIEF_SEED_PREFIX = 'brief:';

export interface BriefSeedEntry {
  stockItemId: string;
  displayName: string;
  shortName?: string;
  onHand: number;
  onOrder?: number;
  planned?: number;
  defaultUnit: string;
  cropPluginId: string | null;
  cropFamily: string | null;
}

export interface BriefCatalogCrop {
  pluginId: string;
  displayName: string;
  cropFamily: string;
}

export interface BriefWizardSeeds {
  /** Entries to add to the wizard's seed list, one per herb with no lot. */
  extra: BriefSeedEntry[];
  /** Seed entries to pick when the wizard opens. */
  preselect: string[];
  /** Crops whose "Seed or seedling?" starts on a bought seedling. */
  seedlingCrops: string[];
}

export function isBriefSeedId(stockItemId: string): boolean {
  return stockItemId.startsWith(BRIEF_SEED_PREFIX);
}

/** Shortlisted herbs as wizard seeds: a linked seed lot when the farm has
 *  one (the first in the list), else a placeholder counted in plants. */
export function briefWizardSeeds(
  shortlist: readonly Pick<ShortlistRow, 'cropPluginId'>[],
  seedStock: readonly BriefSeedEntry[],
  catalog: readonly BriefCatalogCrop[]
): BriefWizardSeeds {
  const byId = new Map(catalog.map((c) => [c.pluginId, c]));
  const extra: BriefSeedEntry[] = [];
  const preselect: string[] = [];
  const seedlingCrops: string[] = [];
  for (const row of shortlist) {
    const crop = byId.get(row.cropPluginId);
    if (!crop || seedlingCrops.includes(crop.pluginId)) continue;
    seedlingCrops.push(crop.pluginId);
    const lot = seedStock.find((s) => s.cropPluginId === crop.pluginId);
    if (lot) {
      preselect.push(lot.stockItemId);
      continue;
    }
    const entry: BriefSeedEntry = {
      stockItemId: `${BRIEF_SEED_PREFIX}${crop.pluginId}`,
      displayName: crop.displayName,
      onHand: 0,
      onOrder: 0,
      planned: 0,
      defaultUnit: 'count',
      cropPluginId: crop.pluginId,
      cropFamily: crop.cropFamily
    };
    extra.push(entry);
    preselect.push(entry.stockItemId);
  }
  return { extra, preselect, seedlingCrops };
}

/** The `crops` query value the garden designer reads for its picker. */
export function designerCropsParam(
  shortlist: readonly Pick<ShortlistRow, 'cropPluginId'>[]
): string {
  return [...new Set(shortlist.map((r) => r.cropPluginId))].join(',');
}

/** Ids from a designer `crops` query value, deduplicated, at most 12. */
export function parseDesignerCrops(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s));
  return [...new Set(ids)].slice(0, 12);
}

/** Species the toxic-plant line checks for the onboarding animal answer.
 *  R-27: only pets and chickens; the Animals tile gets its own lines on the
 *  animal pages once the animals exist. */
const SPECIES_BY_CHOICE: Partial<Record<FarmAnimalChoice, readonly string[]>> = {
  pets: ['dog', 'cat', 'rabbit'],
  chickens: ['chicken', 'duck']
};

export function briefPetSpecies(choices: readonly FarmAnimalChoice[]): string[] {
  return [...new Set(choices.flatMap((c) => SPECIES_BY_CHOICE[c] ?? []))];
}
