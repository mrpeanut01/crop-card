/**
 * The Flock Card (32D): any herd, flock or litter (one animal group), from
 * the offline snapshot. Members fold under it on /cards (D2-14), and the
 * same-kind, same-day care of its members rolls into one line (D2-11).
 */

import { animalLabel, countText } from '$lib/animals/display';
import { groupFacts } from '$lib/animals/facts';
import { displayFoods } from '$lib/animals/holdCopy';
import { ymdInZone } from '$lib/prefs';
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
import type { FarmSnapshot, SnapshotAnimalGroup, SnapshotCarePlan } from '../snapshot';
import {
  animalSubject,
  groupSubject,
  holdNotices,
  holdStatus,
  openHolds,
  readHolds,
  HOLD_CONFIRM_MAX_AGE_MS
} from './animalHolds';
import {
  askYourVet,
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
import { dueLabel, resolveOptions, type BuildOptions, type ResolvedOptions } from './common';

const MAX_MEMBER_LINES = 12;

export function groupPageHref(id: string): string {
  return `/animals/groups/${encodeURIComponent(id)}`;
}

/** Members' plans that share a title and due day become one line, e.g.
 *  "Deworm: 14 goats, due Oct 3". */
export function memberCareLines(
  plans: readonly { plan: SnapshotCarePlan; memberName: string }[],
  species: { label: string; displayName: string } | undefined,
  opts: ResolvedOptions
): string[] {
  const buckets = new Map<string, { plan: SnapshotCarePlan; names: string[] }>();
  for (const { plan, memberName } of plans) {
    const day = plan.nextDueAt === null ? 'none' : ymdInZone(plan.nextDueAt, opts.prefs.timeZone);
    const key = `${plan.title.toLowerCase()}\u0000${day}`;
    const b = buckets.get(key);
    if (b) b.names.push(memberName);
    else buckets.set(key, { plan, names: [memberName] });
  }
  return [...buckets.values()]
    .sort(
      (a, b) =>
        (a.plan.nextDueAt ?? Infinity) - (b.plan.nextDueAt ?? Infinity) ||
        a.plan.title.localeCompare(b.plan.title)
    )
    .map(({ plan, names }) => {
      const who = names.length === 1 ? names[0] : countText(names.length, species);
      const when =
        plan.nextDueAt === null
          ? askYourVet(opts.prefs.locale)
          : dueLabel(plan.nextDueAt, opts.now, opts.prefs);
      return `${plan.title}: ${who}, ${when}`;
    });
}

function flockCard(
  snapshot: FarmSnapshot,
  group: SnapshotAnimalGroup,
  options: BuildOptions
): CardModel {
  const opts = resolveOptions(snapshot, options);
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const species = speciesOf(snapshot, group.speciesId);
  const pet = isPetLayout(snapshot, group.purpose);
  const pageHref = groupPageHref(group.id);
  const members = (snapshot.animals ?? [])
    .filter((a) => a.groupId === group.id)
    .sort((a, b) => animalLabel(a).localeCompare(animalLabel(b)) || a.id.localeCompare(b.id));

  const foods = displayFoods(species, null, group.foodProducing);
  const subject = groupSubject(group.id);
  const reading = readHolds(
    snapshot,
    subject,
    foods,
    { now: opts.now, unsynced: options.unsyncedAnimalSubjects },
    [subject, ...members.map((m) => animalSubject(m.id))]
  );
  const notices = holdNotices(snapshot, reading, opts.prefs, foods);
  const heldMembers = members.filter(
    (m) =>
      openHolds(
        snapshot.animalHolds,
        animalSubject(m.id),
        displayFoods(species, m.sex, m.foodProducing),
        opts.now
      ).length > 0
  );
  if (heldMembers.length) {
    const names = heldMembers.slice(0, 3).map(animalLabel).join(', ');
    const more = heldMembers.length > 3 ? ` and ${heldMembers.length - 3} more` : '';
    notices.push(`Also on hold on their own cards: ${names}${more}.`);
  }

  const speciesWords = species
    ? { label: species.label, displayName: species.displayName }
    : undefined;
  const facts: CardFact[] = groupFacts(
    {
      total: group.total,
      headCount: group.headCount,
      namedCount: group.namedCount,
      species: speciesWords,
      purpose: group.purpose,
      livesAt: livesAt(snapshot, group.housingFieldId)
    },
    pet ? 'pets' : 'farm'
  ).map((f) => ({
    ...f,
    ...(f.label === 'Named' && loc
      ? {
          value: tr('cards.animal.namedValue', {
            named: group.namedCount,
            unnamed: group.headCount
          })
        }
      : {}),
    provenance: 'data' as const
  }));
  if (!pet) {
    facts.push({
      label: tr('cards.animal.foodAnimals'),
      value: group.foodProducing ? tr('cards.yes') : tr('cards.no'),
      provenance: 'data'
    });
  }

  if (group.organicStatus) {
    facts.push({
      label: tr('cards.fact.organicStatus'),
      value: group.organicStatus,
      provenance: 'manual'
    });
  }

  const groupPlans = sortPlans(plansFor(snapshot, 'group', group.id));
  const memberPlans = members.flatMap((m) =>
    plansFor(snapshot, 'animal', m.id).map((plan) => ({ plan, memberName: animalLabel(m) }))
  );
  const sections: CardSection[] = [];
  const careItems = [
    ...groupPlans.map((p) => planLine(p, opts.now, opts.prefs)),
    ...memberCareLines(memberPlans, speciesWords, opts)
  ];
  const allPlans = [...groupPlans, ...memberPlans.map((m) => m.plan)];
  if (careItems.length) {
    sections.push({
      title: tr('cards.animal.careDue'),
      items: careItems,
      provenance: sectionProvenance(allPlans)
    });
  }
  if (members.length) {
    const names = members.slice(0, MAX_MEMBER_LINES).map(animalLabel);
    if (members.length > MAX_MEMBER_LINES)
      names.push(tr('cards.more', { count: members.length - MAX_MEMBER_LINES }));
    sections.push({
      title: tr('cards.animal.members', { count: members.length }),
      items: names,
      provenance: 'data'
    });
  }
  const treated = treatmentsSection(
    treatmentsFor(snapshot, 'group', group.id),
    opts.prefs,
    pet ? tr('cards.animal.medicine') : tr('cards.animal.recentTreatments')
  );
  if (treated) sections.push(treated);
  const vet = vetParts(snapshot, loc);
  if (vet.section) sections.push(vet.section);

  const links: CardAction[] = [];
  if (vet.link) links.push(vet.link);
  links.push({
    label:
      loc && loc !== 'en'
        ? tr('cards.animal.openGroupPage')
        : tr('cards.animal.openNounPage', { noun: species?.groupNoun ?? 'group' }),
    href: pageHref
  });
  const healthHref = `/animals/${encodeURIComponent(group.id)}/health`;
  links.push({ label: tr('cards.animal.healthRecords'), href: healthHref });
  if (species?.products.some((p) => p === 'eggs' || p === 'milk')) {
    links.push({
      label: tr('cards.animal.logEggsMilk'),
      href: `/animals/${encodeURIComponent(group.id)}/log`
    });
  }

  const provenance: CardProvenance[] = [
    { source: 'data', detail: tr('cards.animal.provRecords') }
  ];
  if (species) provenance.push({ source: 'plugin', detail: tr('cards.animal.provSpecies') });
  provenance.push(...planProvenance(allPlans, loc));
  if (treated || vet.section || group.organicStatus) provenance.push({ source: 'manual' });

  const noun = species?.groupNoun ?? 'group';
  const key = cardKey('flock', group.id);
  return {
    kind: 'flock',
    key,
    kicker: species ? `${species.displayName} ${noun}` : tr('cards.animal.group'),
    title: group.name,
    facts: localizeFacts(facts, loc),
    next: nextCare(allPlans, opts.now, opts.prefs, pageHref),
    sections,
    asOf: snapshot.generatedAt,
    rulesVersion: snapshot.rulesVersion,
    provenance: mergeProvenance(provenance),
    href: cardHref('flock', key),
    ...(notices.length ? { notices, staleAfterMs: HOLD_CONFIRM_MAX_AGE_MS } : {}),
    links,
    status: holdStatus(reading, foods)
  };
}

export function buildFlockCard(
  snapshot: FarmSnapshot,
  groupId: string,
  options: BuildOptions = {}
): CardModel | null {
  const group = snapshot.animalGroups?.find((g) => g.id === groupId);
  return group ? flockCard(snapshot, group, options) : null;
}

export function buildFlockCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  return (snapshot.animalGroups ?? [])
    .map((g) => flockCard(snapshot, g, options))
    .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

/** The keys "Pin for the barn" pins: the Flock Card and every member's. */
export function barnPinKeys(snapshot: FarmSnapshot, groupId: string): string[] {
  const members = (snapshot.animals ?? []).filter((a) => a.groupId === groupId);
  return [cardKey('flock', groupId), ...members.map((m) => cardKey('animal', m.id))];
}
