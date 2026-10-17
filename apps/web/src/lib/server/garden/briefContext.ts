import { listFields } from '$lib/db/fields';
import { getSetting } from '$lib/db/settings';
import { farmZone } from '$lib/climate/zoneSettings.server';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { frostDatesIsoForYear } from '$lib/schedule/settings';
import { getActivePlanningYear } from '$lib/season/planningYear.server';
import type { BriefFarmFacts } from './briefChat';

/** The farm facts Claude gets with a brief turn: zone, saved frost dates
 *  and Area kinds. Frost dates the owner never saved read as not known. */
export async function loadBriefFarmFacts(): Promise<BriefFarmFacts> {
  const saved = !!getSetting(SETTINGS_KEYS.lastFrost) && !!getSetting(SETTINGS_KEYS.firstFrost);
  const zone = await farmZone().catch(() => null);
  return {
    zone: zone?.zone ?? null,
    frost: saved ? frostDatesIsoForYear(getActivePlanningYear()) : null,
    areaKinds: [...new Set(listFields().map((f) => f.kind))].sort()
  };
}
