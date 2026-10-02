import type { PageServerLoad } from './$types';
import { farmTimeZone, prefsFor } from '$lib/db/userProfile';
import { todayYmd } from '$lib/prefs';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { listCuttings } from '$lib/db/hayCuttings';
import { getBaseRegistry, getRegistry } from '$lib/server/registry';
import { currentUser } from '$lib/server/auth';
import { canVoidHolds, voidableUntilMs } from '$lib/server/holdVoid';
import { grazingContextFrom } from '$lib/server/areaGrazing';
import { hayOffFarmNotices } from '$lib/farm/hayOffFarm';
import { forageAccess } from '$lib/forage/access';
import { loadTaskContext } from '$lib/server/recordTaskClose';

export const load: PageServerLoad = async (event) => {
  const { url, locals } = event;
  const registry = await getRegistry();
  const blocks = listBlocks();
  const taskContext = loadTaskContext(url.searchParams.get('task'));
  const cropId = url.searchParams.get('crop');
  const crop = cropId ? getCrop(cropId) : undefined;
  const hayCrops = registry
    .crops()
    .filter((c) => c.hayOperations !== undefined)
    .map((c) => ({
      pluginId: c.pluginId,
      displayName: c.displayName,
      cropFamily: c.cropFamily,
      hayOperations: c.hayOperations
    }));

  const blockOptions = blocks.map((b) => {
    const hayPlanting = b.plantings.find((p) =>
      hayCrops.some((h) => h.pluginId === p.cropPluginId)
    );
    return {
      id: b.id,
      name: b.name,
      acres: b.acres ?? null,
      hasGeometry: !!b.geometryGeojson,
      hayPlanting: hayPlanting
        ? {
            cropPluginId: hayPlanting.cropPluginId,
            varietyDisplayName: hayPlanting.varietyDisplayName
          }
        : null
    };
  });

  const selectedBlockId =
    crop?.blockId ??
    url.searchParams.get('block') ??
    taskContext?.blockId ??
    blockOptions.find((b) => b.hayPlanting)?.id ??
    blockOptions[0]?.id ??
    '';
  const year =
    Number(url.searchParams.get('year')) || Number(todayYmd(prefsFor(locals.user?.id)).slice(0, 4));

  const cuttings = selectedBlockId ? listCuttings({ blockId: selectedBlockId, year }) : [];
  const offFarm = cuttings.length
    ? hayOffFarmNotices(
        cuttings.map((c) => ({ id: c.id, blockId: c.blockId, cutAtMs: c.mowAt ?? c.createdAt })),
        grazingContextFrom(registry, await getBaseRegistry(), Date.now(), {
          fromAtMs: Number.NEGATIVE_INFINITY
        }).applications.filter((a) => a.blockId === selectedBlockId),
        farmTimeZone(),
        locals.locale
      )
    : {};

  return {
    blocks: blockOptions,
    hayCrops,
    selectedBlockId,
    selectedCropId: crop?.id ?? null,
    taskContext,
    year,
    cuttings: cuttings.map((c) => ({
      ...c,
      voidableUntilMs: voidableUntilMs(c.createdAt),
      offFarm: offFarm[c.id] ?? []
    })),
    canVoidHolds: canVoidHolds(event, currentUser(event)),
    canStockBales: currentUser(event)?.role === 'owner',
    forage: forageAccess(currentUser(event)?.role)
  };
};
