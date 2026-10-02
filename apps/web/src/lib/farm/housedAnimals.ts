/**
 * Who lives on an Area, for the live Area Card and the farm map's Area
 * sheet (Phase 32B, B-26). Pure and client-safe: the server builds
 * `AreaHousing` from the tenant-scoped animal repos, and this module turns
 * it into card facts and a section. The offline Area Card builds the same
 * `AreaHousing` from the card snapshot (`lib/cards/build/areaAnimals.ts`).
 */

import type { AnimalPurpose } from '$lib/animals/model';
import { formatCount } from './coopCapacity';
import { t } from '$lib/i18n';
import { pluralFrom, withToxicPlants, type ToxicCrop } from '$lib/animals/toxicAdjacency';
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
  /** `data` when the owner kept the sourced suggestion, else typed. */
  capacityProvenance?: 'data' | 'manual';
  /** Species living here, most heads first; prefills the coop form. */
  speciesIds?: string[];
  /** Crops in the ground here that the plugin library says can harm some
   *  animal (Phase 32D, D5). Advisory only. */
  toxicPlants?: ToxicCrop[];
  /** Plural tile labels of the species living here, for the callout. */
  speciesPlural?: Record<string, string>;
}

export type HousingByArea = Record<string, AreaHousing>;

export interface HousingViewOptions {
  /** The "Pets & animals" layout hides tags. Safety wording stays. */
  petsLayout?: boolean;
  /** The viewer's language for the labels; English when absent. */
  locale?: string | null;
}

function groupLine(g: HousedGroupRow, locale?: string | null): string {
  const parts = [g.name, `${g.total} ${g.speciesPlural.toLowerCase()}`];
  if (g.foodProducing) parts.push(t(locale, 'area.housing.foodAnimal', { count: g.total }));
  return parts.join(' · ');
}

/** A pet row or the pets layout never shows a tag. Without a name the
 *  species word stands in, so a row is never blank. */
export function animalLabel(a: HousedAnimalRow, opts: HousingViewOptions = {}): string {
  const showTag = !opts.petsLayout && a.purpose !== 'pet';
  if (a.name?.trim()) return a.name.trim();
  if (showTag && a.tag?.trim()) return t(opts.locale, 'area.housing.tag', { tag: a.tag.trim() });
  return a.speciesName;
}

function animalLine(a: HousedAnimalRow, opts: HousingViewOptions): string {
  const label = animalLabel(a, opts);
  const parts = label === a.speciesName ? [label] : [label, a.speciesName];
  if (a.foodProducing) parts.push(t(opts.locale, 'area.housing.foodAnimal', { count: 1 }));
  return parts.join(' · ');
}

/** One line per group, then per individual, in the order given. */
export function housedLines(h: AreaHousing, opts: HousingViewOptions = {}): string[] {
  return [
    ...h.groups.map((g) => groupLine(g, opts.locale)),
    ...h.animals.map((a) => animalLine(a, opts))
  ];
}

export function capacityLabel(c: CapacityState, locale?: string | null): string {
  const of = t(locale, 'area.housing.countOf', {
    count: formatCount(c.count, locale),
    capacity: formatCount(c.capacity, locale)
  });
  return c.over ? t(locale, 'area.housing.over', { of }) : of;
}

export function housingFacts(
  h: AreaHousing | null | undefined,
  locale?: string | null
): CardFact[] {
  if (!h) return [];
  const facts: CardFact[] = [];
  if (h.total > 0) {
    facts.push({
      label: t(locale, 'area.housing.animals'),
      value: String(h.total),
      provenance: 'data'
    });
  }
  if (h.capacity) {
    facts.push({
      label: t(locale, 'area.housing.capacity'),
      value: capacityLabel(h.capacity, locale),
      provenance: h.capacityProvenance ?? 'manual'
    });
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
      : [
          ...lines.slice(0, MAX_LINES),
          t(opts.locale, 'area.housing.more', { count: lines.length - MAX_LINES })
        ];
  return { title: t(opts.locale, 'area.housing.livesHere'), items, provenance: 'data' };
}

/** The Area Card with its housed animals added. A card for an Area with
 *  nobody housed and no capacity comes back unchanged. */
export function withHousing(
  card: CardModel,
  h: AreaHousing | null | undefined,
  opts: HousingViewOptions = {}
): CardModel {
  const facts = housingFacts(h, opts.locale);
  const section = housingSection(h, opts);
  if (facts.length === 0 && !section) return card;
  const added: CardProvenance[] = [];
  if (h && h.total > 0) added.push({ source: 'data' });
  if (h?.capacity) {
    added.push(
      h.capacityProvenance === 'data'
        ? { source: 'data', detail: t(opts.locale, 'area.housing.capSuggested') }
        : { source: 'manual', detail: t(opts.locale, 'area.housing.capTyped') }
    );
  }
  const housed: CardModel = {
    ...card,
    facts: [...card.facts, ...facts],
    sections: section ? [section, ...card.sections] : card.sections,
    provenance: mergeProvenance([...card.provenance, ...added])
  };
  return withToxicPlants(
    housed,
    h?.toxicPlants,
    h?.speciesIds ?? [],
    pluralFrom(h?.speciesPlural ?? {}),
    opts.locale
  );
}
