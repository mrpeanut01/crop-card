import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getRegistry } from '$lib/server/registry';
import { listSprayers } from '$lib/server/sprayers';

/**
 * Load real blocks from DB. Deep-link query params:
 *   ?block=<blockId>             — pre-select that block
 *   ?product=<pluginId>          — repeat to pre-select multiple herbicides
 *   ?fromScout=1                 — UI hint: showed up via the scout flow
 *   ?windowStage=V2-V3 | V4-V6 | BURNDOWN | PRE | POST — filter herbicide list
 */
export const load: PageServerLoad = async ({ url }) => {
  const registry = await getRegistry();

  const cropById = new Map(
    registry
      .all()
      .filter((r) => r.plugin.type === 'crop')
      .map((r) => [
        r.plugin.pluginId,
        {
          pluginId: r.plugin.pluginId,
          displayName: r.plugin.displayName,
          cropFamily: r.plugin.type === 'crop' ? r.plugin.cropFamily : undefined
        }
      ])
  );

  const dbBlocks = listBlocks();
  const blocks = dbBlocks
    .filter((b) => b.plantings.length > 0)
    .map((b) => ({
      id: b.id,
      label: b.name,
      description: b.acres ? `${b.acres} acres` : '',
      crops: b.plantings
        .map((p) => cropById.get(p.cropPluginId))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
    }));

  const allHerbicides = registry
    .all()
    .filter((r) => r.plugin.type === 'herbicide')
    .map((r) => {
      if (r.plugin.type !== 'herbicide') throw new Error('unreachable');
      const h = r.plugin;
      return {
        pluginId: h.pluginId,
        displayName: h.displayName,
        applicationTiming: h.applicationTiming,
        chemistryClasses: Array.from(new Set(h.activeIngredients.map((ai) => ai.chemistryClass))),
        ratePerAcre: h.ratePerAcre,
        gpaCalibration: h.gpaCalibration,
        requiresAMS: h.requiresAMS ?? false,
        deconRequired: h.deconRequired ?? false
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Pre-fill from query params.
  const requestedCropId = url.searchParams.get('crop');
  let requestedBlockId = url.searchParams.get('block');
  // ?crop=<id> wins when present — resolve through to its block.
  if (requestedCropId) {
    const { getCrop } = await import('$lib/db/crops');
    const c = getCrop(requestedCropId);
    if (c) requestedBlockId = c.blockId;
  }
  const requestedProducts = url.searchParams.getAll('product');
  const windowStage = url.searchParams.get('windowStage');
  const fromScout = url.searchParams.get('fromScout') === '1';

  // Filter herbicides by stage when the calendar deep-link tells us which window
  // we're in. V2-V3 corn = POST broadleaf; V4-V6 = POST + sulfonylurea/HPPD;
  // BURNDOWN = pre-plant non-selectives.
  let herbicides = allHerbicides;
  let filteredByStage: string | null = null;
  if (windowStage) {
    filteredByStage = windowStage;
    if (windowStage === 'V2-V3') {
      herbicides = allHerbicides.filter(
        (h) =>
          h.applicationTiming === 'POST' &&
          h.chemistryClasses.some((c) => c === 'synthetic-auxin' || c === 'sulfonylurea')
      );
    } else if (windowStage === 'V4-V6') {
      herbicides = allHerbicides.filter(
        (h) =>
          h.applicationTiming === 'POST' &&
          h.chemistryClasses.some(
            (c) => c === 'hppd-inhibitor' || c === 'sulfonylurea' || c === 'accase-inhibitor'
          )
      );
    } else if (windowStage === 'BURNDOWN') {
      herbicides = allHerbicides.filter((h) => h.applicationTiming === 'BURNDOWN');
    } else if (windowStage === 'PRE') {
      herbicides = allHerbicides.filter((h) => h.applicationTiming === 'PRE');
    }
    // Always include the unfiltered list so the user can override if needed.
    if (herbicides.length === 0) herbicides = allHerbicides;
  }

  return {
    blocks,
    herbicides,
    allHerbicides,
    sprayers: listSprayers(),
    preselect: {
      blockId: requestedBlockId,
      cropId: requestedCropId,
      productPluginIds: requestedProducts,
      windowStage: filteredByStage,
      fromScout
    }
  };
};
