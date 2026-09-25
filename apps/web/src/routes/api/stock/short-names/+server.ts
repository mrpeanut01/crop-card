/**
 * POST /api/stock/short-names
 *
 * Phase 15d — generates short labels for stock items via Haiku 4.5.
 * Persists `short_name` on each successful row. Items already short-named
 * are skipped unless `force=true` is passed.
 *
 * Body:
 *   { itemIds?: string[], force?: boolean }
 *
 * If `itemIds` is omitted, runs across every stock item missing a short
 * name (or every item when `force=true`).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { listStockItems, updateStockItem } from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { generateShortNames, type ShortNameInput } from '$lib/server/aiShortNames';
import { recordCall } from '$lib/server/aiGuard';
import { recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import type { CropPlugin } from '$lib/plugins/schemas';

const bodySchema = z.object({
  itemIds: z.array(z.string().min(1)).max(200).optional(),
  force: z.boolean().optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    raw = {};
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const allItems = listStockItems();
  const filtered = (
    parsed.data.itemIds ? allItems.filter((i) => parsed.data.itemIds!.includes(i.id)) : allItems
  ).filter((i) => parsed.data.force === true || !i.shortName);

  if (filtered.length === 0) {
    return json({
      updated: 0,
      results: [],
      meta: { model: 'n/a', usdEstimate: 0 },
      spend: null
    });
  }

  const registry = await getRegistry();
  const cropFamilyOf = (pluginId: string | undefined): string | undefined => {
    if (!pluginId) return undefined;
    const rec = registry.get(pluginId);
    if (!rec || rec.plugin.type !== 'crop') return undefined;
    return (rec.plugin as CropPlugin).cropFamily;
  };

  const inputs: ShortNameInput[] = filtered.map((i) => ({
    itemId: i.id,
    displayName: i.displayName,
    cropFamily: cropFamilyOf(i.pluginId),
    category: i.category
  }));

  const tried = await tryAiWithGuard({
    endpoint: 'shortNames',
    userId: user.id,
    timeoutMs: 60_000,
    prompt: () => generateShortNames(inputs)
  });

  if (tried.provenance === 'fallback') {
    recordFallback(user.id, 'shortNames', tried.fallbackReason);
    return json({
      updated: 0,
      results: inputs.map((i) => ({ itemId: i.itemId, shortName: null })),
      provenance: 'fallback',
      fallbackReason: tried.fallbackReason,
      message: `${tried.fallbackMessage} Items keep their full display names.`,
      meta: {
        model: 'n/a',
        usdEstimate: 0,
        fallback: tried.fallbackReason === 'no-key' ? 'no-api-key' : 'ai-unavailable'
      },
      spend: tried.guard.ok ? tried.guard.spend : null
    });
  }

  const response = tried.value;

  let updated = 0;
  for (const r of response.results) {
    if (!r.shortName) continue;
    try {
      updateStockItem(r.itemId, { shortName: r.shortName });
      updated++;
    } catch {
      // ignore per-row failures; the result list reflects them.
    }
  }

  const provenance = response.meta.fallback ? 'fallback' : 'ai';
  recordCall({
    userId: user.id,
    endpoint: 'shortNames',
    model: response.meta.model,
    inputTokens: response.meta.inputTokens,
    cachedInputTokens: response.meta.cachedInputTokens,
    outputTokens: response.meta.outputTokens,
    usdEstimate: response.meta.usdEstimate,
    success: updated > 0,
    errorClass: response.meta.fallback,
    provenance
  });

  return json({
    updated,
    results: response.results,
    provenance,
    meta: {
      model: response.meta.model,
      usdEstimate: response.meta.usdEstimate,
      fallback: response.meta.fallback
    },
    spend: tried.guard.ok ? tried.guard.spend : null
  });
};
