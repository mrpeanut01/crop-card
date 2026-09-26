import { deleteSetting, getSetting, setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { loadFrostDataset } from './frostNormals';
import {
  lookupZoneInDataset,
  parseHardinessZone,
  resolveHardinessZone,
  type HardinessZoneView,
  type ZoneLookup
} from './zone';

/** Station estimate for the saved farm location; null without a location
 *  or a station within 50 miles. */
export async function lookupFarmZone(): Promise<ZoneLookup | null> {
  if (!hasFarmLatLon()) return null;
  const { lat, lon } = getFarmLatLon();
  return lookupZoneInDataset(await loadFrostDataset(), lat, lon);
}

export async function loadHardinessZone(): Promise<HardinessZoneView | null> {
  const stored = {
    zone: getSetting(SETTINGS_KEYS.hardinessZone) ?? null,
    provenance: getSetting(SETTINGS_KEYS.hardinessZoneProvenance) ?? null
  };
  return resolveHardinessZone(stored, await lookupFarmZone());
}

export type ZoneSaveResult = { ok: true; changed: boolean } | { ok: false; error: string };

/**
 * The owner's zone choice from a form. Blank means "use the station
 * estimate" and clears any override; a zone on the 1a-13b scale is saved as
 * `manual`. The station estimate itself is never written.
 */
export function saveHardinessZoneChoice(raw: FormDataEntryValue | null): ZoneSaveResult {
  if (raw === null) return { ok: true, changed: false };
  const input = String(raw).trim();
  const current =
    getSetting(SETTINGS_KEYS.hardinessZoneProvenance) === 'manual'
      ? parseHardinessZone(getSetting(SETTINGS_KEYS.hardinessZone))
      : null;
  if (!input) {
    if (current === null && !getSetting(SETTINGS_KEYS.hardinessZone)) {
      return { ok: true, changed: false };
    }
    deleteSetting(SETTINGS_KEYS.hardinessZone);
    deleteSetting(SETTINGS_KEYS.hardinessZoneProvenance);
    return { ok: true, changed: true };
  }
  const zone = parseHardinessZone(input);
  if (!zone) return { ok: false, error: `"${input}" isn't a hardiness zone. Pick one like 7a.` };
  if (zone === current) return { ok: true, changed: false };
  setSetting(SETTINGS_KEYS.hardinessZone, zone);
  setSetting(SETTINGS_KEYS.hardinessZoneProvenance, 'manual');
  return { ok: true, changed: true };
}
