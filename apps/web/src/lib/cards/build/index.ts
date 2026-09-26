import { parseCardKey, type CardModel } from '../model';
import type { FarmSnapshot } from '../snapshot';
import { buildAreaCard, buildAreaCards } from './area';
import type { BuildOptions } from './common';
import { buildFarmMapCard } from './farmMap';
import { buildPlantingCard, buildPlantingCards } from './planting';

export type { BuildOptions } from './common';
export { buildAreaCard, buildAreaCards, buildFarmMapCard, buildPlantingCard, buildPlantingCards };
export type { EmergencyContact, FarmMapBuildOptions } from './farmMap';

/** Builds any card kind that has a builder yet; null for unknown keys. */
export function buildCard(
  snapshot: FarmSnapshot,
  key: string,
  options: BuildOptions = {}
): CardModel | null {
  const parsed = parseCardKey(key);
  if (!parsed) return null;
  switch (parsed.kind) {
    case 'planting':
      return buildPlantingCard(snapshot, parsed.id, options);
    case 'area':
      return buildAreaCard(snapshot, parsed.id, options);
    case 'farmMap':
      return parsed.id === snapshot.ownerId ? buildFarmMapCard(snapshot, options) : null;
    default:
      return null;
  }
}
