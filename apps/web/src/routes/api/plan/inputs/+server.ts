/**
 * POST /api/plan/inputs (Phase 21 / B-28 / UC-37d).
 *
 * Server-side wrapper around the deterministic `planInputs()` (B-26).
 * Loads the world (blocks, soil tests, fertility credits, plugins,
 * stock) from the tenant-scoped repos, joins the in-memory provisional
 * plantings from the wizard's Schedule step, then runs the planner.
 *
 * The AI substitution + tank-mix consolidation layer (B-27) wires in
 * on top of this endpoint via `/api/plan/inputs/refine` — the
 * deterministic path here is both the AI's fallback and the
 * out-of-box experience when ANTHROPIC_API_KEY is unset.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { listBlocks } from '$lib/db/blocks';
import { listSoilTestsForBlock, listFertilityCreditsForBlock } from '$lib/db/fertility';
import { listStockItems } from '$lib/db/stock';
import { type InputsPlanInput } from '$lib/plan/inputsPlan';
import type {
  FertilizerPlugin,
  FungicidePlugin,
  HerbicidePlugin,
  InsecticidePlugin
} from '$lib/plugins/schemas';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { getRegistry } from '$lib/server/registry';
import { currentUser } from '$lib/server/auth';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import { planInputsWithAI } from '$lib/server/aiInputsPlan';

const provisionalPlantingSchema = z.object({
  id: z.string().min(1),
  blockId: z.string().min(1),
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1),
  plantingDate: z.number().int().nullable(),
  quantityPlanted: z.number().nonnegative().optional(),
  quantityUnit: z.string().optional()
});

const requestSchema = z.object({
  plantings: z.array(provisionalPlantingSchema).min(1),
  year: z.number().int().positive()
});

export const POST: RequestHandler = async (event) => {
  // Auth required so tenant scoping kicks in; read-only inspectors are
  // fine — the endpoint only computes, never mutates.
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });

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

  const { plantings, year } = parsed.data;

  const seasonSetup = loadSeasonSetup(year);
  if (!seasonSetup) {
    return json(
      {
        error: 'no season setup for year — complete the season setup step first',
        needsSeasonSetup: true,
        year
      },
      { status: 409 }
    );
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
  // Strip plantings off Block before passing in — the planner only
  // reads acres + geometry.
  const blocks = blocksFull.map(({ plantings: _drop, ...rest }) => rest);

  // Soil tests + fertility credits are loaded per block referenced by
  // any planting, then merged into flat lists.
  const referencedBlockIds = new Set(plantings.map((p) => p.blockId));
  const soilTests = [];
  const fertilityCredits = [];
  for (const blockId of referencedBlockIds) {
    soilTests.push(...listSoilTestsForBlock(blockId));
    fertilityCredits.push(...listFertilityCreditsForBlock(blockId, year));
  }

  // Stock — pulled scoped to the four input categories; deliberately
  // includes inactive/zero-balance rows so the planner can decide
  // whether they cover the new plan.
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

  const baseInput = {
    plantings,
    blocks,
    cropPlugins,
    seasonSetup,
    soilTests,
    fertilityCredits,
    productPlugins: { herbicides, insecticides, fungicides, fertilizers },
    existingStock,
    year
  };

  // AI substitution pass — only attempts when API key + quota allow.
  // Always returns a valid plan (deterministic fallback baked in).
  const guard = checkGuard(auth.id, 'inputs');
  if (!guard.ok) {
    // Quota / cap exceeded — run the deterministic planner and stamp
    // meta.fallback so the UI surfaces a banner.
    const { planInputs } = await import('$lib/plan/inputsPlan');
    const plan = planInputs(baseInput);
    return json({
      plan,
      meta: {
        model: 'no-call',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0,
        fallback: 'quota-exceeded',
        violations: [guard.reason]
      }
    });
  }

  const result = await planInputsWithAI(baseInput);

  // Record the call telemetry — even when the AI didn't actually run
  // (no api key / fallback), we record a row tagged success=false so
  // the call count is honest. This is consistent with aiSchedule.ts.
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
