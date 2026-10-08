/**
 * Suggested capacity for a coop or pen (#477). Pure and client-safe. The
 * figure is floor area divided by a sourced space-per-animal number from
 * the species plugin (`housingSpace`, quoted in species-sources.json). It
 * is advisory: the owner can type any number, and nothing ever enforces it.
 */

import type { SpeciesPlugin } from '$lib/plugins/schemas';
import { geojsonAreaAcres } from '$lib/geo/area';
import type { FarmAnimalChoice } from '$lib/onboarding/profile';
import type { CoopSpaceKind } from './areaKinds';
import { SQFT_PER_ACRE } from './sketch';
import { numberToLocaleString } from '$lib/intlCache';
import { t } from '$lib/i18n';
import { intlLocale } from '$lib/prefs';
import { speciesWordsIn } from '$lib/i18n/speciesName';

export interface CoopSpeciesOption {
  id: string;
  /** Singular ("Chicken"). */
  name: string;
  /** Plural, lower case ("chickens"). */
  plural: string;
  indoorSqFt: number | null;
  outdoorSqFt: number | null;
  sourceName: string | null;
}

export type CapacitySuggestion =
  { ok: true; count: number; basis: string; sourceName: string } | { ok: false; reason: string };

export function coopSpeciesOption(p: SpeciesPlugin, locale?: string | null): CoopSpeciesOption {
  const space = p.housingSpace;
  const words = speciesWordsIn(
    {
      pluginId: p.pluginId,
      displayName: p.displayName,
      label: p.tile.label ?? p.displayName,
      groupNoun: p.groupNoun
    },
    locale
  );
  return {
    id: p.pluginId,
    name: words.displayName,
    plural: words.label.toLowerCase(),
    indoorSqFt: space?.indoorSqFtPerAnimal ?? null,
    outdoorSqFt: space?.outdoorSqFtPerAnimal ?? null,
    sourceName: space?.sourceName ?? null
  };
}

/** Floor area in square feet: the drawn outline first, then sketch width
 *  by length. Null when the Area has neither. */
export function areaSqFt(input: {
  geometryGeojson?: string | null;
  widthFt?: number | null;
  lengthFt?: number | null;
}): number | null {
  const acres = geojsonAreaAcres(input.geometryGeojson ?? null);
  if (acres !== null && acres > 0) return Math.round(acres * SQFT_PER_ACRE);
  const w = input.widthFt;
  const l = input.lengthFt;
  if (w != null && l != null && w > 0 && l > 0) return Math.round(w * l);
  return null;
}

/** A count or square footage for display: "67,565", "3.5". */
export function formatCount(n: number, locale?: string | null): string {
  return numberToLocaleString(n, locale ? intlLocale(locale) : 'en-US', {
    maximumFractionDigits: 1
  });
}

function fits(areaFt: number, perAnimal: number): number {
  return Math.floor(areaFt / perAnimal + 1e-9);
}

export function suggestCapacity(
  input: {
    option: CoopSpeciesOption | null | undefined;
    space: CoopSpaceKind | null | undefined;
    areaSqFt: number | null;
    shelterSqFt?: number | null;
    runSqFt?: number | null;
  },
  locale?: string | null
): CapacitySuggestion {
  const { option, space } = input;
  const trim = (n: number) => formatCount(n, locale);
  const where = (s: 'indoor' | 'outdoor') =>
    t(locale, s === 'indoor' ? 'area.coop.indoors' : 'area.coop.inRun');
  if (!option) return { ok: false, reason: t(locale, 'area.coop.pickType') };
  if (!space) {
    return { ok: false, reason: t(locale, 'area.coop.sayWhere') };
  }
  const missing = (w: 'indoor' | 'outdoor') => ({
    ok: false as const,
    reason: t(locale, 'area.coop.noFigure', { plural: option.plural, where: where(w) })
  });
  const tooSmall = {
    ok: false as const,
    reason: t(locale, 'area.coop.tooSmall', { name: option.name.toLowerCase() })
  };

  if (space === 'both') {
    if (option.indoorSqFt === null) return missing('indoor');
    if (option.outdoorSqFt === null) return missing('outdoor');
    const shelter = input.shelterSqFt ?? null;
    const run = input.runSqFt ?? null;
    if (!(shelter && shelter > 0) || !(run && run > 0)) {
      return { ok: false, reason: t(locale, 'area.coop.typeSizes') };
    }
    const count = Math.min(fits(shelter, option.indoorSqFt), fits(run, option.outdoorSqFt));
    if (count < 1) return tooSmall;
    return {
      ok: true,
      count,
      basis: t(locale, 'area.coop.basisBoth', {
        indoor: trim(option.indoorSqFt),
        outdoor: trim(option.outdoorSqFt)
      }),
      sourceName: option.sourceName ?? ''
    };
  }

  const perAnimal = space === 'indoor' ? option.indoorSqFt : option.outdoorSqFt;
  if (perAnimal === null) return missing(space);
  const area = input.areaSqFt;
  if (!(area && area > 0)) {
    return { ok: false, reason: t(locale, 'area.coop.giveSize') };
  }
  const count = fits(area, perAnimal);
  if (count < 1) return tooSmall;
  return {
    ok: true,
    count,
    basis: t(locale, 'area.coop.basisOne', {
      per: trim(perAnimal),
      where: where(space),
      area: trim(area)
    }),
    sourceName: option.sourceName ?? ''
  };
}

/** The species to start the question on: what already lives there, else
 *  backyard chickens when the owner picked that tile at onboarding. */
export function defaultCoopSpecies(input: {
  housedSpeciesIds?: readonly string[] | null;
  farmAnimals?: readonly FarmAnimalChoice[] | null;
  known?: ReadonlySet<string>;
}): string | null {
  const known = input.known;
  for (const id of input.housedSpeciesIds ?? []) {
    if (!known || known.has(id)) return id;
  }
  if (input.farmAnimals?.includes('chickens') && (!known || known.has('chicken'))) {
    return 'chicken';
  }
  return null;
}
