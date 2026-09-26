import { deleteSetting, getSetting, setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { elevationFtAt } from './elevation.server';
import { farmZoneFrom, lookupZone, parseZone, type FarmZone } from './zone';

/** The owner's typed zone, when they set one. The estimate is never stored:
 *  it is recomputed from the farm location each time. */
export function loadManualZone(): string | null {
  if (getSetting(SETTINGS_KEYS.hardinessZoneProvenance) !== 'manual') return null;
  return parseZone(getSetting(SETTINGS_KEYS.hardinessZone) ?? null);
}

export async function farmZone(): Promise<FarmZone | null> {
  const manual = loadManualZone();
  if (manual) return farmZoneFrom(manual, null);
  if (!hasFarmLatLon()) return null;
  const { lat, lon } = getFarmLatLon();
  const elevationFt = await elevationFtAt(lat, lon);
  return farmZoneFrom(null, await lookupZone(lat, lon, { elevationFt }));
}

export type ZoneFormResult = { ok: true } | { ok: false; error: string };

/** A blank field clears the owner's zone and goes back to the estimate. */
export function saveZoneForm(raw: FormDataEntryValue | null): ZoneFormResult {
  if (raw === null) return { ok: true };
  const text = String(raw).trim();
  if (text === '') {
    deleteSetting(SETTINGS_KEYS.hardinessZone);
    deleteSetting(SETTINGS_KEYS.hardinessZoneProvenance);
    return { ok: true };
  }
  const zone = parseZone(text);
  if (!zone) return { ok: false, error: 'Enter a zone like 7a or 6b, or leave it blank.' };
  setSetting(SETTINGS_KEYS.hardinessZone, zone);
  setSetting(SETTINGS_KEYS.hardinessZoneProvenance, 'manual');
  return { ok: true };
}
