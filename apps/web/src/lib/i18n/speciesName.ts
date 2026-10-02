/** Display-only species words. A species plugin's names are English data;
 *  for the shipped species, and only while a farm copy still carries the
 *  shipped English word, the viewer's language replaces them. */

import { t, type MessageKey } from '$lib/i18n';

const SHIPPED: Record<string, { name: string; plural: string; noun: string }> = {
  cat: { name: 'Cat', plural: 'Cats', noun: 'group' },
  cattle: { name: 'Cattle', plural: 'Cattle', noun: 'herd' },
  chicken: { name: 'Chicken', plural: 'Chickens', noun: 'flock' },
  dog: { name: 'Dog', plural: 'Dogs', noun: 'group' },
  duck: { name: 'Duck', plural: 'Ducks', noun: 'flock' },
  goat: { name: 'Goat', plural: 'Goats', noun: 'herd' },
  horse: { name: 'Horse', plural: 'Horses', noun: 'herd' },
  pig: { name: 'Pig', plural: 'Pigs', noun: 'herd' },
  rabbit: { name: 'Rabbit', plural: 'Rabbits', noun: 'colony' },
  sheep: { name: 'Sheep', plural: 'Sheep', noun: 'flock' }
};

type Part = 'name' | 'plural' | 'noun';

function word(id: string, part: Part, english: string, locale?: string | null): string {
  if (!locale || locale === 'en') return english;
  const shipped = SHIPPED[id];
  if (!shipped || shipped[part] !== english) return english;
  return t(locale, `animallib.species.${id}.${part}` as MessageKey);
}

export interface SpeciesWords {
  pluginId: string;
  displayName: string;
  label: string;
  groupNoun: string;
}

/** The species words in `locale`, same shape as the input. */
export function speciesWordsIn<S extends SpeciesWords>(s: S, locale?: string | null): S {
  if (!locale || locale === 'en') return s;
  return {
    ...s,
    displayName: word(s.pluginId, 'name', s.displayName, locale),
    label: word(s.pluginId, 'plural', s.label, locale),
    groupNoun: word(s.pluginId, 'noun', s.groupNoun, locale)
  };
}

/** "Chicken flock" in English; "Bandada de gallinas" in Spanish. */
export function speciesGroupTitle(s: SpeciesWords, locale?: string | null): string {
  if (!locale || locale === 'en') return `${s.displayName} ${s.groupNoun}`;
  const w = speciesWordsIn(s, locale);
  const noun = w.groupNoun.charAt(0).toUpperCase() + w.groupNoun.slice(1);
  return t(locale, 'animallib.species.groupOf', { Noun: noun, plural: w.label.toLowerCase() });
}
