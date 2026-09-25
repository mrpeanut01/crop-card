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

export function reHarvestArchetype(p: ReHarvestInput): Archetype | null {
  const resolved = resolveArchetype({
    archetype: p.archetypeOverride ?? p.archetype ?? undefined,
    harvestStyle: p.harvestStyle,
    cropFamily: p.cropFamily
  });
  return RE_HARVEST.has(resolved) ? resolved : null;
}

export function reHarvestLabel(archetype: Archetype): string {
  return LABEL[archetype] ?? archetype;
}
