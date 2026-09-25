import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { listCrops } from '$lib/db/crops';
import { getRegistry } from '$lib/server/registry';
import { buildFarmContextWithCache } from '$lib/server/aiContext';
import { schedulePlantings } from '$lib/server/aiSchedule';
import { recordCall } from '$lib/server/aiGuard';
import { recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import type { FallbackReason } from '$lib/server/aiTry';
import { frostDatesForYear } from '$lib/schedule/settings';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getActivePlanningYear } from '$lib/season/planningYear.server';

const bodySchema = z.object({
  assignments: z
    .array(
      z.object({
        stockItemId: z.string().min(1),
        blockId: z.string().min(1),
        cropPluginId: z.string().min(1),
        varietyDisplayName: z.string().min(1).max(160),
        plants: z.number().int().positive()
      })
    )
    .min(1)
    .max(200),
  pollinationConstraints: z
    .array(
      z.object({
        kind: z.enum(['isolated-spatially', 'must-stagger', 'geometry-missing']),
        pair: z.tuple([z.string(), z.string()]),
        pairDisplayNames: z.tuple([z.string(), z.string()]),
        blockIds: z.tuple([z.string(), z.string()]),
        blockNames: z.tuple([z.string(), z.string()]),
        distanceFt: z.number().nullable(),
        requiredIsolationFeet: z.number(),
        staggerDays: z.number().int().nonnegative(),
        note: z.string().max(500)
      })
    )
    .max(50)
    .default([]),
  companionGroups: z
    .array(
      z.object({
        groupId: z.string(),
        anchorFamily: z.string(),
        members: z
          .array(
            z.object({
              stockItemId: z.string(),
              role: z.enum(['anchor', 'companion']),
              daysFromAnchor: z.number().int().nonnegative().max(120)
            })
          )
          .min(2)
          .max(6)
      })
    )
    .max(50)
    .default([]),
  year: z.number().int().min(2000).max(2100).optional(),
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

  const registry = await getRegistry();
  const pluginIndex: Record<string, CropPlugin> = {};
  for (const r of registry.all()) {
    if (r.plugin.type === 'crop') pluginIndex[r.plugin.pluginId] = r.plugin as CropPlugin;
  }
  const unknown = parsed.data.assignments.filter((a) => !pluginIndex[a.cropPluginId]);
  if (unknown.length > 0) {
    return json(
      { error: 'unknown crop plugin(s)', plugins: unknown.map((a) => a.cropPluginId) },
      { status: 400 }
    );
  }

  const year = parsed.data.year ?? getActivePlanningYear();
  const frostDates = frostDatesForYear(year);
  const built = await buildFarmContextWithCache(year);
  const scheduleInput = {
    assignments: parsed.data.assignments,
    pluginIndex,
    existingCrops: listCrops(),
    pollinationConstraints: parsed.data.pollinationConstraints,
    companionGroups: parsed.data.companionGroups,
    frostDates,
    year
  };
  const options = { planningSessionId: parsed.data.planningSessionId };

  const tried = await tryAiWithGuard({
    endpoint: 'allocate',
    userId: user.id,
    prompt: () => schedulePlantings(scheduleInput, built.context, options)
  });

  let result;
  let provenance: 'ai' | 'fallback';
  let fallbackReason: FallbackReason | null = null;
  let fallbackMessage: string | null = null;
  if (tried.provenance === 'fallback') {
    fallbackReason = tried.fallbackReason;
    fallbackMessage = tried.fallbackMessage;
    result = await schedulePlantings(scheduleInput, built.context, {
      ...options,
      degradeMessage: fallbackReason === 'no-key' ? undefined : fallbackMessage
    });
    provenance = 'fallback';
    recordFallback(user.id, 'allocate', fallbackReason);
  } else {
    result = tried.value;
    provenance = result.meta.fallback ? 'fallback' : 'ai';
    recordCall({
      userId: user.id,
      endpoint: 'allocate',
      model: result.meta.model,
      inputTokens: result.meta.inputTokens,
      cachedInputTokens: result.meta.cachedInputTokens,
      outputTokens: result.meta.outputTokens,
      usdEstimate: result.meta.usdEstimate,
      success: result.scheduled.length > 0,
      errorClass: result.meta.fallback,
      provenance
    });
  }

  return json({
    scheduled: result.scheduled,
    rationale: result.rationale,
    advisories: result.advisories,
    windows: result.windows,
    successionFits: result.successionFits,
    meta: {
      model: result.meta.model,
      usdEstimate: result.meta.usdEstimate,
      fallback: result.meta.fallback,
      violations: result.meta.violations,
      diagnosis: result.meta.diagnosis,
      provenance,
      fallbackReason,
      fallbackMessage
    },
    spend: tried.guard.ok ? tried.guard.spend : null
  });
};
