import { listAreas } from '$lib/db/areas';
import { listBlocks } from '$lib/db/blocks';
import { isCropBearing } from '$lib/farm/areaKinds';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { sprayerTiles } from '$lib/setup/sprayer';
import type { SetupArea, SetupBlock, SprayerTemplateTile } from '$lib/setup/types';

/** Crop-bearing Areas a new spot can go inside, with how many beds or
 *  blocks each already has so pickers can offer the empty ones directly. */
export function setupAreas(): SetupArea[] {
  const counts = new Map<string, number>();
  for (const b of listBlocks()) {
    if (b.fieldId) counts.set(b.fieldId, (counts.get(b.fieldId) ?? 0) + 1);
  }
  return listAreas()
    .filter((a) => isCropBearing(a.kind))
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, blockCount: counts.get(a.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every block, labelled with its Area, for "Where?" pickers. */
export function setupBlocks(blocks: ReturnType<typeof listBlocks>): SetupBlock[] {
  const areaNames = new Map(listAreas().map((a) => [a.id, a.name]));
  return blocks
    .map((b) => ({
      id: b.id,
      name: b.name,
      areaName: b.fieldId ? (areaNames.get(b.fieldId) ?? null) : null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setupSprayerTemplates(): SprayerTemplateTile[] {
  return sprayerTiles(SEED_EQUIPMENT_TEMPLATES);
}

export function canSetUp(role: string | undefined): boolean {
  return role === 'owner';
}
