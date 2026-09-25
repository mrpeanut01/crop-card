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
 * No key / spent quota / cap / upstream failure → 200 `{ found: false,
 * provenance: 'fallback', fallbackReason, message }` (Invariant 7).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { recordCall } from '$lib/server/aiGuard';
import { recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import { claudeVisionPluginLookup, type PluginKindHint } from '$lib/server/aiPluginScan';

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
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const tried = await tryAiWithGuard({
    endpoint: 'plugin-scan',
    userId: session.id,
    timeoutMs: 60_000,
    prompt: (signal) =>
      claudeVisionPluginLookup(
        parsed.data.image,
        parsed.data.hintType as PluginKindHint | undefined,
        signal
      )
  });

  if (tried.provenance === 'fallback') {
    recordFallback(
      session.id,
      'plugin-scan',
      tried.fallbackReason,
      tried.error instanceof Error ? tried.error.name : undefined
    );
    const retryable = tried.guard.ok && tried.fallbackReason !== 'no-key';
    return json({
      found: false,
      provenance: 'fallback',
      fallbackReason: tried.fallbackReason,
      message: `${tried.fallbackMessage} ${
        retryable ? 'Try again, or use' : 'Use'
      } the authoring form to add the plugin by hand.`,
      ...(retryable ? { retryable: true } : {})
    });
  }

  const result = tried.value;
  recordCall({
    userId: session.id,
    endpoint: 'plugin-scan',
    model: result.meta.model,
    inputTokens: result.meta.inputTokens,
    cachedInputTokens: result.meta.cachedInputTokens,
    outputTokens: result.meta.outputTokens,
    usdEstimate: result.meta.usdEstimate,
    success: result.candidate !== null,
    provenance: 'ai'
  });
  if (!result.candidate) {
    return json({ found: false, provenance: 'ai', meta: result.meta }, { status: 200 });
  }
  return json({ found: true, provenance: 'ai', candidate: result.candidate, meta: result.meta });
};
