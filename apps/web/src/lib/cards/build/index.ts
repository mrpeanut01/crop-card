import { parseCardKey, type CardModel } from '../model';
import type { FarmSnapshot } from '../snapshot';
import { buildAreaCard, buildAreaCards } from './area';
import { buildCareGuideCard, buildCareGuideCards } from './careGuide';
import type { BuildOptions } from './common';
import { buildFarmMapCard } from './farmMap';
import { buildDayCard, buildDayCards } from './day';
import { buildEquipmentCard, buildEquipmentCards } from './equipment';
import { buildPlantingCard, buildPlantingCards } from './planting';
import { buildSprayCard, buildSprayCards } from './spray';
import { buildStockCard, buildStockCards } from './stock';
import { buildTaskCard, buildTaskCardFromSnapshot } from './task';

export type { BuildOptions } from './common';
export type { EmergencyContact, FarmMapBuildOptions } from './farmMap';
export {
  buildAreaCard,
  buildAreaCards,
  buildCareGuideCard,
  buildCareGuideCards,
  buildDayCard,
  buildDayCards,
  buildEquipmentCard,
  buildEquipmentCards,
  buildFarmMapCard,
  buildPlantingCard,
  buildPlantingCards,
  buildSprayCard,
  buildSprayCards,
  buildStockCard,
  buildStockCards,
  buildTaskCard,
  buildTaskCardFromSnapshot
};

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
    case 'spray':
      return buildSprayCard(snapshot, parsed.id, options);
    case 'equipment':
      return buildEquipmentCard(snapshot, parsed.id, options);
    case 'careGuide':
      return buildCareGuideCard(snapshot, parsed.id, options);
    case 'day':
      return buildDayCard(snapshot, parsed.id, options);
    case 'stock':
      return buildStockCard(snapshot, parsed.id, options);
    case 'task':
      return buildTaskCardFromSnapshot(snapshot, parsed.id, options);
    default:
      return null;
  }
}

/** Every card the snapshot can build, in deck order. */
export function buildDeck(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  return [
    ...buildDayCards(snapshot, options),
    buildFarmMapCard(snapshot, options),
    ...buildPlantingCards(snapshot, options),
    ...buildAreaCards(snapshot, options),
    ...buildEquipmentCards(snapshot, options),
    ...buildSprayCards(snapshot, options),
    ...buildCareGuideCards(snapshot, options),
    ...buildStockCards(snapshot, options)
  ];
}
