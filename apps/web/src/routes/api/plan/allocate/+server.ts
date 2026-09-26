import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { listBlocks } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { getRegistry } from '$lib/server/registry';
import { buildFarmContextWithCache } from '$lib/server/aiContext';
import { allocate, allocateDeterministic, type AllocationResult } from '$lib/server/aiAllocation';
import { recordCall } from '$lib/server/aiGuard';
import { degradeTag, recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import type { PlanInput } from '$lib/layout/engine';
import type { CompanionPlugin, CropPlugin } from '$lib/plugins/schemas';
import { companionIndex } from '$lib/plugins/companionRelations';
import { getActivePlanningYear } from '$lib/season/planningYear.server';

const bodySchema = z.object({
  seedSelections: z
    .array(
      z.object({
        stockItemId: z.string().min(1),
        cropPluginId: z.string().min(1),
        varietyDisplayName: z.string().min(1).max(160),
        quantityPlants: z.number().int().positive().max(1_000_000),
        sunRequirement: z.enum(['full', 'partial', 'shade']).optional()
      })
    )
    .min(1)
    .max(50),
  blockIds: z.array(z.string().min(1)).min(1).max(50),
  year: z.number().int().min(2000).max(2100).optional(),
  /** Phase 17 (Track 3.4) — when supplied, the AI conversation threads with
   *  prior turns from the same session (suggest/groups). */
  planningSessionId: z.string().min(1).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);

  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const allBlocks = listBlocks();
  const selectedBlocks = allBlocks.filter((b) => parsed.data.blockIds.includes(b.id));
  if (selectedBlocks.length === 0) {
    return json({ error: 'none of the supplied blockIds match a known block' }, { status: 400 });
  }

  const registry = await getRegistry();
  const pluginIndex: Record<string, CropPlugin> = {};
  const companionSystems: CompanionPlugin[] = [];
  for (const r of registry.all()) {
    if (r.plugin.type === 'crop') {
      pluginIndex[r.plugin.pluginId] = r.plugin as CropPlugin;
    } else if (r.plugin.type === 'companion') {
      const c = r.plugin as CompanionPlugin;
      companionSystems.push(c);
    }
  }
  const companions: PlanInput['companions'] = companionIndex(companionSystems);

  // Reject seeds whose plugin is unknown (the registry didn't load it).
  const unknownPlugins = parsed.data.seedSelections
    .filter((s) => !pluginIndex[s.cropPluginId])
    .map((s) => s.cropPluginId);
  if (unknownPlugins.length > 0) {
    return json({ error: 'unknown crop plugin(s)', plugins: unknownPlugins }, { status: 400 });
  }

  const planInput: PlanInput = {
    seeds: parsed.data.seedSelections.map((s) => ({
      stockItemId: s.stockItemId,
      cropPluginId: s.cropPluginId,
      varietyDisplayName: s.varietyDisplayName,
      quantityPlants: s.quantityPlants,
      sunRequirement: s.sunRequirement
    })),
    blocks: selectedBlocks,
    axes: selectedBlocks.map((b) => ({
      blockId: b.id,
      east: b.eastWestIndex ?? null,
      north: b.northSouthIndex ?? null
    })),
    existingCrops: listCrops(),
    pluginIndex,
    companions
  };

  const year = parsed.data.year ?? getActivePlanningYear();

  // Invariant 7 — every degradation (no key, cap, quota, timeout, upstream
  // error) goes through aiTry() via tryAiWithGuard and ends in the
  // deterministic engine plan tagged `meta.fallback`, never a 4xx/5xx.
  const tried = await tryAiWithGuard({
    endpoint: 'allocate',
    userId: user.id,
    prompt: async () => {
      const built = await buildFarmContextWithCache(year);
      return allocate(planInput, built.context, {
        planningSessionId: parsed.data.planningSessionId,
        contextCacheHit: built.cacheHit,
        contextVersion: built.contextVersion,
        companionSystems
      });
    }
  });

  let result: AllocationResult;
  let fallbackMessage: string | null = null;
  if (tried.provenance === 'fallback') {
    fallbackMessage = tried.fallbackMessage;
    const tag = degradeTag(tried.fallbackReason, tried.guard);
    result = allocateDeterministic(
      planInput,
      tag === 'quota-exceeded' && !tried.guard.ok && tried.guard.reason === 'cap-exceeded'
        ? 'over-cap'
        : tag,
      tag === 'ai-unavailable' ? fallbackMessage : undefined
    );
    recordFallback(user.id, 'allocate', tried.fallbackReason);
  } else {
    result = tried.value;
    recordCall({
      userId: user.id,
      endpoint: 'allocate',
      model: result.meta.model,
      inputTokens: result.meta.inputTokens,
      cachedInputTokens: result.meta.cachedInputTokens,
      outputTokens: result.meta.outputTokens,
      usdEstimate: result.meta.usdEstimate,
      success: result.assignments.length > 0,
      errorClass: result.meta.fallback,
      provenance: result.meta.fallback ? 'fallback' : 'ai'
    });
  }

  return json({
    assignments: result.assignments,
    unplaced: result.unplaced,
    sufficiency: result.sufficiency,
    rationale: result.rationale,
    perRowRationale: result.perRowRationale,
    advisories: result.advisories,
    pollinationConstraints: result.pollinationConstraints,
    geometryMissingBlockIds: result.geometryMissingBlockIds,
    companionGroups: result.companionGroups,
    meta: {
      model: result.meta.model,
      usdEstimate: result.meta.usdEstimate,
      fallback: result.meta.fallback,
      violationsOnFirstAttempt: result.meta.violationsOnFirstAttempt
    },
    spend: tried.guard.ok ? tried.guard.spend : null,
    guardMessage: tried.guard.ok ? null : tried.guard.message,
    fallbackMessage
  });
};
