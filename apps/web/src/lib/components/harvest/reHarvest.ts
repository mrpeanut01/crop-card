import { resolveArchetype, type Archetype, type HarvestStyle } from '$lib/plugins/schemas';

const RE_HARVEST: ReadonlySet<Archetype> = new Set<Archetype>([
  'cut-and-come-again-leafy',
  'continuous-harvest-fruit',
  'tree-fruit-multi-pick'
]);

const LABEL: Partial<Record<Archetype, string>> = {
  'cut-and-come-again-leafy': 'cut-and-come-again',
  'continuous-harvest-fruit': 'continuous-harvest',
  'tree-fruit-multi-pick': 'tree-fruit multi-pick'
};

export interface ReHarvestInput {
  archetype?: Archetype;
  archetypeOverride?: Archetype | null;
  harvestStyle?: HarvestStyle;
  cropFamily?: string;
}

const BERRY_FAMILIES: ReadonlySet<string> = new Set(['small-fruit', 'bramble']);

/** #743: berries, currants and brambles carry the vine archetype from the
 *  Phase 27A backfill, but they are picked pass after pass, so they get
 *  the pick form, not the grape quality form. A planting's own override
 *  still wins. */
export function isBerryOnVineArchetype(p: ReHarvestInput): boolean {
  if (p.archetypeOverride) return false;
  const resolved = resolveArchetype({
    archetype: p.archetype,
    harvestStyle: p.harvestStyle,
    cropFamily: p.cropFamily
  });
  return (
    resolved === 'perennial-vine-quality' && !!p.cropFamily && BERRY_FAMILIES.has(p.cropFamily)
  );
}

/** The archetype whose harvest form a planting gets. */
export function harvestFormArchetype(p: ReHarvestInput): Archetype {
  if (isBerryOnVineArchetype(p)) return 'continuous-harvest-fruit';
  return resolveArchetype({
    archetype: p.archetypeOverride ?? p.archetype ?? undefined,
    harvestStyle: p.harvestStyle,
    cropFamily: p.cropFamily
  });
}

export function reHarvestArchetype(p: ReHarvestInput): Archetype | null {
  const resolved = harvestFormArchetype(p);
  return RE_HARVEST.has(resolved) ? resolved : null;
}

export function reHarvestLabel(archetype: Archetype): string {
  return LABEL[archetype] ?? archetype;
}
