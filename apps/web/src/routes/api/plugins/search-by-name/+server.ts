/**
 * POST /api/plugins/search-by-name
 *
 * Path B — operator types a partial product name; server returns up to 3
 * candidate plugins. Always runs the local fuzzy match first (free); only
 * spends AI quota when the local match cannot produce a high-confidence
 * result.
 *
 * Request: { query: string, hintType?: pluginKind, skipWebSearch?: boolean }
 * Response: { candidates: PluginCandidate[], source: 'local'|'web-search'|'mixed', meta }
 *
 * Quota: `'plugin-search'` in `DEFAULT_AI_DAILY_QUOTA` (15 calls/day default).
 * Local-only responses do NOT consume quota.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import {
  AnthropicOverloadedError,
  claudePluginSearchByName,
  localFuzzyMatchPlugins,
  type PluginCandidate,
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
  query: z.string().min(2).max(120),
  hintType: z.enum(PLUGIN_KIND_HINTS).optional(),
  /** When true, server returns the local fuzzy match only (no AI call).
   *  Useful for keystroke-level autocomplete that should never spend quota. */
  skipWebSearch: z.boolean().optional()
});

const LOCAL_CONFIDENT_THRESHOLD = 0.6;

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
    return json(
      { error: 'invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { query, hintType, skipWebSearch } = parsed.data;

  const localMatches = await localFuzzyMatchPlugins(
    query,
    hintType as PluginKindHint | undefined
  );
  const hasConfidentLocal = localMatches.some(
    (m) => (m.score ?? 0) >= LOCAL_CONFIDENT_THRESHOLD
  );

  if (skipWebSearch || hasConfidentLocal) {
    return json({
      candidates: localMatches,
      source: 'local',
      meta: { skippedWebSearch: true, hasConfidentLocal }
    });
  }

  const guard = checkGuard(session.id, 'plugin-search');
  if (!guard.ok) {
    return json(
      {
        candidates: localMatches,
        source: 'local',
        meta: { quotaBlocked: true, message: guard.message }
      },
      { status: localMatches.length > 0 ? 200 : guard.status }
    );
  }

  try {
    const ai = await claudePluginSearchByName(
      query,
      hintType as PluginKindHint | undefined
    );
    recordCall({
      userId: session.id,
      endpoint: 'plugin-search',
      model: ai.meta.model,
      inputTokens: ai.meta.inputTokens,
      cachedInputTokens: ai.meta.cachedInputTokens,
      outputTokens: ai.meta.outputTokens,
      usdEstimate: ai.meta.usdEstimate,
      success: ai.candidates.length > 0
    });

    const merged: PluginCandidate[] = [...localMatches, ...ai.candidates].slice(0, 6);
    const source: 'local' | 'web-search' | 'mixed' =
      localMatches.length > 0 && ai.candidates.length > 0
        ? 'mixed'
        : ai.candidates.length > 0
          ? 'web-search'
          : 'local';
    return json({
      candidates: merged,
      source,
      citations: ai.citations,
      meta: ai.meta
    });
  } catch (err) {
    if (err instanceof AnthropicOverloadedError) {
      return json(
        {
          candidates: localMatches,
          source: 'local',
          meta: { upstreamOverloaded: true, message: err.message }
        },
        { status: 200 }
      );
    }
    recordCall({
      userId: session.id,
      endpoint: 'plugin-search',
      model: 'unknown',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      success: false,
      errorClass: err instanceof Error ? err.name : 'unknown'
    });
    return json(
      {
        candidates: localMatches,
        source: 'local',
        meta: { error: err instanceof Error ? err.message : String(err) }
      },
      { status: localMatches.length > 0 ? 200 : 500 }
    );
  }
};
