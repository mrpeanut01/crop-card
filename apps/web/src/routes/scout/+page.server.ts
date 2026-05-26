import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { listScoutObservations } from '$lib/db/scoutObservations';

export const load: PageServerLoad = ({ url }) => {
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
    Array<{ id: string; pest: string; metric: string; value: number; occurredAt: number }>
  > = {};
  for (const o of recent) {
    const list = (observationsByBlock[o.blockId] ??= []);
    list.push({
      id: o.id,
      pest: o.pest,
      metric: o.metric,
      value: o.value,
      occurredAt: o.occurredAt
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
    observationsByBlock
  };
};
