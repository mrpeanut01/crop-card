import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listCrops, listYearsWithCrops, type CropStatus } from '$lib/db/crops';
import { getRegistry } from '$lib/server/registry';

const STATUSES: CropStatus[] = ['planned', 'active', 'harvested', 'failed', 'archived'];

function clampStatus(raw: string | null): CropStatus | undefined {
  if (raw && (STATUSES as string[]).includes(raw)) return raw as CropStatus;
  return undefined;
}

export const load: PageServerLoad = async ({ url }) => {
  const status = clampStatus(url.searchParams.get('status')) ?? 'active';
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const yearParam = url.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : undefined;

  const blocks = listBlocks();
  const years = listYearsWithCrops();
  const registry = await getRegistry();

  // Per-status totals so the tab labels can show counts.
  const counts: Record<CropStatus, number> = {
    planned: 0,
    active: 0,
    harvested: 0,
    failed: 0,
    archived: 0
  };
  for (const s of STATUSES) {
    counts[s] = listCrops({ status: s, blockId, year, limit: 1000 }).length;
  }

  const crops = listCrops({ status, blockId, year, limit: 200 });
  // Decorate with display-friendly extras (block name + plugin display name).
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const decorated = crops.map((c) => {
    const block = blockMap.get(c.blockId);
    const pluginRecord = registry.get(c.cropPluginId);
    const cropPlugin = pluginRecord?.plugin.type === 'crop' ? pluginRecord.plugin : undefined;
    const daysSincePlanted =
      c.plantingDate !== null
        ? Math.floor((Date.now() - c.plantingDate) / (24 * 60 * 60 * 1000))
        : null;
    return {
      ...c,
      blockName: block?.name ?? c.blockId.slice(0, 8),
      blockAcres: block?.acres ?? null,
      daysToMaturity: cropPlugin?.daysToMaturity,
      daysSincePlanted
    };
  });

  return {
    status,
    blockId: blockId ?? '',
    year: year ?? '',
    blocks: blocks.map((b) => ({ id: b.id, name: b.name, acres: b.acres ?? null })),
    years,
    counts,
    crops: decorated
  };
};
