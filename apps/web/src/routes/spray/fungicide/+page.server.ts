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
import { loadSprayPastureContext } from '$lib/server/pastureAnimals';
import { listSprayers } from '$lib/server/sprayers';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { canSetUp, setupAreas } from '$lib/server/setupContext';
import { organicBlocksForNotice } from '$lib/server/organicNotice';
import { loadTaskContext } from '$lib/server/recordTaskClose';
import { isInBloom } from '$lib/safety/pollinatorBloom';
import type { CropPlugin } from '$lib/plugins/schemas';

export const load: PageServerLoad = async ({ url, locals }) => {
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
        rainfastHours: p.rainfastHours ?? null,
        pollinatorRisk: p.pollinatorRisk ?? ('unknown' as const),
        pollinator: p.pollinator ?? null,
        ratePerAcre: p.ratePerAcre,
        gpaCalibration: p.gpaCalibration,
        deconRequired: p.deconRequired ?? false,
        complianceFlags: p.complianceFlags,
        epaRegistrationNumber: null as string | null
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const blocks = listBlocks();
  // Mirrors the /api/fungicide/record FRAC-rotation input so the tile
  // shows the same verdict the server will enforce.
  const priorFungicideByBlock: Record<
    string,
    { pluginId: string; displayName: string; fracCodes: string[]; occurredAt: number }
  > = {};
  for (const b of blocks) {
    const last = listFungicideEvents({ blockId: b.id, limit: 1 })[0];
    if (!last) continue;
    priorFungicideByBlock[b.id] = {
      pluginId: last.products[0]?.pluginId ?? 'unknown',
      displayName: last.products.map((p) => p.displayName).join(' + ') || 'unknown',
      fracCodes: last.products.flatMap((p) => p.fracCodes ?? []),
      occurredAt: last.occurredAt
    };
  }

  const now = Date.now();
  const bloomingCropPluginIds = (b: (typeof blocks)[number]): string[] => {
    const ids = new Set<string>();
    for (const p of b.plantings) {
      if (p.plantingDate == null) continue;
      const rec = registry.get(p.cropPluginId);
      const bloomWindow =
        rec && rec.plugin.type === 'crop' ? (rec.plugin as CropPlugin).bloomWindow : undefined;
      if (
        isInBloom({ cropPluginId: p.cropPluginId, plantedAt: p.plantingDate, bloomWindow }, now)
      ) {
        ids.add(p.cropPluginId);
      }
    }
    return [...ids];
  };

  const taskContext = loadTaskContext(url.searchParams.get('task'));
  return {
    fungicides: fungicidePlugins,
    pasture: await loadSprayPastureContext(blocks, registry),
    organicBlocks: organicBlocksForNotice(
      blocks.map((b) => b.id),
      Date.now(),
      locals?.locale
    ),
    priorFungicideByBlock,
    blocks: blocks.map((b) => ({
      id: b.id,
      name: b.name,
      acres: b.acres ?? null,
      cropPluginIds: b.plantings.map((p) => p.cropPluginId),
      bloomingCropPluginIds: bloomingCropPluginIds(b)
    })),
    sprayers: listSprayers(),
    recentEvents: listFungicideEvents({ limit: 20 }),
    activeREI: activeFungicideReEntryRestrictions(),
    preselect: {
      blockId: crop?.blockId ?? url.searchParams.get('block') ?? taskContext?.blockId ?? null,
      cropId: crop?.id ?? null,
      taskId: taskContext?.id ?? null,
      productPluginIds: url.searchParams.getAll('product')
    },
    // Phase 25d (#89) v2-addendum — drives AI-on vs AI-off variant.
    aiEnabled: getUserAiEnabled(locals.user?.id),
    setup: { canEdit: canSetUp(locals.user?.role), areas: setupAreas() },
    taskContext
  };
};
