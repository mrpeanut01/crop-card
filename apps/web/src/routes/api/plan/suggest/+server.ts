import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { buildFarmContextWithCache } from '$lib/server/aiContext';
import { planWithAI } from '$lib/server/aiPlanning';
import { recordCall } from '$lib/server/aiGuard';
import { recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';

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
  const userPrompt = [
    `Suggest 3–5 crop plantings for blockId="${parsed.data.blockId}" in ${year}.`,
    'Respect the rotation rule: examine the block ID; you may not see history, so suggest cultivars across diverse families.',
    'Respect the shade rule: avoid placing tall (shade=Y) crops directly west or east of full-sun specialty crops on adjacent blocks.',
    'Prefer plantingDate after last spring frost.',
    'Output JSON: { "suggestions": [{ "blockId": "...", "cropPluginId": "...", "plantingDate": "YYYY-MM-DD", "rationaleShort": "..." }] }.'
  ].join('\n');

  const tried = await tryAiWithGuard({
    endpoint: 'suggest',
    userId: user.id,
    prompt: async (signal) => {
      const built = await buildFarmContextWithCache(year);
      return planWithAI('suggest', built.context, userPrompt, {
        planningSessionId: parsed.data.planningSessionId,
        contextCacheHit: built.cacheHit,
        signal
      });
    }
  });

  if (tried.provenance === 'fallback') {
    recordFallback(user.id, 'suggest', tried.fallbackReason);
    return json({
      suggestions: [],
      fallback: tried.fallbackReason,
      provenance: 'fallback',
      fallbackReason: tried.fallbackReason,
      message: tried.fallbackMessage,
      spend: tried.guard.ok ? tried.guard.spend : null
    });
  }

  const { suggestions, meta } = tried.value;
  recordCall({
    userId: user.id,
    endpoint: 'suggest',
    model: meta.model,
    inputTokens: meta.inputTokens,
    cachedInputTokens: meta.cachedInputTokens,
    outputTokens: meta.outputTokens,
    usdEstimate: meta.usdEstimate,
    success: suggestions.length > 0,
    provenance: 'ai'
  });
  return json({
    suggestions,
    provenance: 'ai',
    spend: tried.guard.ok ? tried.guard.spend : null,
    meta: { model: meta.model, usdEstimate: meta.usdEstimate }
  });
};
