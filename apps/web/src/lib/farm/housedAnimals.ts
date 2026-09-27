/**
 * Who lives on an Area, for the live Area Card and the farm map's Area
 * sheet (Phase 32B, B-26). Pure and client-safe: the server builds
 * `AreaHousing` from the tenant-scoped animal repos, and this module turns
 * it into card facts and a section. Animals stay out of the offline
 * snapshot until 32D, so the offline Area Card does not show them.
 */

import type { AnimalPurpose } from '$lib/animals/model';
import type { CapacityState } from '$lib/animals/counts';
import {
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '$lib/cards/model';

export interface HousedGroupRow {
  id: string;
  name: string;
  /** Plural species word ("Chickens"). */
  speciesPlural: string;
  /** Unnamed plus active named members (`groupTotal`). */
  total: number;
  /** The kernel's value: the group's flag or any active member's. */
  foodProducing: boolean;
}

export interface HousedAnimalRow {
  id: string;
  name: string | null;
  tag: string | null;
  /** Singular species word ("Dog"). */
  speciesName: string;
  purpose: AnimalPurpose;
  foodProducing: boolean;
}

export interface AreaHousing {
  groups: HousedGroupRow[];
  /** Individuals here outside any group. */
  animals: HousedAnimalRow[];
  /** Every head here: each group's total plus the individuals. */
  total: number;
  /** Owner-typed coop or pen capacity; shown, never enforced. */
  capacity: CapacityState | null;
}

export type HousingByArea = Record<string, AreaHousing>;

export interface HousingViewOptions {
  /** The "Pets & animals" layout hides tags. Safety wording stays. */
  petsLayout?: boolean;
}

const FOOD_NOTE = 'food animal';

function groupLine(g: HousedGroupRow): string {
  const parts = [g.name, `${g.total} ${g.speciesPlural.toLowerCase()}`];
  if (g.foodProducing) parts.push(g.total === 1 ? FOOD_NOTE : `${FOOD_NOTE}s`);
  return parts.join(' · ');
}

/** A pet row or the pets layout never shows a tag. Without a name the
 *  species word stands in, so a row is never blank. */
export function animalLabel(a: HousedAnimalRow, opts: HousingViewOptions = {}): string {
  const showTag = !opts.petsLayout && a.purpose !== 'pet';
  if (a.name?.trim()) return a.name.trim();
  if (showTag && a.tag?.trim()) return `Tag ${a.tag.trim()}`;
  return a.speciesName;
}

function animalLine(a: HousedAnimalRow, opts: HousingViewOptions): string {
  const label = animalLabel(a, opts);
  const parts = label === a.speciesName ? [label] : [label, a.speciesName];
  if (a.foodProducing) parts.push(FOOD_NOTE);
  return parts.join(' · ');
}

/** One line per group, then per individual, in the order given. */
export function housedLines(h: AreaHousing, opts: HousingViewOptions = {}): string[] {
  return [...h.groups.map(groupLine), ...h.animals.map((a) => animalLine(a, opts))];
}

export function capacityLabel(c: CapacityState): string {
  return c.over ? `Over capacity (${c.count} of ${c.capacity})` : `${c.count} of ${c.capacity}`;
}

export function housingFacts(h: AreaHousing | null | undefined): CardFact[] {
  if (!h) return [];
  const facts: CardFact[] = [];
  if (h.total > 0) {
    facts.push({ label: 'Animals', value: String(h.total), provenance: 'data' });
  }
  if (h.capacity) {
    facts.push({ label: 'Capacity', value: capacityLabel(h.capacity), provenance: 'manual' });
  }
  return facts;
}

const MAX_LINES = 8;

export function housingSection(
  h: AreaHousing | null | undefined,
  opts: HousingViewOptions = {}
): CardSection | null {
  if (!h) return null;
  const lines = housedLines(h, opts);
  if (lines.length === 0) return null;
  const items =
    lines.length <= MAX_LINES
      ? lines
      : [...lines.slice(0, MAX_LINES), `+${lines.length - MAX_LINES} more`];
  return { title: 'Lives here', items, provenance: 'data' };
}

/** The Area Card with its housed animals added. A card for an Area with
 *  nobody housed and no capacity comes back unchanged. */
export function withHousing(
  card: CardModel,
  h: AreaHousing | null | undefined,
  opts: HousingViewOptions = {}
): CardModel {
  const facts = housingFacts(h);
  const section = housingSection(h, opts);
  if (facts.length === 0 && !section) return card;
  const added: CardProvenance[] = [];
  if (h && h.total > 0) added.push({ source: 'data' });
  if (h?.capacity) added.push({ source: 'manual', detail: 'capacity typed by you' });
  return {
    ...card,
    facts: [...card.facts, ...facts],
    sections: section ? [section, ...card.sections] : card.sections,
    provenance: mergeProvenance([...card.provenance, ...added])
  };
}
