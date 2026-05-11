import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { getCrop } from '$lib/db/crops';
import { buildFarmContext } from '$lib/server/aiContext';
import { planWithAI } from '$lib/server/aiPlanning';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import { getRegistry } from '$lib/server/registry';
import type { CropPlugin } from '$lib/plugins/schemas';

const bodySchema = z.object({
  afterCropId: z.string().min(1)
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const guard = checkGuard(user.id, 'succession');
  if (!guard.ok) {
    recordCall({
      userId: user.id,
      endpoint: 'succession',
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
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const prior = getCrop(parsed.data.afterCropId);
  if (!prior) return json({ error: 'crop not found' }, { status: 404 });
  const registry = await getRegistry();
  const priorPlugin = registry.get(prior.cropPluginId)?.plugin as CropPlugin | undefined;
  const priorFamily = priorPlugin?.cropFamily ?? 'unknown';
  const harvestApprox =
    prior.plantingDate != null && priorPlugin?.daysToMaturity?.max != null
      ? new Date(prior.plantingDate + priorPlugin.daysToMaturity.max * 86_400_000)
      : null;
  const harvestISO = harvestApprox ? harvestApprox.toISOString().slice(0, 10) : 'unknown';

  const year =
    harvestApprox?.getFullYear() ??
    (prior.plantingDate != null ? new Date(prior.plantingDate).getFullYear() : new Date().getFullYear());
  const ctx = await buildFarmContext(year);

  const userPrompt = [
    `Find the best succession crop for blockId="${prior.blockId}" after a ${priorFamily} (${prior.cropPluginId}) is harvested around ${harvestISO}.`,
    'Avoid crops in the same family as the prior. Prefer fast-DTM crops if the season is closing.',
    'Output JSON: { "suggestions": [{ "blockId": "...", "cropPluginId": "...", "plantingDate": "YYYY-MM-DD", "rationaleShort": "..." }] }.'
  ].join('\n');

  try {
    const { suggestions, meta } = await planWithAI('succession', ctx, userPrompt);
    recordCall({
      userId: user.id,
      endpoint: 'succession',
      model: meta.model,
      inputTokens: meta.inputTokens,
      cachedInputTokens: meta.cachedInputTokens,
      outputTokens: meta.outputTokens,
      usdEstimate: meta.usdEstimate,
      success: suggestions.length > 0
    });
    return json({
      suggestions,
      spend: guard.spend,
      meta: { model: meta.model, usdEstimate: meta.usdEstimate }
    });
  } catch (err) {
    recordCall({
      userId: user.id,
      endpoint: 'succession',
      model: 'unknown',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      success: false,
      errorClass: 'upstream-error'
    });
    return json(
      { error: err instanceof Error ? err.message : 'AI call failed' },
      { status: 502 }
    );
  }
};
