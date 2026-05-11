/**
 * POST /api/stock/[id]/refresh-ai
 *
 * Looks up canonical metadata for a single stock item via Claude Sonnet
 * with the Anthropic-managed `web_search` tool. Returns the refreshed
 * fields with citations; the UI surfaces them for operator review and
 * confirms via PATCH /api/stock/[id] before persisting.
 *
 * This endpoint NEVER writes to the DB — preview-only. The user accepts
 * or discards from the inventory edit modal.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getStockItem } from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { refreshStockItem } from '$lib/server/aiRefreshStock';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import type { CropPlugin } from '$lib/plugins/schemas';

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const guard = checkGuard(user.id, 'rationale');
  if (!guard.ok) {
    recordCall({
      userId: user.id,
      endpoint: 'rationale',
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

  const id = event.params.id;
  if (!id) return json({ error: 'missing id' }, { status: 400 });
  const item = getStockItem(id);
  if (!item) return json({ error: 'item not found' }, { status: 404 });

  const registry = await getRegistry();
  let cropFamily: string | undefined;
  if (item.pluginId) {
    const rec = registry.get(item.pluginId);
    if (rec?.plugin.type === 'crop') cropFamily = (rec.plugin as CropPlugin).cropFamily;
  }

  const existingSeedMeta = safeParseJson(item.metadataJson);
  const existingActiveIngredients = safeParseJson(item.activeIngredientsJson);
  const existingFormulation = safeParseJson(item.formulationJson);

  const response = await refreshStockItem({
    itemId: item.id,
    displayName: item.displayName,
    category: item.category,
    pluginId: item.pluginId,
    cropFamily,
    existingSeedMeta: isObject(existingSeedMeta) ? existingSeedMeta : undefined,
    existingActiveIngredients: Array.isArray(existingActiveIngredients)
      ? existingActiveIngredients
      : undefined,
    existingFormulation: isObject(existingFormulation) ? existingFormulation : undefined
  });

  recordCall({
    userId: user.id,
    endpoint: 'rationale',
    model: response.meta.model,
    inputTokens: response.meta.inputTokens,
    cachedInputTokens: response.meta.cachedInputTokens,
    outputTokens: response.meta.outputTokens,
    usdEstimate: response.meta.usdEstimate,
    success: !!response.result?.hasCitations,
    errorClass: response.meta.fallback
  });

  return json({
    result: response.result,
    meta: {
      model: response.meta.model,
      usdEstimate: response.meta.usdEstimate,
      fallback: response.meta.fallback
    },
    spend: guard.spend
  });
};

function safeParseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
