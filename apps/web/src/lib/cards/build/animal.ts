/**
 * The Animal Card (32D): one animal, from the offline snapshot. A pet (the
 * pets layout, or an animal kept as a pet) gets the pet layout: next
 * vaccine, medicine, how much food, the vet and the microchip. Hold lines
 * show in every layout (B-17).
 */

import { animalLabel } from '$lib/animals/display';
import { animalFacts } from '$lib/animals/facts';
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
  const species = speciesOf(snapshot, animal.speciesId);
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
  const vet = vetParts(snapshot);

  const base = animalFacts(
    {
      speciesId: animal.speciesId,
      speciesName: species?.displayName ?? 'Unknown kind',
      sex: animal.sex as AnimalSex,
      birthDate: animal.birthDate,
      birthDateEstimated: animal.birthDateEstimated,
      tag: animal.tag,
      name: animal.name,
      breed: animal.breed,
      acquiredFrom: null,
      purpose: animal.purpose,
      livesAt: livesAt(snapshot, group?.housingFieldId ?? animal.housingFieldId),
      groupName: group?.name ?? null,
      feedingNote: animal.feedingNote,
      microchipId: animal.microchipId
    },
    layout,
    opts.now
  );
  const facts: CardFact[] = base.map((f) => ({ ...f, provenance: FACT_PROVENANCE[f.label] ?? 'data' }));
  if (!pet) {
    facts.push({
      label: 'Food animal',
      value: animal.foodProducing ? 'Yes' : 'No',
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
            ? 'Due date not set, ask your vet'
            : `${vaccine.title}, ${dueLabel(vaccine.nextDueAt, opts.now, opts.prefs)}`,
        provenance: vaccine.provenance
      });
    }
    const food = facts.findIndex((f) => f.label === 'Food');
    const at = vaccine ? 2 : 1;
    if (food > at) facts.splice(at, 0, ...facts.splice(food, 1));
  }

  const sections: CardSection[] = [];
  if (plans.length) {
    sections.push({
      title: 'Care due',
      items: plans.map((p) => planLine(p, opts.now, opts.prefs)),
      provenance: sectionProvenance(plans)
    });
  }
  if (group && plansFor(snapshot, 'group', group.id).length) {
    sections.push({
      title: 'Flock care',
      items: [`Care for the whole ${species?.groupNoun ?? 'group'} is on the ${group.name} card.`]
    });
  }
  const meds = treatmentsSection(treatments, opts.prefs, pet ? 'Medicine' : 'Recent treatments');
  if (meds) sections.push(meds);
  if (vet.section) sections.push(vet.section);

  const links: CardAction[] = [];
  if (vet.link) links.push(vet.link);
  links.push({ label: 'Open animal page', href: pageHref });
  links.push({ label: 'Health records', href: `${pageHref}/health` });
  if (!pet && species?.products.some((p) => p === 'eggs' || p === 'milk')) {
    links.push({ label: 'Log eggs or milk', href: `${pageHref}/log` });
  }

  const provenance: CardProvenance[] = [{ source: 'data', detail: 'your animal records' }];
  if (species) provenance.push({ source: 'plugin', detail: 'species library' });
  provenance.push(...planProvenance(plans));
  if (treatments.length || vet.section || animal.feedingNote || animal.microchipId) {
    provenance.push({ source: 'manual' });
  }

  const key = cardKey('animal', animal.id);
  const kicker = group
    ? `${species?.displayName ?? 'Animal'} · ${group.name}`
    : (species?.displayName ?? 'Animal');
  const notices = holdNotices(snapshot, reading, opts.prefs, foods);
  return {
    kind: 'animal',
    key,
    kicker,
    title: animalLabel(animal),
    facts,
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
