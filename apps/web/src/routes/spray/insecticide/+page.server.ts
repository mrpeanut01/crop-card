import type { PageServerLoad } from './$types';
import { geometryCentroid, listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { listInsecticideEvents, activeReEntryRestrictions } from '$lib/db/insecticideEvents';
import { scoutLogByBlock as scoutLogFromTable } from '$lib/db/scoutObservations';
import { getRegistry } from '$lib/server/registry';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { getFarmLatLon } from '$lib/schedule/settings';
import { isInBloom } from '$lib/safety/pollinatorBloom';
import type { CropPlugin } from '$lib/plugins/schemas';
import { pollinatorNeighbors } from '$lib/server/pollinatorNeighbors';
import { canSetUp, setupAreas } from '$lib/server/setupContext';

/**
 * Phase 25d (#95) — IPM-gate scout data. Primary path reads from the
 * dedicated `scout_observations` table; falls back to embedded
 * `insecticide_events.scoutObservationJson` payloads for pre-#95 data.
 * The union keeps the v2 5-week sparkline accurate even before the
 * scout-record UI ships.
 */
function scoutLogByBlock(): Record<
  string,
  Array<{ pest: string; metric: string; value: number; occurredAt: number }>
> {
  const out = scoutLogFromTable(35 * 86_400_000);
  // Backfill legacy embedded observations not yet migrated.
  const legacy = listInsecticideEvents({ limit: 50 });
  for (const e of legacy) {
    if (!e.scoutObservation) continue;
    const list = (out[e.blockId] ??= []);
    list.push({
      pest: e.scoutObservation.pest,
      metric: e.scoutObservation.metric,
      value: e.scoutObservation.value,
      occurredAt: e.occurredAt
    });
  }
  return out;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const cropId = url.searchParams.get('crop');
  const crop = cropId ? getCrop(cropId) : undefined;
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
        pollinatorRisk: p.pollinatorRisk ?? ('unknown' as const),
        pollinator: p.pollinator ?? null,
        epaRegistrationNumber: p.epaRegistrationNumber ?? null,
        iracGroups: Array.from(
          new Set(
            (p.activeIngredients ?? []).map((ai) => ai.iracGroup).filter((g): g is string => !!g)
          )
        )
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const farm = getFarmLatLon();
  const now = Date.now();

  const allBlocks = listBlocks();
  const cropPlugin = (id: string): CropPlugin | null => {
    const rec = registry.get(id);
    return rec && rec.plugin.type === 'crop' ? (rec.plugin as CropPlugin) : null;
  };

  return {
    insecticides: insecticidePlugins,
    blocks: allBlocks.map((b) => {
      const location = (b.geometryGeojson && geometryCentroid(b.geometryGeojson)) || farm;
      const blooming = b.plantings.filter((p) => {
        if (p.plantingDate == null) return false;
        const rec = registry.get(p.cropPluginId);
        const bloomWindow =
          rec && rec.plugin.type === 'crop' ? (rec.plugin as CropPlugin).bloomWindow : undefined;
        return isInBloom(
          { cropPluginId: p.cropPluginId, plantedAt: p.plantingDate, bloomWindow },
          now
        );
      });
      return {
        id: b.id,
        name: b.name,
        cropPluginIds: b.plantings.map((p) => p.cropPluginId),
        lat: location.lat,
        lon: location.lon,
        bloomingCropPluginIds: Array.from(new Set(blooming.map((p) => p.cropPluginId))),
        pollinatorNeighbors: pollinatorNeighbors(b.id, allBlocks, cropPlugin, now)
      };
    }),
    recentEvents: listInsecticideEvents({ limit: 20 }),
    activeREI: activeReEntryRestrictions(),
    preselectedBlockId: crop?.blockId ?? url.searchParams.get('block') ?? null,
    preselectedCropId: crop?.id ?? null,
    // Phase 21b follow-up — deep-link from the swim-lane pip popover.
    taskId: url.searchParams.get('task'),
    // Phase 25d (#89) v2-addendum — drives AI-on vs AI-off variant.
    aiEnabled: getUserAiEnabled(locals.user?.id),
    setup: { canEdit: canSetUp(locals.user?.role), areas: setupAreas() },
    // Phase 25d (#89) — feeds the IPM threshold gate dial + sparkline.
    // Read from past insecticide events' scoutObservationJson until a
    // dedicated scout-events table lands (TODO future PR).
    scoutLogByBlock: scoutLogByBlock()
  };
};
