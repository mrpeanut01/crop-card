import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { buildFarmContext } from '$lib/server/aiContext';
import { planWithAI } from '$lib/server/aiPlanning';
import { recordCall } from '$lib/server/aiGuard';
import { recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import { getActivePlanningYear } from '$lib/season/planningYear.server';

const bodySchema = z.object({
  cropWishlist: z.array(z.string().min(1)).min(1).max(50),
  year: z.number().int().min(2000).max(2100).optional()
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

  const year = parsed.data.year ?? getActivePlanningYear();
  const userPrompt = [
    `Plan a full ${year} season placing each of these crops on appropriate blocks:`,
    parsed.data.cropWishlist.map((id) => `- ${id}`).join('\n'),
    '',
    'Constraints:',
    '- Honor the rotation rule (3-yr break for brassica/allium, 4-yr for solanaceae, 2-yr for cucurbit, 1-yr for legume/corn).',
    '- Honor the shade rule: do not place full-sun specialty crops directly E or W of a tall (shade=Y) crop on adjacent blocks.',
    '- Plant after last spring frost; finish before first fall frost (DTM-aware).',
    '- Distribute load: avoid two big plantings on the same day if possible.',
    '',
    'Output JSON only: { "suggestions": [{ "blockId": "...", "cropPluginId": "...", "plantingDate": "YYYY-MM-DD", "rationaleShort": "..." }] }.'
  ].join('\n');

  const tried = await tryAiWithGuard({
    endpoint: 'optimize',
    userId: user.id,
    prompt: async (signal) => {
      const ctx = await buildFarmContext(year);
      return planWithAI('optimize', ctx, userPrompt, { signal });
    }
  });

  if (tried.provenance === 'fallback') {
    recordFallback(user.id, 'optimize', tried.fallbackReason);
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
    endpoint: 'optimize',
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
