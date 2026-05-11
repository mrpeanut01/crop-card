import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { listBlocks } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listStockItems } from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { buildFarmContextWithCache } from '$lib/server/aiContext';
import { proposeGroupPlans, type GroupPlanningInput } from '$lib/server/aiGroupPlanning';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import { frostDatesForYear } from '$lib/schedule/settings';
import { LOUDOUN_VA, soilTempEarliestDayMs } from '$lib/weather/normals';
import { footprintSqFt, plantsFitUsable } from '$lib/layout/sufficiency';
import type { CropPlugin } from '$lib/plugins/schemas';

const bodySchema = z.object({
  year: z.number().int().min(2000).max(2100).optional(),
  /** Optional: scope the AI to a single block. */
  blockId: z.string().min(1).optional(),
  /** Phase 15d — restrict the wizard's planning to this set of blocks. Used
   *  by the Schedule tab's field/block filter so the wizard only proposes
   *  plans for visible blocks. Empty/omitted = all blocks. */
  blockIds: z.array(z.string().min(1)).max(200).optional(),
  /** Phase 17 (Track 3.4) — when supplied, the AI conversation threads with
   *  prior turns from the same session (suggest/allocate). */
  planningSessionId: z.string().min(1).optional()
});

/**
 * POST /api/plan/groups
 *
 * AI-assisted batch group + singleton planner. Returns proposed plans the
 * operator approves in the wizard's review-cards UI. Falls back to a
 * deterministic engine when no API key or Claude validates twice.
 */
export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const guard = checkGuard(user.id, 'groups');
  if (!guard.ok) {
    recordCall({
      userId: user.id,
      endpoint: 'groups',
      model: 'n/a',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      success: false,
      errorClass: guard.reason
    });
    return json({ error: guard.message }, { status: guard.status });
  }

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

  // Drafts = crops the operator has attached to a block but not yet
  // committed to a group. Includes both null-date "planned" drafts AND
  // "active" rows that aren't already group members — the AI can re-frame
  // an active solo planting as a group anchor when the rest of the system
  // is also attached to that block.
  const allCrops = listCrops();
  const drafts = allCrops.filter((c) => {
    if (!blockIdSet.has(c.blockId)) return false;
    if (c.groupId) return false;
    if (c.status === 'harvested' || c.status === 'archived' || c.status === 'failed') return false;
    return true;
  });

  if (drafts.length === 0) {
    return json({
      proposed: [],
      unscheduled: [],
      meta: { model: 'n/a', usdEstimate: 0, fallback: 'no-drafts' },
      spend: guard.spend
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

  // Phase 15e — per-draft density signal (footprint, vine spread, fit/have/util)
  // so the Group AI can detect over-packed blocks before scheduling and surface
  // displacedDrafts[]. Falls back to nulls when the operator hasn't tracked
  // seed quantity in stock for the variety.
  const stockByDisplay = new Map<string, { onHand: number | null; pluginId: string | null }>();
  for (const s of listStockItems()) {
    if (s.category !== 'seed') continue;
    stockByDisplay.set(s.displayName, {
      onHand: s.onHand ?? null,
      pluginId: s.pluginId ?? null
    });
  }
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const densityByDraft: NonNullable<GroupPlanningInput['densityByDraft']> = {};
  for (const draft of drafts) {
    const plug = pluginIndex[draft.cropPluginId];
    if (!plug) continue;
    const block = blocksById.get(draft.blockId);
    if (!block) continue;
    const footprint = footprintSqFt(plug);
    const plantsFit = footprint > 0 ? plantsFitUsable(block, plug) : null;
    // Seed quantity comes from the stock-item with matching displayName,
    // following the same convention as crops.ts (varietyDisplayName).
    let plantsAvailable: number | null = null;
    const stock = stockByDisplay.get(draft.varietyDisplayName);
    if (stock && stock.onHand != null && plug.plantingGuide?.seedsPerAcre) {
      // Treat onHand as count-of-seeds for now (count-based stock items).
      plantsAvailable = Math.floor(stock.onHand);
    }
    const utilizationPct =
      plantsAvailable != null && plantsFit != null && plantsFit > 0
        ? plantsAvailable / plantsFit
        : null;
    const vineSpread = plug.plantingGuide?.vineSpreadFt;
    densityByDraft[draft.id] = {
      footprintSqFt: footprint,
      vineSpreadFt: vineSpread ? vineSpread.max : null,
      plantsAvailable,
      plantsFit,
      utilizationPct
    };
  }

  const planningInput: GroupPlanningInput = {
    drafts,
    blocks,
    pluginIndex,
    soilTempEarliestByCrop,
    lastSpringFrostMs,
    firstFallFrostMs,
    year,
    densityByDraft
  };

  const built = await buildFarmContextWithCache(year);

  try {
    const result = await proposeGroupPlans(planningInput, built.context, {
      planningSessionId: parsed.data.planningSessionId,
      contextCacheHit: built.cacheHit,
      contextVersion: built.contextVersion
    });
    recordCall({
      userId: user.id,
      endpoint: 'groups',
      model: result.meta.model,
      inputTokens: result.meta.inputTokens,
      cachedInputTokens: result.meta.cachedInputTokens,
      outputTokens: result.meta.outputTokens,
      usdEstimate: result.meta.usdEstimate,
      success: result.proposed.length > 0,
      errorClass: result.meta.fallback
    });
    return json({
      proposed: result.proposed,
      unscheduled: result.unscheduled,
      meta: {
        model: result.meta.model,
        usdEstimate: result.meta.usdEstimate,
        fallback: result.meta.fallback
      },
      spend: guard.spend
    });
  } catch (err) {
    recordCall({
      userId: user.id,
      endpoint: 'groups',
      model: 'unknown',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      success: false,
      errorClass: 'upstream-error'
    });
    return json(
      { error: err instanceof Error ? err.message : 'group planning failed' },
      { status: 502 }
    );
  }
};
