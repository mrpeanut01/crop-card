import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { listInsecticideEvents, activeReEntryRestrictions } from '$lib/db/insecticideEvents';
import { scoutLogByBlock as scoutLogFromTable } from '$lib/db/scoutObservations';
import { getRegistry } from '$lib/server/registry';
import { getUserAiEnabled } from '$lib/server/aiTry';

/**
 * Phase 25d (#95) — IPM-gate scout data. Primary path reads from the
 * dedicated `scout_observations` table; falls back to embedded
 * `insecticide_events.scoutObservationJson` payloads for pre-#95 data.
 * The union keeps the v2 5-week sparkline accurate even before the
 * scout-record UI ships.
 */
function scoutLogByBlock(): Record<string, Array<{ pest: string; metric: string; value: number; occurredAt: number }>> {
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
        pollinatorRisk: p.pollinatorRisk ?? 'unknown',
        epaRegistrationNumber: p.epaRegistrationNumber ?? null,
        iracGroups: Array.from(
          new Set(
            (p.activeIngredients ?? []).map((ai) => ai.iracGroup).filter((g): g is string => !!g)
          )
        )
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
    preselectedBlockId: crop?.blockId ?? url.searchParams.get('block') ?? null,
    preselectedCropId: crop?.id ?? null,
    // Phase 21b follow-up — deep-link from the swim-lane pip popover.
    taskId: url.searchParams.get('task'),
    // Phase 25d (#89) v2-addendum — drives AI-on vs AI-off variant.
    aiEnabled: getUserAiEnabled(locals.user?.id),
    // Phase 25d (#89) — feeds the IPM threshold gate dial + sparkline.
    // Read from past insecticide events' scoutObservationJson until a
    // dedicated scout-events table lands (TODO future PR).
    scoutLogByBlock: scoutLogByBlock()
  };
};
