import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listInsecticideEvents, activeReEntryRestrictions } from '$lib/db/insecticideEvents';
import { getRegistry } from '$lib/server/registry';

export const load: PageServerLoad = async ({ url }) => {
  const registry = await getRegistry();
  const insecticidePlugins = registry
    .all()
    .filter((r) => r.plugin.type === 'insecticide')
    .map((r) => {
      const p = r.plugin;
      if (p.type !== 'insecticide') return null;
      return {
        pluginId: p.pluginId,
        displayName: p.displayName,
        targetPests: p.targetPests ?? [],
        scoutingThresholds: p.scoutingThresholds ?? [],
        applicationProtocol: p.applicationProtocol ?? [],
        reEntryIntervalHours: p.reEntryIntervalHours,
        preHarvestIntervalDays: p.preHarvestIntervalDays,
        pollinatorRisk: p.pollinatorRisk ?? 'unknown',
        epaRegistrationNumber: p.epaRegistrationNumber ?? null
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return {
    insecticides: insecticidePlugins,
    blocks: listBlocks().map((b) => ({
      id: b.id,
      name: b.name,
      cropPluginIds: b.plantings.map((p) => p.cropPluginId)
    })),
    recentEvents: listInsecticideEvents({ limit: 20 }),
    activeREI: activeReEntryRestrictions(),
    preselectedBlockId: url.searchParams.get('block') ?? null
  };
};
