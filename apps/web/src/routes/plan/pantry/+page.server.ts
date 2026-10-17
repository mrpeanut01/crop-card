import type { PageServerLoad } from './$types';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { cropDisplayName } from '$lib/i18n/cropName';
import { briefSaved, harvestScheduleResponse, loadKeptTotals } from '$lib/server/pantry.server';

/** Phase 37C pantry: this season's kept harvests by crop and method, the
 *  brief's goals and what the herbs will give. Owners and helpers schedule
 *  the next cut; inspectors read. */
export const load: PageServerLoad = async (event) => {
  const locale = event.locals?.locale;
  const user = currentUser(event);
  const role = user?.role ?? null;
  const schedule = await harvestScheduleResponse({ herbsOnly: true, locale });
  const registry = await getRegistry();
  const kept = loadKeptTotals(schedule.year).map((k) => ({
    ...k,
    cropName: cropDisplayName(
      k.cropPluginId,
      registry.get(k.cropPluginId)?.plugin.displayName ?? k.cropPluginId,
      locale
    )
  }));
  return {
    schedule,
    kept,
    hasBrief: briefSaved(),
    canWrite: role !== null && canMutate(role)
  };
};
