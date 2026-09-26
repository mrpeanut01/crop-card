import { listAreas } from '$lib/db/areas';
import type { listBlocks } from '$lib/db/blocks';
import { isCropBearing } from '$lib/farm/areaKinds';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { sprayerTiles } from '$lib/setup/sprayer';
import type { SetupArea, SetupBlock, SprayerTemplateTile } from '$lib/setup/types';

/** Crop-bearing Areas a new spot can go inside. */
export function setupAreas(): SetupArea[] {
  return listAreas()
    .filter((a) => isCropBearing(a.kind))
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind }))
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
