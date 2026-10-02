/** Shared pieces of the Animal and Flock Cards (32D). Pure, client-safe. */

import { HEALTH_KIND_LABEL } from '$lib/animals/healthCopy';
import {
  firstVetContact,
  formatEmergencyContact,
  telHref
} from '$lib/farm/emergencyContacts';
import { formatInstant, type Prefs } from '$lib/prefs';
import { t, type MessageKey } from '$lib/i18n';
import { carePlanTitleIn } from '$lib/animals/carePlans';
import type { HealthEventKind } from '$lib/safety/animalWithdrawal';
import type { CardAction, CardProvenance, CardSection } from '../model';
import type {
  FarmSnapshot,
  SnapshotAnimal,
  SnapshotCarePlan,
  SnapshotSpecies,
  SnapshotTreatment
} from '../snapshot';
import { areaDisplayName, dueLabel } from './common';

export const ASK_YOUR_VET = 'due date not set, ask your vet';

export function askYourVet(locale?: string | null): string {
  return t(locale, 'cards.animal.askVet');
}

const HEALTH_KIND_KEY: Record<HealthEventKind, MessageKey> = {
  treatment: 'cards.health.treatment',
  vaccination: 'cards.health.vaccination',
  deworm: 'cards.health.deworm',
  'vet-visit': 'cards.health.vet-visit',
  injury: 'cards.health.injury',
  note: 'cards.health.note'
};

const FACT_LABEL_KEY: Record<string, MessageKey> = {
  Kind: 'cards.animal.fact.kind',
  Sex: 'cards.animal.fact.sex',
  Age: 'cards.animal.fact.age',
  Group: 'cards.animal.fact.group',
  'Lives at': 'cards.animal.fact.livesAt',
  Tag: 'cards.animal.fact.tag',
  Breed: 'cards.animal.fact.breed',
  'Came from': 'cards.animal.fact.cameFrom',
  'Kept for': 'cards.animal.fact.keptFor',
  Food: 'cards.animal.fact.food',
  Microchip: 'cards.animal.fact.microchip',
  'How many': 'cards.animal.fact.howMany',
  Named: 'cards.animal.fact.named',
  'Organic status': 'cards.fact.organicStatus',
  'Food animal': 'cards.animal.foodAnimal',
  'Next vaccine': 'cards.animal.nextVaccine'
};

const FACT_VALUE_KEY: Record<string, MessageKey> = {
  'Not set': 'cards.animal.notSet',
  'Eggs, milk, meat or work': 'cards.animal.purpose.production',
  Pet: 'cards.animal.purpose.pet',
  'Pet and production': 'cards.animal.purpose.mixed'
};

/** The English fact list from `animalFacts`/`groupFacts` in the app
 *  language: known labels and fixed values are swapped, the owner's own
 *  words and plugin names stay as they are. */
export function localizeFacts<F extends { label: string; value: string }>(
  facts: F[],
  locale: string | null | undefined
): F[] {
  if (!locale) return facts;
  return facts.map((f) => {
    const label = FACT_LABEL_KEY[f.label];
    const value = FACT_VALUE_KEY[f.value];
    return {
      ...f,
      label: label ? t(locale, label) : f.label,
      value: value && (f.label === 'Lives at' || f.label === 'Kept for') ? t(locale, value) : f.value
    };
  });
}
export function speciesOf(snapshot: FarmSnapshot, id: string): SnapshotSpecies | null {
  return snapshot.species?.[id] ?? null;
}

export function livesAt(
  snapshot: FarmSnapshot,
  fieldId: string | null,
  locale?: string | null
): string | null {
  if (!fieldId) return null;
  const area = snapshot.areas.find((a) => a.id === fieldId);
  return area ? areaDisplayName(area, locale) : null;
}

export function plansFor(
  snapshot: FarmSnapshot,
  subjectType: 'animal' | 'group',
  subjectId: string
): SnapshotCarePlan[] {
  return (snapshot.carePlans ?? []).filter(
    (p) => p.subjectType === subjectType && p.subjectId === subjectId
  );
}

export function planLine(p: SnapshotCarePlan, now: number, prefs: Prefs): string {
  const title = carePlanTitleIn(p, prefs.locale);
  if (p.nextDueAt === null) return `${title}: ${askYourVet(prefs.locale)}`;
  return `${title}: ${dueLabel(p.nextDueAt, now, prefs)}`;
}

