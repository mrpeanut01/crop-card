/**
 * Phase 32A source coverage. Every label or agronomy number a Phase 32
 * plugin field carries must have a quoted source in one of the
 * apps/web/scripts/*-sources.json files, keyed pluginId → fact path. The
 * gate tests (`sourceCoverage.gate.test.ts`) run these checks over the
 * shipped library; an unsourced value fails CI.
 */

import { z } from 'zod';
import type {
  AnimalHealthPlugin,
  CropPlugin,
  FungicidePlugin,
  GrazingRestrictions,
  HerbicidePlugin,
  InsecticidePlugin,
  PestModelPlugin,
  SpeciesPlugin
} from './schemas';

export const sourceEntrySchema = z.object({
  url: z.url({ protocol: /^https$/ }),
  publisher: z.string().trim().min(3),
  date: z.string().trim().min(4),
  quote: z.string().trim().min(10),
  note: z.string().optional()
});
export type SourceEntry = z.infer<typeof sourceEntrySchema>;

/** pluginId → fact path → source. */
export type SourceMap = Record<string, Record<string, unknown>>;

export interface SourceGap {
  pluginId: string;
  path: string;
  problem: 'missing' | 'invalid';
}

export interface SourcedFacts {
  pluginId: string;
  paths: string[];
}

export function checkSources(items: SourcedFacts[], sources: SourceMap): SourceGap[] {
  const gaps: SourceGap[] = [];
  for (const { pluginId, paths } of items) {
    for (const path of paths) {
      const entry = sources[pluginId]?.[path];
      if (entry === undefined) gaps.push({ pluginId, path, problem: 'missing' });
      else if (!sourceEntrySchema.safeParse(entry).success) {
        gaps.push({ pluginId, path, problem: 'invalid' });
      }
    }
  }
  return gaps;
}

function present(prefix: string, obj: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => obj[k] !== undefined).map((k) => `${prefix}${k}`);
}

export function grazingFactPaths(g: GrazingRestrictions): string[] {
  const paths = present('', g, [
    'grazeDays',
    'hayDays',
    'lactatingDairyGrazeDays',
    'meatAnimalRemovalBeforeSlaughterDays'
  ]);
  if (g.notForPasture === true) paths.push('notForPasture');
  if (g.manureCarryover === true) paths.push('manureCarryover');
  for (const e of g.speciesExceptions ?? []) {
    const prefix = `speciesExceptions.${e.speciesId}${e.lactating ? '.lactating' : ''}.`;
    paths.push(...present(prefix, e, ['grazeDays', 'hayDays']));
  }
  return paths;
}

export function animalHealthFactPaths(p: AnimalHealthPlugin): string[] {
  const paths: string[] = [];
  for (const use of p.labelUses) {
    if (!use.withdrawal) continue;
    const prefix = `withdrawal.${use.speciesId}.${use.class}.`;
    paths.push(...present(prefix, use.withdrawal, ['meatDays', 'milkHours', 'eggsDays']));
    if (use.withdrawal.doNotUseFor) paths.push(`${prefix}doNotUseFor`);
  }
  if (p.organicUse) paths.push('organicUse');
  return paths;
}

/** Label uses with no withdrawal at all, on a species that is (or may be)
 *  food-producing. `isFoodSpecies` returns undefined for an unknown species,
 *  which counts as food-producing. */
export function missingWithdrawals(
  p: AnimalHealthPlugin,
  isFoodSpecies: (speciesId: string) => boolean | undefined
): string[] {
  return p.labelUses
    .filter((u) => u.withdrawal === undefined && isFoodSpecies(u.speciesId) !== false)
    .map((u) => `withdrawal.${u.speciesId}.${u.class}`);
}

export function pestModelFactPaths(p: PestModelPlugin): string[] {
  const paths = present('', p, ['baseTempF', 'upperCutoffF']);
  if (p.biofix.date !== undefined) paths.push('biofix.date');
  for (const s of p.stages) paths.push(...present(`stages.${s.key}.`, s, ['gddFrom', 'gddTo']));
  return paths;
}

export function speciesFactPaths(p: SpeciesPlugin): string[] {
  const paths = ['foodProducingDefault'];
  for (const c of p.careDefaults ?? []) {
    if (c.intervalDays !== undefined) paths.push(`careDefaults.${c.key}.intervalDays`);
  }
  const space = p.housingSpace;
  if (space?.indoorSqFtPerAnimal !== undefined) paths.push('housingSpace.indoorSqFtPerAnimal');
  if (space?.outdoorSqFtPerAnimal !== undefined) paths.push('housingSpace.outdoorSqFtPerAnimal');
  return paths;
}

/** Phase 32A crop fields that carry numbers or animal-safety facts. Paths
 *  match the flat keys crop-data-sources.json already uses. */
export const CROP_SOURCED_GUIDE_FIELDS = [
  'startIndoorsWeeks',
  'transplantOffsetDays',
  'hardenOffDays',
  'germinationTempF',
  'dtmFrom'
] as const;

export function cropFactPaths(c: CropPlugin): string[] {
  const guide = c.plantingGuide ?? {};
  const paths = present('', guide, [...CROP_SOURCED_GUIDE_FIELDS]);
  for (const entry of c.animalToxicity ?? []) {
    for (const id of entry.speciesIds) paths.push(`animalToxicity.${id}`);
  }
  return paths;
}

export type PesticidePlugin = HerbicidePlugin | InsecticidePlugin | FungicidePlugin;

const PASTURE_WORDS =
  /\b(pastures?|rangeland|grazing|grazed|hay|hayfields?|forages?|alfalfa|clovers?|timothy|orchard-?grass|fescue|sudangrass)\b/i;

/** True when a pesticide's label crops include pasture, hay or forage: it
 *  claims safety on the forage family or a forage crop, or its text names
 *  pasture, rangeland, grazing, hay, forage or a forage crop such as
 *  alfalfa or clover. A forage pest name ("alfalfa weevil") counts too, so
 *  the gate errs toward asking. */
export function isPastureLabelled(
  p: PesticidePlugin,
  cropFamilyOf: (cropPluginId: string) => string | undefined
): boolean {
  const claims = p.labelClaims as
    { safeForCropPluginIds?: string[]; safeForCropFamilies?: string[] } | undefined;
  if (claims?.safeForCropFamilies?.includes('forage')) return true;
  if (claims?.safeForCropPluginIds?.some((id) => cropFamilyOf(id) === 'forage')) return true;
  const { grazingRestrictions: _ignored, ...rest } = p;
  return PASTURE_WORDS.test(JSON.stringify(rest));
}

export interface PastureAllowlistEntry {
  pluginId: string;
  reason: string;
}

export interface PastureReport {
  /** Pasture-labelled, no grazingRestrictions, not allowlisted. */
  unallowlisted: string[];
  /** Allowlisted but no longer a gap. */
  stale: string[];
}

export function checkPastureCoverage(
  plugins: PesticidePlugin[],
  cropFamilyOf: (cropPluginId: string) => string | undefined,
  allowlist: PastureAllowlistEntry[]
): PastureReport {
  const allowed = new Set(allowlist.map((e) => e.pluginId));
  const gaps = new Set(
    plugins
      .filter((p) => p.grazingRestrictions === undefined && isPastureLabelled(p, cropFamilyOf))
      .map((p) => p.pluginId)
  );
  return {
    unallowlisted: [...gaps].filter((id) => !allowed.has(id)).sort(),
    stale: allowlist
      .map((e) => e.pluginId)
      .filter((id) => !gaps.has(id))
      .sort()
  };
}
