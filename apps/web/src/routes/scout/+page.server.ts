import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { canSetUp, setupAreas } from '$lib/server/setupContext';
import { loadDegreeDays, SCOUT_FETCH_TIMEOUT_MS } from '$lib/server/degreeDays.server';
import { canMutate } from '$lib/server/session';
import { farmTimeZone } from '$lib/db/userProfile';
import { ymdInZone } from '$lib/prefs';
import { loadTaskContext } from '$lib/server/recordTaskClose';
import { scoutNoteText } from '$lib/records/metricLabel';
import { getRegistry } from '$lib/server/registry';
import { scoutTargetsForFamily } from '$lib/plan/inputsPlan';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { getActivePlanningYear } from '$lib/season/planningYear.server';
import type { CropPlugin } from '$lib/plugins/schemas';

export const load: PageServerLoad = async ({ url, locals }) => {
  const taskContext = loadTaskContext(url.searchParams.get('task'));
  const cropId = url.searchParams.get('crop');
  let preselectedBlockId = url.searchParams.get('block');
  if (cropId && !preselectedBlockId) {
    const c = getCrop(cropId);
    if (c) preselectedBlockId = c.blockId;
  }
  if (!preselectedBlockId && taskContext?.blockId) preselectedBlockId = taskContext.blockId;

  // Sprint 4 (#139 / CT-SC-003) — load last 30 days of scout
  // observations and group by block so the UI can render per-block
  // history without an extra round-trip on block-select.
  const fromMs = Date.now() - 30 * 86_400_000;
  const recent = listScoutObservations({ fromMs, limit: 200 });
  const observationsByBlock: Record<
    string,
    Array<{
      id: string;
      pest: string;
      metric: string;
      value: number;
      occurredAt: number;
      note: string | null;
    }>
  > = {};
  for (const o of recent) {
    const list = (observationsByBlock[o.blockId] ??= []);
    list.push({
      id: o.id,
      pest: o.pest,
      metric: o.metric,
      value: o.value,
      occurredAt: o.occurredAt,
      note: scoutNoteText(o.metric, o.notes)
    });
  }

  const registry = await getRegistry();
  const pestThresholds: Array<{
    pest: string;
    metric: string;
    threshold: number;
    product: string;
  }> = [];
  for (const r of registry.all()) {
    if (r.plugin.type !== 'insecticide') continue;
    for (const th of r.plugin.scoutingThresholds ?? []) {
      pestThresholds.push({
        pest: th.pest,
        metric: th.metric,
        threshold: th.threshold,
        product: r.plugin.displayName
      });
    }
  }
  const scoutTargets = (cropPluginIds: string[]): string[] => {
    const out = new Set<string>();
    for (const id of cropPluginIds) {
      const rec = registry.get(id);
      if (rec?.plugin.type !== 'crop') continue;
      for (const t of scoutTargetsForFamily((rec.plugin as CropPlugin).cropFamily)) out.add(t);
    }
    return [...out];
  };
  const todayYmd = ymdInZone(Date.now(), farmTimeZone());
  const thisYear = Number(todayYmd.slice(0, 4));
  const season = loadSeasonSetup(thisYear) ?? loadSeasonSetup(getActivePlanningYear());

  return {
    blocks: listBlocks().map((b) => {
      const cropPluginIds = b.plantings.map((p) => p.cropPluginId);
      return {
        id: b.id,
        name: b.name,
        cropPluginIds,
        scoutTargets: scoutTargets(cropPluginIds)
      };
    }),
    pestThresholds,
    noHerbicides: season?.weedStrategy === 'cultivate-first',
    preselectedBlockId,
    preselectedCropId: cropId,
    taskContext,
    windowStage: url.searchParams.get('windowStage') ?? null,
    observationsByBlock,
    setup: { canEdit: canSetUp(locals.user?.role), areas: setupAreas() },
    todayYmd,
    canRecordCatch: !!locals.user && canMutate(locals.user.role),
    // Phase 32E (E5): streamed so a cold weather fetch never holds the page.
    degreeDays: loadDegreeDays({
      deps: { timeoutMs: SCOUT_FETCH_TIMEOUT_MS },
      locale: locals?.locale
    }).catch((e) => {
      console.warn('[scout] degree days failed', e);
      return null;
    })
  };
};
