/**
 * POST /api/plugins/scan-label
 *
 * Path A — operator captures a product label photo; server returns ONE
 * plugin candidate parsed by Claude vision + validated against the same
 * Zod + bypass pipeline the upload endpoint uses.
 *
 * The candidate is NOT written to disk. The client renders the review
 * form (`/plugins/new?prefill=...`) and POSTs to `/api/plugins/upload`
 * when the operator confirms.
 *
 * Quota: `'plugin-scan'` in `DEFAULT_AI_DAILY_QUOTA` (10 calls/day default).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import {
  AnthropicOverloadedError,
  claudeVisionPluginLookup,
  type PluginKindHint
} from '$lib/server/aiPluginScan';

const PLUGIN_KIND_HINTS = [
  'crop',
  'herbicide',
  'insecticide',
  'fungicide',
  'fertilizer',
  'companion'
] as const;

const requestSchema = z.object({
  image: z.string().min(1),
  hintType: z.enum(PLUGIN_KIND_HINTS).optional()
});

export const POST: RequestHandler = async (event) => {
  const session = requireOwner(event);
  const guard = checkGuard(session.id, 'plugin-scan');
  if (!guard.ok) {
    return json({ error: guard.message }, { status: guard.status });
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
      { error: 'invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await claudeVisionPluginLookup(
      parsed.data.image,
      parsed.data.hintType as PluginKindHint | undefined
    );
    recordCall({
      userId: session.id,
      endpoint: 'plugin-scan',
      model: result.meta.model,
      inputTokens: result.meta.inputTokens,
      cachedInputTokens: result.meta.cachedInputTokens,
      outputTokens: result.meta.outputTokens,
      usdEstimate: result.meta.usdEstimate,
      success: result.candidate !== null
    });
    if (!result.candidate) {
      return json(
        { found: false, meta: result.meta },
        { status: 200 }
      );
    }
    return json({ found: true, candidate: result.candidate, meta: result.meta });
  } catch (err) {
    if (err instanceof AnthropicOverloadedError) {
      return json(
        { error: err.message, retryable: true },
        { status: 503 }
      );
    }
    recordCall({
      userId: session.id,
      endpoint: 'plugin-scan',
      model: 'unknown',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      success: false,
      errorClass: err instanceof Error ? err.name : 'unknown'
    });
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
};
