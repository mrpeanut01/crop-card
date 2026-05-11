/**
 * POST /api/plan/groups/auto-schedule
 *
 * Phase 15d — deterministic auto-schedule. Runs the engine-only path in
 * `aiGroupPlanning.ts` (no Claude call) and commits the result in one
 * transaction. Returns counts so the UI can confirm what changed.
 *
 * Used by the "Auto-schedule drafts" button on the Schedule action row to
 * give operators an instant deterministic placement without going through
 * the AI wizard's approve-cards UX.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { listBlocks } from '$lib/db/blocks';
import {
  createPlantingGroup,
  listCrops,
  setSchedule,
  type CreateGroupInput
} from '$lib/db/crops';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import {
  proposePlansEngineOnly,
  type GroupPlanningInput
} from '$lib/server/aiGroupPlanning';
import { frostDatesForYear } from '$lib/schedule/settings';
import { LOUDOUN_VA, soilTempEarliestDayMs } from '$lib/weather/normals';
import type { CropPlugin } from '$lib/plugins/schemas';

const bodySchema = z.object({
  year: z.number().int().min(2000).max(2100).optional(),
  blockId: z.string().min(1).optional(),
  /** Phase 15d — restrict the engine + commit to this set of blocks. Used
   *  by the Schedule tab's field/block filter so auto-ops only touch
   *  visible blocks. Empty/omitted = all blocks. */
  blockIds: z.array(z.string().min(1)).max(200).optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);

  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    raw = {};
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const year = parsed.data.year ?? new Date().getFullYear();
  const allBlocks = listBlocks();
  const idFilter = parsed.data.blockIds && parsed.data.blockIds.length > 0
    ? new Set(parsed.data.blockIds)
    : parsed.data.blockId
      ? new Set([parsed.data.blockId])
      : null;
  const blocks = idFilter ? allBlocks.filter((b) => idFilter.has(b.id)) : allBlocks;
  if (blocks.length === 0) {
    return json({ error: 'no blocks available' }, { status: 400 });
  }
  const blockIdSet = new Set(blocks.map((b) => b.id));

  const registry = await getRegistry();
  const pluginIndex: Record<string, CropPlugin> = {};
  for (const r of registry.all()) {
    if (r.plugin.type === 'crop') pluginIndex[r.plugin.pluginId] = r.plugin as CropPlugin;
  }
  const resolvePlugin = (id: string): CropPlugin | undefined => pluginIndex[id];

  // Auto-schedule only operates on UNSCHEDULED drafts (null plantingDate).
  // Already-scheduled crops keep their dates; the operator can drag/edit
  // them manually if they want to reshuffle.
  const drafts = listCrops().filter((c) => {
    if (!blockIdSet.has(c.blockId)) return false;
    if (c.plantingDate != null) return false;
    if (c.groupId) return false;
    if (c.status === 'harvested' || c.status === 'archived' || c.status === 'failed') return false;
    return true;
  });

  if (drafts.length === 0) {
    return json({
      committed: { groups: 0, singletons: 0 },
      unscheduled: [],
      meta: { model: 'engine-only', fallback: 'no-drafts' }
    });
  }

  const { lastSpringFrostMs, firstFallFrostMs } = frostDatesForYear(year);
  const soilTempEarliestByCrop: Record<string, number | null> = {};
  for (const r of registry.all()) {
    if (r.plugin.type !== 'crop') continue;
    const c = r.plugin as CropPlugin;
    const minF = c.plantingGuide?.soilTempMinF;
    if (minF == null) continue;
    soilTempEarliestByCrop[c.pluginId] = soilTempEarliestDayMs(minF, year, LOUDOUN_VA);
  }

  const planningInput: GroupPlanningInput = {
    drafts,
    blocks,
    pluginIndex,
    soilTempEarliestByCrop,
    lastSpringFrostMs,
    firstFallFrostMs,
    year
  };

  const result = proposePlansEngineOnly(planningInput);

  // Commit each proposal. Groups go through createPlantingGroup (transactional
  // anchor + companions + materialized tasks). Singletons just need their
  // plantingDate stamped on the existing crop row.
  const failures: string[] = [];
  let groupsCommitted = 0;
  let singletonsCommitted = 0;

  for (const plan of result.proposed) {
    try {
      if (plan.kind === 'group') {
        const groupInput: CreateGroupInput = {
          blockId: plan.blockId,
          anchorPlantingDateMs: plan.anchor.plantingDateMs,
          systemKind: plan.systemKind,
          anchor: {
            cropPluginId: plan.anchor.cropPluginId,
            varietyDisplayName: plan.anchor.varietyDisplayName,
            existingCropId: plan.anchor.cropId
          },
          companions: plan.companions.map((c) => ({
            cropPluginId: c.cropPluginId,
            varietyDisplayName: c.varietyDisplayName,
            offsetDays: c.offsetDays,
            existingCropId: c.cropId
          })),
          resolvePlugin
        };
        createPlantingGroup(groupInput);
        groupsCommitted++;
      } else {
        setSchedule(plan.anchor.cropId, { plantingDate: plan.anchor.plantingDateMs });
        singletonsCommitted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'commit failed';
      failures.push(`${plan.anchor.varietyDisplayName}: ${msg}`);
    }
  }

  return json({
    committed: { groups: groupsCommitted, singletons: singletonsCommitted },
    unscheduled: result.unscheduled,
    failures,
    meta: { model: 'engine-only', fallback: result.meta.fallback ?? 'engine-only' }
  });
};
