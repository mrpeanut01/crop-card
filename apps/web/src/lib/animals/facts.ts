/** The fact list at the top of an animal or group page, shaped like a
 *  Card's facts so 32D can turn the page into a Card. Pure. */

import { sexLabel, type AnimalSex } from '$lib/plugins/species';
import { ageText, countText } from './display';
import { showsFarmFields, type AnimalsLayout } from './profile';
import type { AnimalPurpose } from './model';

export interface Fact {
  label: string;
  value: string;
}

const PURPOSE_TEXT: Record<AnimalPurpose, string> = {
  production: 'Eggs, milk, meat or work',
  pet: 'Pet',
  mixed: 'Pet and production'
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

export function animalFacts(a: AnimalFactsInput, layout: AnimalsLayout, now = Date.now()): Fact[] {
  const farm = showsFarmFields(layout, a.purpose);
  const facts: Fact[] = [{ label: 'Kind', value: a.speciesName }];
  if (a.sex !== 'unknown') facts.push({ label: 'Sex', value: sexLabel(a.speciesId, a.sex) });
  const age = ageText(a.birthDate, a.birthDateEstimated, now);
  if (age) facts.push({ label: 'Age', value: age });
  if (a.groupName) facts.push({ label: 'Group', value: a.groupName });
  facts.push({ label: 'Lives at', value: a.livesAt ?? 'Not set' });
  if (farm) {
    if (a.tag && a.name) facts.push({ label: 'Tag', value: a.tag });
    if (a.breed) facts.push({ label: 'Breed', value: a.breed });
    if (a.acquiredFrom) facts.push({ label: 'Came from', value: a.acquiredFrom });
    facts.push({ label: 'Kept for', value: PURPOSE_TEXT[a.purpose] });
  }
  if (a.feedingNote) facts.push({ label: 'Food', value: a.feedingNote });
  if (a.microchipId) facts.push({ label: 'Microchip', value: a.microchipId });
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

export function groupFacts(g: GroupFactsInput, layout: AnimalsLayout): Fact[] {
  const facts: Fact[] = [{ label: 'How many', value: countText(g.total, g.species) }];
  if (g.namedCount > 0) {
    facts.push({ label: 'Named', value: `${g.namedCount} named, ${g.headCount} unnamed` });
  }
  facts.push({ label: 'Lives at', value: g.livesAt ?? 'Not set' });
  if (layout === 'farm' && g.purpose !== 'pet') {
    facts.push({ label: 'Kept for', value: PURPOSE_TEXT[g.purpose] });
  }
  return facts;
}
