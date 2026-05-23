/**
 * /spray/fungicide loader (Phase 21 / B-18 / UC-37d).
 *
 * Mirrors `/insecticides/+page.server.ts` against the fungicide catalog
 * and lifts FRAC codes from `activeIngredients[].fracCode` so the UI
 * can warn the operator about consecutive same-FRAC sprays (resistance
 * management).
 *
 * Deep-link query params:
 *   ?block=<blockId>             — pre-select that block
 *   ?crop=<cropId>               — pre-select crop (resolves to its block)
 *   ?task=<taskId>               — close this task on successful record
 *   ?product=<pluginId>          — repeat to pre-select multiple products
 */

import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { activeFungicideReEntryRestrictions, listFungicideEvents } from '$lib/db/fungicideEvents';
import { getRegistry } from '$lib/server/registry';
import { listSprayers } from '$lib/server/sprayers';

export const load: PageServerLoad = async ({ url }) => {
  const cropId = url.searchParams.get('crop');
  const crop = cropId ? getCrop(cropId) : undefined;
  const registry = await getRegistry();

  const fungicidePlugins = registry
    .all()
    .filter((r) => r.plugin.type === 'fungicide')
    .map((r) => {
      const p = r.plugin;
      if (p.type !== 'fungicide') return null;
      return {
        pluginId: p.pluginId,
        displayName: p.displayName,
        applicationTiming: p.applicationTiming ?? null,
        targetDiseases: p.targetDiseases ?? [],
        fracCodes: Array.from(new Set(p.activeIngredients.map((ai) => ai.fracCode))),
        reEntryIntervalHours: p.reEntryIntervalHours,
        preHarvestIntervalDays: p.preHarvestIntervalDays,
        pollinatorRisk: p.pollinatorRisk ?? 'unknown',
        ratePerAcre: p.ratePerAcre,
        gpaCalibration: p.gpaCalibration,
        deconRequired: p.deconRequired ?? false,
        epaRegistrationNumber: null as string | null
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    fungicides: fungicidePlugins,
    blocks: listBlocks().map((b) => ({
      id: b.id,
      name: b.name,
      acres: b.acres ?? null,
      cropPluginIds: b.plantings.map((p) => p.cropPluginId)
    })),
    sprayers: listSprayers(),
    recentEvents: listFungicideEvents({ limit: 20 }),
    activeREI: activeFungicideReEntryRestrictions(),
    preselect: {
      blockId: crop?.blockId ?? url.searchParams.get('block') ?? null,
      cropId: crop?.id ?? null,
      taskId: url.searchParams.get('task') ?? null,
      productPluginIds: url.searchParams.getAll('product')
    }
  };
};