/** Dated plans soonest first, then undated ones. */
export function sortPlans(plans: readonly SnapshotCarePlan[]): SnapshotCarePlan[] {
  return [...plans].sort(
    (a, b) =>
      (a.nextDueAt ?? Infinity) - (b.nextDueAt ?? Infinity) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
  );
}

export function planProvenance(
  plans: readonly SnapshotCarePlan[],
  locale?: string | null
): CardProvenance[] {
  const out: CardProvenance[] = [];
  if (plans.some((p) => p.provenance === 'plugin')) {
    out.push({ source: 'plugin', detail: t(locale, 'cards.animal.provSpeciesCare') });
  }
  if (plans.some((p) => p.provenance === 'manual')) {
    out.push({ source: 'manual', detail: t(locale, 'cards.animal.provCareDates') });
  }
  if (plans.some((p) => p.provenance === 'fallback')) {
    out.push({ source: 'fallback', detail: t(locale, 'cards.animal.provReminders') });
  }
  return out;
}

export function sectionProvenance(
  plans: readonly SnapshotCarePlan[]
): CardSection['provenance'] | undefined {
  const kinds = new Set(plans.map((p) => p.provenance));
  return kinds.size === 1 ? plans[0].provenance : undefined;
}

export function nextCare(
  plans: readonly SnapshotCarePlan[],
  now: number,
  prefs: Prefs,
  href: string
): CardAction | undefined {
  const first = sortPlans(plans).find((p) => p.nextDueAt !== null);
  if (!first || first.nextDueAt === null) return undefined;
  return {
    label: carePlanTitleIn(first, prefs.locale),
    href,
    due: dueLabel(first.nextDueAt, now, prefs)
  };
}

export function treatmentsFor(
  snapshot: FarmSnapshot,
  subjectType: 'animal' | 'group',
  subjectId: string
): SnapshotTreatment[] {
  return (snapshot.treatments ?? []).filter(
    (t) => t.subjectType === subjectType && t.subjectId === subjectId
  );
}

export function treatmentLine(tr: SnapshotTreatment, prefs: Prefs): string {
  const loc = prefs.locale;
  const kindKey = HEALTH_KIND_KEY[tr.kind as HealthEventKind];
  const kind = loc
    ? t(loc, kindKey ?? 'cards.health.record')
    : (HEALTH_KIND_LABEL[tr.kind as HealthEventKind] ?? 'Health record');
  const what = tr.productName ? `${kind}: ${tr.productName}` : kind;
  const on = formatInstant(tr.administeredAt, prefs, 'date');
  if (tr.courseEndAt !== null && tr.courseEndAt > tr.administeredAt) {
    return t(loc, 'cards.animal.treatmentCourse', {
      what,
      from: on,
      to: formatInstant(tr.courseEndAt, prefs, 'date')
    });
  }
  return `${what}, ${on}`;
}

const MAX_TREATMENT_LINES = 6;

export function treatmentsSection(
  treatments: readonly SnapshotTreatment[],
  prefs: Prefs,
  title: string
): CardSection | null {
  if (!treatments.length) return null;
  const lines = treatments.slice(0, MAX_TREATMENT_LINES).map((t) => treatmentLine(t, prefs));
  if (treatments.length > MAX_TREATMENT_LINES) {
    lines.push(
      t(prefs.locale, 'cards.animal.moreOnHealth', {
        count: treatments.length - MAX_TREATMENT_LINES
      })
    );
  }
  return { title, items: lines, provenance: 'manual' };
}

/** The farm's vet as a section (printed) and one 48dp call link (screen). */
export function vetParts(
  snapshot: FarmSnapshot,
  locale?: string | null
): {
  section: CardSection | null;
  link: CardAction | null;
} {
  const vet = firstVetContact(snapshot.emergencyContacts);
  if (!vet) return { section: null, link: null };
  const vetWord = t(locale, 'cards.animal.vet');
  return {
    section: {
      title: vetWord,
      items: [formatEmergencyContact({ ...vet, role: vet.role || vetWord })],
      provenance: 'manual',
      nowrapAfter: ': '
    },
    link: { label: t(locale, 'cards.animal.call', { name: vet.name }), href: telHref(vet.phone) }
  };
}

export function isPetLayout(snapshot: FarmSnapshot, purpose: SnapshotAnimal['purpose']): boolean {
  return snapshot.animalsLayout === 'pets' || purpose === 'pet';
}
