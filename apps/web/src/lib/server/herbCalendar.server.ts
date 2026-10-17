/**
 * Phase 37D: the herb calendar inputs for a server loader. One settings
 * reader the loader already has (R-22: no new query on /today) gives the
 * brief goals and frost dates; the lifecycle verdict is 37B's, with the
 * interim R-17 subset until it lands.
 */

import type { SettingReader } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { parseZone } from '$lib/climate/zone';
import {
  herbCalendarInputs,
  interimLifecycleVerdict,
  type HerbCalendarInputs,
  type HerbVerdictResolver
} from '$lib/calendar/herbCalendarContext';
import { isHerbGardenCrop } from '$lib/garden/herbs';
import { lifecycleHere, type LifecycleFarmZone } from '$lib/garden/lifecycleHere';

/** TEST ONLY. A planting whose name carries this marker reads as a tender
 *  perennial on a server with dev routes on (the e2e preview server), so the
 *  bring-indoors path can be driven before any herb has sourced hardiness
 *  data (R-25). Production never sets ENABLE_DEV_ROUTES. */
export const E2E_TENDER_PERENNIAL_MARKER = 'e2e-tender-perennial';

export function herbVerdictTestHookEnabled(env: Record<string, string | undefined>): boolean {
  return env.ENABLE_DEV_ROUTES === '1';
}

export function serverHerbVerdict(
  env: Record<string, string | undefined> = process.env,
  manualZone: string | null = null
): HerbVerdictResolver {
  const hook = herbVerdictTestHookEnabled(env);
  const zone: LifecycleFarmZone | null = manualZone
    ? { zone: manualZone, provenance: 'manual' }
    : null;
  return (crop, planting) => {
    if (hook && planting.varietyDisplayName.includes(E2E_TENDER_PERENNIAL_MARKER)) {
      return { lifecycle: 'tender-perennial', provenance: 'fallback' };
    }
    if (!isHerbGardenCrop(crop.pluginId)) return interimLifecycleVerdict(crop);
    return lifecycleHere(crop, zone);
  };
}

/** The verdict reads only the owner's typed zone (R-4, R-22): the station
 *  estimate would add the elevation lookup to every /today load, so a farm
 *  with no typed zone reads its perennial herbs as unknown on the calendar. */
export function loadHerbCalendarInputs(read: SettingReader): HerbCalendarInputs {
  return herbCalendarInputs(read, serverHerbVerdict(process.env, manualZoneFromReader(read)));
}

/** The owner's typed zone from the same batch (`HERB_CALENDAR_SETTING_KEYS`
 *  holds both keys), for 37B's verdict (R-4). */
export function manualZoneFromReader(read: SettingReader): string | null {
  if (read(SETTINGS_KEYS.hardinessZoneProvenance) !== 'manual') return null;
  return parseZone(read(SETTINGS_KEYS.hardinessZone) ?? null);
}
