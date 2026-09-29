/** Shared pieces of the Animal and Flock Cards (32D). Pure, client-safe. */

import { HEALTH_KIND_LABEL } from '$lib/animals/healthCopy';
import {
  firstVetContact,
  formatEmergencyContact,
  telHref
} from '$lib/farm/emergencyContacts';
import { formatInstant, type Prefs } from '$lib/prefs';
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

export function speciesOf(snapshot: FarmSnapshot, id: string): SnapshotSpecies | null {
  return snapshot.species?.[id] ?? null;
}

export function livesAt(snapshot: FarmSnapshot, fieldId: string | null): string | null {
  if (!fieldId) return null;
  const area = snapshot.areas.find((a) => a.id === fieldId);
  return area ? areaDisplayName(area) : null;
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
  if (p.nextDueAt === null) return `${p.title}: ${ASK_YOUR_VET}`;
  return `${p.title}: ${dueLabel(p.nextDueAt, now, prefs)}`;
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

export function planProvenance(plans: readonly SnapshotCarePlan[]): CardProvenance[] {
  const out: CardProvenance[] = [];
  if (plans.some((p) => p.provenance === 'plugin')) {
    out.push({ source: 'plugin', detail: 'species care defaults' });
  }
  if (plans.some((p) => p.provenance === 'manual')) {
    out.push({ source: 'manual', detail: 'care dates you set' });
  }
  if (plans.some((p) => p.provenance === 'fallback')) {
    out.push({ source: 'fallback', detail: 'general care reminders' });
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
  return { label: first.title, href, due: dueLabel(first.nextDueAt, now, prefs) };
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

export function treatmentLine(t: SnapshotTreatment, prefs: Prefs): string {
  const kind = HEALTH_KIND_LABEL[t.kind as HealthEventKind] ?? 'Health record';
  const what = t.productName ? `${kind}: ${t.productName}` : kind;
  const on = formatInstant(t.administeredAt, prefs, 'date');
  if (t.courseEndAt !== null && t.courseEndAt > t.administeredAt) {
    return `${what}, ${on} to ${formatInstant(t.courseEndAt, prefs, 'date')}`;
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
    lines.push(`+${treatments.length - MAX_TREATMENT_LINES} more on the health page`);
  }
  return { title, items: lines, provenance: 'manual' };
}

/** The farm's vet as a section (printed) and one 48dp call link (screen). */
export function vetParts(snapshot: FarmSnapshot): {
  section: CardSection | null;
  link: CardAction | null;
} {
  const vet = firstVetContact(snapshot.emergencyContacts);
  if (!vet) return { section: null, link: null };
  return {
    section: {
      title: 'Vet',
      items: [formatEmergencyContact({ ...vet, role: vet.role || 'Vet' })],
      provenance: 'manual',
      nowrapAfter: ': '
    },
    link: { label: `Call ${vet.name}`, href: telHref(vet.phone) }
  };
}

export function isPetLayout(snapshot: FarmSnapshot, purpose: SnapshotAnimal['purpose']): boolean {
  return snapshot.animalsLayout === 'pets' || purpose === 'pet';
}
