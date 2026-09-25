import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { resolveArchetype, type CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';
import { canMutate } from '$lib/server/session';
import {
  ANTHESIS_ZADOKS,
  buildZadoksTimeline,
  currentStageIndex,
  dateAtZadoks,
  DAY_MS,
  inferGrowthHabit,
  type GrowthHabit,
  type SmallGrainStage
} from '$lib/plan/smallGrain';

export interface SmallGrainCandidate {
  plantingId: string;
  blockId: string;
  blockName: string;
  cropPluginId: string;
  displayName: string;
  varietyDisplayName: string;
  plantingDate: number | null;
}

export interface SmallGrainFungicideNote {
  occurredAt: number;
  products: string[];
}

export interface SmallGrainPlanView {
  candidate: SmallGrainCandidate;
  acres: number | null;
  habit: GrowthHabit;
  daysToMaturity: { min: number; max: number } | null;
  stages: SmallGrainStage[];
  currentIndex: number;
  anthesisMs: number | null;
  fungicides: SmallGrainFungicideNote[];
}

function isWheat(c: SmallGrainCandidate): boolean {
  return /wheat/i.test(`${c.cropPluginId} ${c.displayName}`);
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const requested = url.searchParams.get('planting');
  const blocks = listBlocks();
  const registry = await getRegistry();
  const now = Date.now();

  const plugins = new Map<string, CropPlugin>();
  const candidates: SmallGrainCandidate[] = [];
  let requestedExists = false;
  for (const b of blocks) {
    for (const p of b.plantings) {
      if (p.id === requested) requestedExists = true;
      const rec = registry.get(p.cropPluginId);
      if (!rec || rec.plugin.type !== 'crop') continue;
      const crop = rec.plugin as CropPlugin;
      if (resolveArchetype(crop) !== 'small-grain.zadoks') continue;
      plugins.set(crop.pluginId, crop);
      candidates.push({
        plantingId: p.id,
        blockId: b.id,
        blockName: b.name,
        cropPluginId: p.cropPluginId,
        displayName: crop.displayName,
        varietyDisplayName: p.varietyDisplayName,
        plantingDate: p.plantingDate
      });
    }
  }
  candidates.sort(
    (a, b) =>
      Number(isWheat(b)) - Number(isWheat(a)) || (b.plantingDate ?? 0) - (a.plantingDate ?? 0)
  );

  let selected: SmallGrainCandidate | undefined;
  if (requested) {
    if (!requestedExists) error(404, 'Planting not found');
    selected = candidates.find((c) => c.plantingId === requested);
    if (!selected) error(404, 'Not a small-grain planting');
  } else {
    selected = candidates[0];
  }

  let plan: SmallGrainPlanView | null = null;
  if (selected) {
    const crop = plugins.get(selected.cropPluginId)!;
    const habit = inferGrowthHabit(crop);
    const stages =
      selected.plantingDate === null ? [] : buildZadoksTimeline(crop, selected.plantingDate, habit);
    const anthesisMs = dateAtZadoks(stages, ANTHESIS_ZADOKS);
    const fungicides =
      selected.plantingDate === null
        ? []
        : listFungicideEvents({ blockId: selected.blockId, fromMs: selected.plantingDate })
            .filter(
              (e) => anthesisMs === null || Math.abs(e.occurredAt - anthesisMs) <= 21 * DAY_MS
            )
            .map((e) => ({
              occurredAt: e.occurredAt,
              products: e.products.map((p) => p.displayName)
            }));
    plan = {
      candidate: selected,
      acres: blocks.find((b) => b.id === selected!.blockId)?.acres ?? null,
      habit,
      daysToMaturity: crop.daysToMaturity ?? null,
      stages,
      currentIndex: currentStageIndex(stages, now),
      anthesisMs,
      fungicides
    };
  }

  return {
    candidates,
    plan,
    nowMs: now,
    canRecord: locals.user ? canMutate(locals.user.role) : false
  };
};
