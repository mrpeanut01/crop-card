import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { buildFarmContextWithCache } from '$lib/server/aiContext';
import { planWithAI } from '$lib/server/aiPlanning';
import { checkGuard, recordCall } from '$lib/server/aiGuard';

const bodySchema = z.object({
  blockId: z.string().min(1),
  /** Optional planting year; defaults to current year. */
  year: z.number().int().min(2000).max(2100).optional(),
  /** Phase 17 (Track 3.4) — when supplied, the AI conversation threads with
   *  prior turns from the same session (allocate/groups/suggest). */
  planningSessionId: z.string().min(1).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const guard = checkGuard(user.id, 'suggest');
  if (!guard.ok) {
    recordCall({
      userId: user.id,
      endpoint: 'suggest',
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

  const year = parsed.data.year ?? new Date().getFullYear();
  const built = await buildFarmContextWithCache(year);
  const userPrompt = [
    `Suggest 3–5 crop plantings for blockId="${parsed.data.blockId}" in ${year}.`,
    'Respect the rotation rule: examine the block ID; you may not see history, so suggest cultivars across diverse families.',
    'Respect the shade rule: avoid placing tall (shade=Y) crops directly west or east of full-sun specialty crops on adjacent blocks.',
    'Prefer plantingDate after last spring frost.',
    'Output JSON: { "suggestions": [{ "blockId": "...", "cropPluginId": "...", "plantingDate": "YYYY-MM-DD", "rationaleShort": "..." }] }.'
  ].join('\n');

  try {
    const { suggestions, meta } = await planWithAI('suggest', built.context, userPrompt, {
      planningSessionId: parsed.data.planningSessionId,
      contextCacheHit: built.cacheHit
    });
    recordCall({
      userId: user.id,
      endpoint: 'suggest',
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
      meta: {
        model: meta.model,
        usdEstimate: meta.usdEstimate
      }
    });
  } catch (err) {
    recordCall({
      userId: user.id,
      endpoint: 'suggest',
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
