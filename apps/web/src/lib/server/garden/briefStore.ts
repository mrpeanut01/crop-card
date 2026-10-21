/**
 * The garden brief as the active Owner's `garden_brief` setting (Phase 37A,
 * R-26). Every read and write goes through the tenant-scoped settings repo.
 */

import { db } from '$lib/db/client';
import { deleteSetting, getSetting, setSetting, type SettingReader } from '$lib/db/settings';
import { isHerbGardenCrop } from '$lib/garden/herbs';
import {
  GARDEN_BRIEF_KEY,
  GARDEN_BRIEF_UPDATED_AT_KEY,
  briefPluginIds,
  gardenBriefSchema,
  parseGardenBrief,
  snapshotBriefOf,
  type GardenBrief,
  type SnapshotGardenBrief
} from '$lib/garden/brief/schema';
import type { PluginRegistry } from '$lib/plugins';
import type { CropPlugin } from '$lib/plugins/schemas';

export function loadGardenBrief(read: SettingReader = getSetting): GardenBrief | null {
  return parseGardenBrief(read(GARDEN_BRIEF_KEY));
}

/** True once the owner saved a brief. Reads only the small timestamp key,
 *  so /today can batch it with its other settings. */
export function hasGardenBrief(read: SettingReader = getSetting): boolean {
  const v = Number(read(GARDEN_BRIEF_UPDATED_AT_KEY));
  return Number.isFinite(v) && v > 0;
}

export function saveGardenBrief(brief: GardenBrief): GardenBrief {
  const value = gardenBriefSchema.parse(brief);
  db.transaction(() => {
    setSetting(GARDEN_BRIEF_KEY, JSON.stringify(value));
    setSetting(GARDEN_BRIEF_UPDATED_AT_KEY, String(value.updatedAt));
  });
  return value;
}

export function deleteGardenBrief(): void {
  db.transaction(() => {
    deleteSetting(GARDEN_BRIEF_KEY);
    deleteSetting(GARDEN_BRIEF_UPDATED_AT_KEY);
  });
}

/** A herb the brief may name: in this farm's library and on the ruled
 *  herb list (R-3). */
export function briefHerbCheck(registry: PluginRegistry): (pluginId: string) => boolean {
  return (id) => isHerbGardenCrop(id) && registry.get(id)?.plugin.type === 'crop';
}

/** Close-out CO-5: each herb's sourced sun need, for the shortlist order. */
export function briefSunNeedOf(
  registry: PluginRegistry
): (pluginId: string) => CropPlugin['sunNeed'] | undefined {
  return (id) => {
    const p = registry.get(id)?.plugin;
    return p?.type === 'crop' ? (p as CropPlugin).sunNeed : undefined;
  };
}

/** Ids in a brief that are not herbs in this farm's library. */
export function unknownBriefIds(
  brief: Pick<GardenBrief, 'answers' | 'shortlist'>,
  known: (pluginId: string) => boolean
): string[] {
  return briefPluginIds(brief).filter((id) => !known(id));
}

/** The GDPR export's `gardenBrief` group: owners only. */
export function gardenBriefExportSection(viewer: { role: string }): GardenBrief | null | undefined {
  if (viewer.role !== 'owner') return undefined;
  return loadGardenBrief();
}

/** The offline snapshot's `brief` part, left out when there is none. */
export function gardenBriefSnapshotPart(read: SettingReader = getSetting): {
  brief?: SnapshotGardenBrief;
} {
  const brief = loadGardenBrief(read);
  return brief ? { brief: snapshotBriefOf(brief) } : {};
}
