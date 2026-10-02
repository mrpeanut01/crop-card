/**
 * Species plugin helpers (Phase 32B). Pure and client-safe: callers pass the
 * species registry (server: `(await getDataKinds()).species`) or a plain
 * list. Every lookup of an unknown species falls to the safe side, so an
 * animal whose species is missing counts as food-producing.
 */

import { t, type MessageKey } from '$lib/i18n';
import type { SpeciesPlugin } from './schemas';

/** The ruled starter set, in tile order. There is no "Other" species. */
export const STARTER_SPECIES_IDS = [
  'chicken',
  'duck',
  'goat',
  'sheep',
  'cattle',
  'pig',
  'horse',
  'rabbit',
  'dog',
  'cat'
] as const;
export type StarterSpeciesId = (typeof STARTER_SPECIES_IDS)[number];

export interface SpeciesSource {
  get(pluginId: string): SpeciesPlugin | undefined;
  all(): SpeciesPlugin[];
}

export interface SpeciesTile {
  id: string;
  displayName: string;
  /** Plural label for the tile ("Chickens"). */
  label: string;
  /** lucide icon name, kebab-case. */
  icon: string;
  groupNoun: SpeciesPlugin['groupNoun'];
  foodProducingDefault: boolean;
  notForSlaughterToggle: boolean;
  products: SpeciesPlugin['products'];
}

export function speciesTile(p: SpeciesPlugin): SpeciesTile {
  return {
    id: p.pluginId,
    displayName: p.displayName,
    label: p.tile.label ?? p.displayName,
    icon: p.tile.icon,
    groupNoun: p.groupNoun,
    foodProducingDefault: p.foodProducingDefault,
    notForSlaughterToggle: p.notForSlaughterToggle === true,
    products: p.products
  };
}

const STARTER_ORDER = new Map<string, number>(STARTER_SPECIES_IDS.map((id, i) => [id, i]));

/** Tiles in starter order, then any other registered species by name. */
export function speciesTiles(plugins: SpeciesPlugin[]): SpeciesTile[] {
  return [...plugins]
    .sort((a, b) => {
      const ai = STARTER_ORDER.get(a.pluginId) ?? Infinity;
      const bi = STARTER_ORDER.get(b.pluginId) ?? Infinity;
      return ai !== bi ? ai - bi : a.displayName.localeCompare(b.displayName);
    })
    .map(speciesTile);
}

/** Starting value for a new animal's or group's `food_producing` flag.
 *  An unknown species is food-producing. */
export function foodProducingDefaultFor(species: SpeciesSource, speciesId: string): boolean {
  return species.get(speciesId)?.foodProducingDefault ?? true;
}

/** Whether to offer the recorded "not for slaughter" toggle. The toggle
 *  never changes `food_producing`. */
export function offersNotForSlaughter(species: SpeciesSource, speciesId: string): boolean {
  return species.get(speciesId)?.notForSlaughterToggle === true;
}

export function groupNounFor(
  species: SpeciesSource,
  speciesId: string,
  locale?: string | null
): string {
  return species.get(speciesId)?.groupNoun ?? t(locale, 'pluginui.species.group');
}

export function speciesLabel(
  species: SpeciesSource,
  speciesId: string,
  locale?: string | null
): string {
  return species.get(speciesId)?.displayName ?? t(locale, 'pluginui.species.unknown');
}

/** One plain line under the food-producing chip on the add form. */
export function foodProducingExplanation(p: SpeciesPlugin | undefined): string {
  if (!p) {
    return 'This species is not in the library, so it counts as a food animal to be safe.';
  }
  const who = p.tile.label ?? p.displayName;
  if (!p.foodProducingDefault) {
    return `${who} are not food animals, so medicine withdrawal times do not apply.`;
  }
  if (p.products.includes('eggs')) {
    return `${who} count as food animals because people eat their eggs.`;
  }
  if (p.products.includes('milk')) {
    return `${who} count as food animals because people drink their milk or eat their meat.`;
  }
  if (p.products.includes('meat')) {
    return `${who} count as food animals because people eat their meat.`;
  }
  return `${who} count as food animals under US rules, even when kept as pets.`;
}

// Mirrors the `animals.sex` column enum in lib/db/schema.ts.
export const ANIMAL_SEXES = [
  'female',
  'male',
  'neutered-male',
  'spayed-female',
  'unknown'
] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

type SexWords = Partial<Record<Exclude<AnimalSex, 'unknown'>, string>>;

const GENERIC_SEX_WORDS: Required<SexWords> = {
  female: 'Female',
  male: 'Male',
  'neutered-male': 'Neutered male',
  'spayed-female': 'Spayed female'
};

// Display words only. A species lists just the choices that make sense for
// it; a stored value outside the list still gets a generic label.
const SEX_WORDS: Record<StarterSpeciesId, SexWords> = {
  chicken: { female: 'Hen', male: 'Rooster', 'neutered-male': 'Capon' },
  duck: { female: 'Duck (female)', male: 'Drake' },
  goat: { female: 'Doe', male: 'Buck', 'neutered-male': 'Wether' },
  sheep: { female: 'Ewe', male: 'Ram', 'neutered-male': 'Wether' },
  cattle: { female: 'Cow or heifer', male: 'Bull', 'neutered-male': 'Steer' },
  pig: { female: 'Sow or gilt', male: 'Boar', 'neutered-male': 'Barrow' },
  horse: { female: 'Mare', male: 'Stallion', 'neutered-male': 'Gelding' },
  rabbit: {
    female: 'Doe',
    male: 'Buck',
    'neutered-male': 'Neutered buck',
    'spayed-female': 'Spayed doe'
  },
  dog: GENERIC_SEX_WORDS,
  cat: GENERIC_SEX_WORDS
};

const UNKNOWN_SEX_LABEL = 'Not sure';

function wordsFor(speciesId: string): SexWords {
  return (SEX_WORDS as Record<string, SexWords>)[speciesId] ?? GENERIC_SEX_WORDS;
}

function sexWordKey(speciesId: string, sex: AnimalSex): MessageKey {
  if (sex === 'unknown') return 'pluginui.sex.unknown';
  const own = (SEX_WORDS as Record<string, SexWords>)[speciesId];
  if (own && own !== GENERIC_SEX_WORDS && own[sex] !== undefined) {
    return `pluginui.sex.${speciesId}.${sex}` as MessageKey;
  }
  return `pluginui.sex.generic.${sex}`;
}

/** Display word for an animal's sex. With a locale it is translated; the
 *  English words are the ones in the tables above. */
export function sexLabel(speciesId: string, sex: AnimalSex, locale?: string | null): string {
  if (locale) return t(locale, sexWordKey(speciesId, sex));
  if (sex === 'unknown') return UNKNOWN_SEX_LABEL;
  return wordsFor(speciesId)[sex] ?? GENERIC_SEX_WORDS[sex];
}

/** Choices for the sex picker, species words first, "Not sure" last. */
export function sexOptions(
  speciesId: string,
  locale?: string | null
): { value: AnimalSex; label: string }[] {
  const words = wordsFor(speciesId);
  const values = ANIMAL_SEXES.filter(
    (s): s is Exclude<AnimalSex, 'unknown'> => s !== 'unknown' && words[s] !== undefined
  );
  if (locale) {
    return [
      ...values.map((value) => ({ value, label: sexLabel(speciesId, value, locale) })),
      { value: 'unknown', label: sexLabel(speciesId, 'unknown', locale) }
    ];
  }
  return [
    ...values.map((value) => ({ value, label: words[value]! })),
    { value: 'unknown', label: UNKNOWN_SEX_LABEL }
  ];
}
