import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { listCrops } from '$lib/db/crops';
import { getRegistry } from '$lib/server/registry';
import { buildFarmContextWithCache } from '$lib/server/aiContext';
import { refineSchedule } from '$lib/server/aiSchedule';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import { frostDatesForYear } from '$lib/schedule/settings';
import type { CropPlugin } from '$lib/plugins/schemas';

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
  previousScheduled: z
    .array(
      z.object({
        stockItemId: z.string().min(1),
        blockId: z.string().min(1),
        cropPluginId: z.string().min(1),
        varietyDisplayName: z.string().min(1).max(160),
        plantingDateMs: z.number().int(),
        plants: z.number().int().positive(),
        successionIndex: z
          .object({ i: z.number().int().positive(), n: z.number().int().positive() })
          .optional()
          .nullable(),
        rationale: z.string().max(800).default('')
      })
    )
    .min(1)
    .max(400),
  previousRationale: z.string().max(4000).default(''),
  previousAdvisories: z.array(z.string().max(800)).max(12).default([]),
  transcript: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000)
      })
    )
    .min(1)
    .max(30),
  year: z.number().int().min(2000).max(2100).optional(),
  planningSessionId: z.string().min(1).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const guard = checkGuard(user.id, 'allocate');
  if (!guard.ok) {
    recordCall({
      userId: user.id,
      endpoint: 'allocate',
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
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success)
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });

  const lastTurn = parsed.data.transcript[parsed.data.transcript.length - 1];
  if (lastTurn.role !== 'user') {
    return json({ error: 'transcript must end with a user message' }, { status: 400 });
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

  const year = parsed.data.year ?? new Date().getFullYear();
  const frostDates = frostDatesForYear(year);
  const built = await buildFarmContextWithCache(year);

  try {
    const result = await refineSchedule(
      {
        assignments: parsed.data.assignments,
        pluginIndex,
        existingCrops: listCrops(),
        pollinationConstraints: parsed.data.pollinationConstraints,
        companionGroups: parsed.data.companionGroups,
        frostDates,
        year,
        previousScheduled: parsed.data.previousScheduled.map((p) => ({
          ...p,
          successionIndex: p.successionIndex ?? undefined
        })),
        previousRationale: parsed.data.previousRationale,
        previousAdvisories: parsed.data.previousAdvisories,
        transcript: parsed.data.transcript
      },
      built.context,
      { planningSessionId: parsed.data.planningSessionId }
    );

    recordCall({
      userId: user.id,
      endpoint: 'allocate',
      model: result.meta.model,
      inputTokens: result.meta.inputTokens,
      cachedInputTokens: result.meta.cachedInputTokens,
      outputTokens: result.meta.outputTokens,
      usdEstimate: result.meta.usdEstimate,
      success: result.scheduled.length > 0,
      errorClass: result.meta.fallback
    });

    return json({
      reply: result.reply,
      scheduled: result.scheduled,
      rationale: result.rationale,
      advisories: result.advisories,
      meta: {
        model: result.meta.model,
        usdEstimate: result.meta.usdEstimate,
        fallback: result.meta.fallback,
        violations: result.meta.violations
      },
      spend: guard.spend
    });
  } catch (err) {
    recordCall({
      userId: user.id,
      endpoint: 'allocate',
      model: 'unknown',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      success: false,
      errorClass: 'upstream-error'
    });
    return json(
      { error: err instanceof Error ? err.message : 'schedule refinement failed' },
      { status: 502 }
    );
  }
};
