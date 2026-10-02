/**
 * The Animal Card (32D): one animal, from the offline snapshot. A pet (the
 * pets layout, or an animal kept as a pet) gets the pet layout: next
 * vaccine, medicine, how much food, the vet and the microchip. Hold lines
 * show in every layout (B-17).
 */

import { animalLabelIn } from '$lib/animals/display';
import { speciesWordsIn } from '$lib/i18n/speciesName';
import { carePlanTitleIn } from '$lib/animals/carePlans';
import { animalFacts, type AnimalFactsInput } from '$lib/animals/facts';
import { displayFoods } from '$lib/animals/holdCopy';
import type { AnimalSex } from '$lib/plugins/species';
import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardAction,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotAnimal } from '../snapshot';
import {
  animalSubject,
  groupSubject,
  holdNotices,
  holdStatus,
  readHolds,
  HOLD_CONFIRM_MAX_AGE_MS
} from './animalHolds';
import {
  isPetLayout,
  livesAt,
  localizeFacts,
  nextCare,
  planLine,
  planProvenance,
  plansFor,
  sectionProvenance,
  sortPlans,
  speciesOf,
  treatmentsFor,
  treatmentsSection,
  vetParts
} from './animalCommon';
import { dueLabel, resolveOptions, type BuildOptions } from './common';

const FACT_PROVENANCE: Record<string, CardFact['provenance']> = {
  Kind: 'plugin',
  Age: 'manual',
  Sex: 'manual',
  Breed: 'manual',
  Tag: 'manual',
  Food: 'manual',
  Microchip: 'manual'
};

export function animalPageHref(id: string): string {
  return `/animals/${encodeURIComponent(id)}`;
}

export function buildAnimalCard(
  snapshot: FarmSnapshot,
  animalId: string,
  options: BuildOptions = {}
): CardModel | null {
  const animal = snapshot.animals?.find((a) => a.id === animalId);
  if (!animal) return null;
  return animalCard(snapshot, animal, options);
}

