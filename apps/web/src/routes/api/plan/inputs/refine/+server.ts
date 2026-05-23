/**
 * POST /api/plan/inputs/refine (Phase 21 / B-27 / UC-37d).
 *
 * Chat-style refinement on top of an already-loaded InputsPlan. The
 * operator types a free-text request ("swap the pre-plant fertilizer
 * for bone meal"), the AI proposes product substitutions, and the
 * validator pyramid (philosophy → kernel → chemistry → rate ceiling)
 * accepts or rejects.
 *
 * Hard guardrails identical to `/api/plan/inputs`:
 *   - Same quota guard (10 calls/day default, tracked under endpoint
 *     'inputs').
 *   - Same fallback semantics: rejection or missing key → return the
 *     PREVIOUS plan unchanged with meta.fallback set.
 *   - Same telemetry recording so the cost dashboard shows refinement
 *     usage alongside initial planning.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { listBlocks } from '$lib/db/blocks';
import { listSoilTestsForBlock, listFertilityCreditsForBlock } from '$lib/db/fertility';
import { listStockItems } from '$lib/db/stock';
import type {
  FertilizerPlugin,
  FungicidePlugin,
  HerbicidePlugin,
  InsecticidePlugin
} from '$lib/plugins/schemas';
import type { InputsPlan, InputsPlanInput } from '$lib/plan/inputsPlan';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { getRegistry } from '$lib/server/registry';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import { refineInputs } from '$lib/server/aiInputsPlan';

const provisionalPlantingSchema = z.object({
  id: z.string().min(1),
  blockId: z.string().min(1),
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1),
  plantingDate: z.number().int().nullable()
});

const chatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1)
});

const requestSchema = z.object({
  plantings: z.array(provisionalPlantingSchema).min(1),
  year: z.number().int().positive(),
  previousPlan: z.unknown(),
  message: z.string().min(1).max(2000),
  history: z.array(chatTurnSchema).default([])
});

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });
  if (!canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }

  const seasonSetup = loadSeasonSetup(parsed.data.year);
  if (!seasonSetup) {
    return json({ error: 'no season setup for year', year: parsed.data.year }, { status: 409 });
  }

  const guard = checkGuard(auth.id, 'inputs');
  if (!guard.ok) {
    return json({ error: guard.message, reason: guard.reason }, { status: guard.status });
  }

  const registry = await getRegistry();
  const cropPlugins: InputsPlanInput['cropPlugins'] = {};
  const herbicides: HerbicidePlugin[] = [];
  const insecticides: InsecticidePlugin[] = [];
  const fungicides: FungicidePlugin[] = [];
  const fertilizers: FertilizerPlugin[] = [];
  for (const r of registry.all()) {
    const p = r.plugin;
    if (p.type === 'crop') cropPlugins[p.pluginId] = p;
    else if (p.type === 'herbicide') herbicides.push(p);
    else if (p.type === 'insecticide') insecticides.push(p);
    else if (p.type === 'fungicide') fungicides.push(p);
    else if (p.type === 'fertilizer') fertilizers.push(p);
  }

  const blocksFull = listBlocks();
  const blocks = blocksFull.map(({ plantings: _drop, ...rest }) => rest);

  const referencedBlockIds = new Set(parsed.data.plantings.map((p) => p.blockId));
  const soilTests = [];
  const fertilityCredits = [];
  for (const blockId of referencedBlockIds) {
    soilTests.push(...listSoilTestsForBlock(blockId));
    fertilityCredits.push(...listFertilityCreditsForBlock(blockId, parsed.data.year));
  }

  const existingStock = listStockItems()
    .filter(
      (s) =>
        s.category === 'herbicide' ||
        s.category === 'insecticide' ||
        s.category === 'fungicide' ||
        s.category === 'fertilizer'
    )
    .map((s) => ({
      pluginId: s.pluginId,
      category: s.category,
      displayName: s.displayName,
      defaultUnit: s.defaultUnit,
      onHand: s.onHand
    }));

  const baseInput: InputsPlanInput = {
    plantings: parsed.data.plantings,
    blocks,
    cropPlugins,
    seasonSetup,
    soilTests,
    fertilityCredits,
    productPlugins: { herbicides, insecticides, fungicides, fertilizers },
    existingStock,
    year: parsed.data.year
  };

  const result = await refineInputs({
    base: baseInput,
    previousPlan: parsed.data.previousPlan as InputsPlan,
    message: parsed.data.message,
    history: parsed.data.history
  });

  recordCall({
    userId: auth.id,
    endpoint: 'inputs',
    model: result.meta.model,
    inputTokens: result.meta.inputTokens,
    cachedInputTokens: result.meta.cachedInputTokens,
    outputTokens: result.meta.outputTokens,
    usdEstimate: result.meta.usdEstimate,
    success: !result.meta.fallback,
    errorClass: result.meta.fallback
  });

  return json({ plan: result.plan, meta: result.meta });
};
