/** The fact list at the top of an animal or group page, shaped like a
 *  Card's facts so 32D can turn the page into a Card. Pure. */

import { sexLabel, type AnimalSex } from '$lib/plugins/species';
import { ageText, countText } from './display';
import { showsFarmFields, type AnimalsLayout } from './profile';
import type { AnimalPurpose } from './model';
import { t, type MessageKey } from '$lib/i18n';

export interface Fact {
  label: string;
  value: string;
}

const PURPOSE_KEY: Record<AnimalPurpose, MessageKey> = {
  production: 'animals.purpose.production',
  pet: 'animallib.purpose.pet',
  mixed: 'animallib.purpose.mixed'
};

export interface AnimalFactsInput {
  speciesId: string;
  speciesName: string;
  sex: AnimalSex;
  birthDate: number | null;
  birthDateEstimated: boolean;
  tag: string | null;
  name: string | null;
  breed: string | null;
  acquiredFrom: string | null;
  purpose: AnimalPurpose;
  livesAt: string | null;
  groupName: string | null;
  feedingNote?: string | null;
  microchipId?: string | null;
}

export function animalFacts(
  a: AnimalFactsInput,
  layout: AnimalsLayout,
  now = Date.now(),
  locale?: string | null
): Fact[] {
  const tr = (key: MessageKey) => t(locale, key);
  const farm = showsFarmFields(layout, a.purpose);
  const facts: Fact[] = [{ label: tr('animallib.fact.kind'), value: a.speciesName }];
  if (a.sex !== 'unknown') {
    facts.push({ label: tr('animals.sex'), value: sexLabel(a.speciesId, a.sex, locale) });
  }
  const age = ageText(a.birthDate, a.birthDateEstimated, now, locale);
  if (age) facts.push({ label: tr('animals.add.age'), value: age });
  if (a.groupName) facts.push({ label: tr('animallib.fact.group'), value: a.groupName });
  facts.push({ label: tr('animallib.fact.livesAt'), value: a.livesAt ?? tr('animals.add.notSet') });
  if (farm) {
    if (a.tag && a.name) facts.push({ label: tr('animals.tag'), value: a.tag });
    if (a.breed) facts.push({ label: tr('animals.breed'), value: a.breed });
    if (a.acquiredFrom) facts.push({ label: tr('animals.cameFrom'), value: a.acquiredFrom });
    facts.push({ label: tr('animals.keptFor'), value: tr(PURPOSE_KEY[a.purpose]) });
  }
  if (a.feedingNote) facts.push({ label: tr('animallib.fact.food'), value: a.feedingNote });
  if (a.microchipId) facts.push({ label: tr('animallib.fact.microchip'), value: a.microchipId });
  return facts;
}

export interface GroupFactsInput {
  total: number;
  headCount: number;
  namedCount: number;
  species: { label: string; displayName: string } | undefined;
  purpose: AnimalPurpose;
  livesAt: string | null;
}

export function groupFacts(
  g: GroupFactsInput,
  layout: AnimalsLayout,
  locale?: string | null
): Fact[] {
  const tr = (key: MessageKey) => t(locale, key);
  const facts: Fact[] = [
    { label: tr('animallib.fact.howMany'), value: countText(g.total, g.species, locale) }
  ];
  if (g.namedCount > 0) {
    facts.push({
      label: tr('animallib.fact.named'),
      value: t(locale, 'animallib.fact.namedValue', {
        named: g.namedCount,
        unnamed: g.headCount
      })
    });
  }
  facts.push({ label: tr('animallib.fact.livesAt'), value: g.livesAt ?? tr('animals.add.notSet') });
  if (layout === 'farm' && g.purpose !== 'pet') {
    facts.push({ label: tr('animals.keptFor'), value: tr(PURPOSE_KEY[g.purpose]) });
  }
  return facts;
}