function animalCard(
  snapshot: FarmSnapshot,
  animal: SnapshotAnimal,
  options: BuildOptions
): CardModel {
  const opts = resolveOptions(snapshot, options);
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const species = speciesOf(snapshot, animal.speciesId);
  const shownSpecies = species ? speciesWordsIn(species, loc) : null;
  const group = animal.groupId
    ? (snapshot.animalGroups?.find((g) => g.id === animal.groupId) ?? null)
    : null;
  const pet = isPetLayout(snapshot, animal.purpose);
  const layout = pet ? 'pets' : 'farm';
  const pageHref = animalPageHref(animal.id);

  const foods = displayFoods(species, animal.sex, animal.foodProducing);
  const subject = animalSubject(animal.id);
  const reading = readHolds(
    snapshot,
    subject,
    foods,
    { now: opts.now, unsynced: options.unsyncedAnimalSubjects },
    group ? [subject, groupSubject(group.id)] : [subject]
  );

  const plans = sortPlans(plansFor(snapshot, 'animal', animal.id));
  const treatments = treatmentsFor(snapshot, 'animal', animal.id);
  const vet = vetParts(snapshot, loc);

  const factsInput: AnimalFactsInput = {
      speciesId: animal.speciesId,
      speciesName: species?.displayName ?? tr('cards.animal.unknownKind'),
      sex: animal.sex as AnimalSex,
      birthDate: animal.birthDate,
      birthDateEstimated: animal.birthDateEstimated,
      tag: animal.tag,
      name: animal.name,
      breed: animal.breed,
      acquiredFrom: null,
      purpose: animal.purpose,
      livesAt: livesAt(snapshot, group?.housingFieldId ?? animal.housingFieldId, loc),
      groupName: group?.name ?? null,
      feedingNote: animal.feedingNote,
      microchipId: animal.microchipId
  };
  const base = animalFacts(factsInput, layout, opts.now);
  const localValues = loc
    ? animalFacts(
        { ...factsInput, speciesName: shownSpecies?.displayName ?? factsInput.speciesName },
        layout,
        opts.now,
        loc
      ).map((f) => f.value)
    : null;
  const facts: CardFact[] = base.map((f, i) => ({
    ...f,
    ...(localValues ? { value: localValues[i] } : {}),
    provenance: FACT_PROVENANCE[f.label] ?? 'data'
  }));
  if (animal.organicStatus) {
    facts.push({ label: 'Organic status', value: animal.organicStatus, provenance: 'manual' });
  }
  if (!pet) {
    facts.push({
      label: 'Food animal',
      value: animal.foodProducing ? tr('cards.yes') : tr('cards.no'),
      provenance: 'data'
    });
  }
  if (pet) {
    const vaccine = plans.find((p) => p.kind === 'vaccination');
    if (vaccine) {
      facts.splice(1, 0, {
        label: 'Next vaccine',
        value:
          vaccine.nextDueAt === null
            ? tr('cards.animal.askVetSentence')
            : `${carePlanTitleIn(vaccine, loc)}, ${dueLabel(vaccine.nextDueAt, opts.now, opts.prefs)}`,
        provenance: vaccine.provenance
      });
    }
    const food = facts.findIndex((f) => f.label === 'Food');
    const at = vaccine ? 2 : 1;
    if (food > at) facts.splice(at, 0, ...facts.splice(food, 1));
  }

  const shownFacts = localizeFacts(facts, loc);

  const sections: CardSection[] = [];
  if (plans.length) {
    sections.push({
      title: tr('cards.animal.careDue'),
      items: plans.map((p) => planLine(p, opts.now, opts.prefs)),
      provenance: sectionProvenance(plans)
    });
  }
  if (group && plansFor(snapshot, 'group', group.id).length) {
    sections.push({
      title: tr('cards.animal.flockCare'),
      items: [
        loc && loc !== 'en'
          ? tr('cards.animal.flockCareOnGroup', { name: group.name })
          : tr('cards.animal.flockCareOn', {
              noun: species?.groupNoun ?? 'group',
              name: group.name
            })
      ]
    });
  }
  const meds = treatmentsSection(
    treatments,
    opts.prefs,
    pet ? tr('cards.animal.medicine') : tr('cards.animal.recentTreatments')
  );
  if (meds) sections.push(meds);
  if (vet.section) sections.push(vet.section);

  const links: CardAction[] = [];
  if (vet.link) links.push(vet.link);
  links.push({ label: tr('cards.animal.openPage'), href: pageHref });
  links.push({ label: tr('cards.animal.healthRecords'), href: `${pageHref}/health` });
  if (!pet && species?.products.some((p) => p === 'eggs' || p === 'milk')) {
    links.push({ label: tr('cards.animal.logEggsMilk'), href: `${pageHref}/log` });
  }

  const provenance: CardProvenance[] = [
    { source: 'data', detail: tr('cards.animal.provRecords') }
  ];
  if (species) provenance.push({ source: 'plugin', detail: tr('cards.animal.provSpecies') });
  provenance.push(...planProvenance(plans, loc));
  if (
    treatments.length ||
    vet.section ||
    animal.feedingNote ||
    animal.microchipId ||
    animal.organicStatus
  ) {
    provenance.push({ source: 'manual' });
  }

  const key = cardKey('animal', animal.id);
  const kicker = group
    ? `${shownSpecies?.displayName ?? tr('cards.animal.animal')} · ${group.name}`
    : (shownSpecies?.displayName ?? tr('cards.animal.animal'));
  const notices = holdNotices(snapshot, reading, opts.prefs, foods);
  return {
    kind: 'animal',
    key,
    kicker,
    title: animalLabelIn(animal, loc),
    facts: shownFacts,
    next: nextCare(plans, opts.now, opts.prefs, pageHref),
    sections,
    asOf: snapshot.generatedAt,
    rulesVersion: snapshot.rulesVersion,
    provenance: mergeProvenance(provenance),
    href: cardHref('animal', key),
    ...(notices.length ? { notices, staleAfterMs: HOLD_CONFIRM_MAX_AGE_MS } : {}),
    links,
    status: holdStatus(reading, foods),
    ...(group ? { parentKey: cardKey('flock', group.id) } : {})
  };
}

/** Pets and named animals first by name; grouped animals after their
 *  flock's other members in name order. */
export function buildAnimalCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  return (snapshot.animals ?? [])
    .map((a) => animalCard(snapshot, a, options))
    .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
