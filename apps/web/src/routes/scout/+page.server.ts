import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { canSetUp, setupAreas } from '$lib/server/setupContext';
import { loadDegreeDays, SCOUT_FETCH_TIMEOUT_MS } from '$lib/server/degreeDays.server';
import { canMutate } from '$lib/server/session';
import { farmTimeZone } from '$lib/db/userProfile';
import { ymdInZone } from '$lib/prefs';

export const load: PageServerLoad = ({ url, locals }) => {
  const cropId = url.searchParams.get('crop');
  let preselectedBlockId = url.searchParams.get('block');
  if (cropId && !preselectedBlockId) {
    const c = getCrop(cropId);
    if (c) preselectedBlockId = c.blockId;
  }

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
      note: o.metric === 'note' ? (o.notes ?? null) : null
    });
  }

  return {
    blocks: listBlocks().map((b) => ({
      id: b.id,
      name: b.name,
      cropPluginIds: b.plantings.map((p) => p.cropPluginId)
    })),
    preselectedBlockId,
    preselectedCropId: cropId,
    windowStage: url.searchParams.get('windowStage') ?? null,
    observationsByBlock,
    setup: { canEdit: canSetUp(locals.user?.role), areas: setupAreas() },
    todayYmd: ymdInZone(Date.now(), farmTimeZone()),
    canRecordCatch: !!locals.user && canMutate(locals.user.role),
    // Phase 32E (E5): streamed so a cold weather fetch never holds the page.
    degreeDays: loadDegreeDays({
      deps: { timeoutMs: SCOUT_FETCH_TIMEOUT_MS }
    }).catch((e) => {
      console.warn('[scout] degree days failed', e);
      return null;
    })
  };
};
