import { buildCareGuideCard, careGuidePluginIds } from '$lib/cards/build/careGuide';
import { blockDisplayName, type BuildOptions } from '$lib/cards/build/common';
import { parseCardKey, type CardModel } from '$lib/cards/model';
import type { FarmSnapshot } from '$lib/cards/snapshot';
import { isDesignable } from '$lib/farm/areaKinds';

export interface PhotoHelpTarget {
  cropId: string;
  label: string;
  careGuide: CardModel | null;
}

/** The plantings "Ask about a photo" can be about for one card: the
 *  planting itself, or what grows or is planned in a garden Area. */
export function photoHelpTargets(
  snapshot: FarmSnapshot,
  key: string,
  options: BuildOptions = {}
): PhotoHelpTarget[] {
  const parsed = parseCardKey(key);
  if (!parsed) return [];
  const blocks = new Map(snapshot.blocks.map((b) => [b.id, b]));
  let plantings = snapshot.plantings;
  if (parsed.kind === 'planting') {
    plantings = plantings.filter((p) => p.id === parsed.id);
  } else if (parsed.kind === 'area') {
    const area = snapshot.areas.find((a) => a.id === parsed.id);
    if (!area || !isDesignable(area.kind)) return [];
    plantings = plantings.filter(
      (p) => blocks.get(p.blockId)?.areaId === area.id && p.status !== 'harvested'
    );
  } else {
    return [];
  }
  return plantings.map((p) => {
    const block = blocks.get(p.blockId);
    const name = p.varietyDisplayName.trim() || snapshot.cropPlugins[p.cropPluginId]?.displayName;
    return {
      cropId: p.id,
      label: [name || 'Planting', block && blockDisplayName(block)].filter(Boolean).join(' · '),
      careGuide: buildCareGuideCard(snapshot, p.cropPluginId, options)
    };
  });
}

/** Care Guide cards for "How to care for it" on a Planting or garden Area
 *  card, built from the snapshot so they work offline. */
export function careGuideCardsFor(
  snapshot: FarmSnapshot,
  key: string,
  options: BuildOptions = {}
): CardModel[] {
  return careGuidePluginIds(snapshot, key)
    .map((id) => buildCareGuideCard(snapshot, id, options))
    .filter((c): c is CardModel => c !== null);
}
