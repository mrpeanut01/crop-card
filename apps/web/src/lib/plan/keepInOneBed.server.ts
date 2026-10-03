import { getSetting, setSetting } from '$lib/db/settings';
import { KEEP_IN_ONE_BED_SETTING, parseKeepInOneBed, withKeepInOneBed } from './keepInOneBed';

/** Crop plugin ids the active farm keeps in one bed. */
export function keepInOneBedCrops(): string[] {
  return parseKeepInOneBed(getSetting(KEEP_IN_ONE_BED_SETTING));
}

/** Turns one crop on or off and answers the stored list. */
export function setKeepInOneBed(cropPluginId: string, keep: boolean): string[] {
  const next = withKeepInOneBed(keepInOneBedCrops(), cropPluginId, keep);
  setSetting(KEEP_IN_ONE_BED_SETTING, JSON.stringify(next));
  return next;
}
