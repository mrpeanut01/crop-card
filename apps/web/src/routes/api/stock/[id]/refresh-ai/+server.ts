/**
 * POST /api/stock/[id]/refresh-ai     — kick off an AI Refresh lookup
 * DELETE /api/stock/[id]/refresh-ai   — clear the pending suggestion
 *
 * The POST endpoint runs Claude + web_search to fetch canonical specs
 * for one stock item, and persists the result to
 * `stock_items.pending_refresh_json` so the suggestion survives modal
 * close, page reload, and is reviewable later from /stock or Settings.
 * No other columns are written — the operator still confirms each field
 * via the edit modal's "Apply selected" before activeIngredientsJson /
 * formulationJson / metadataJson change.
 *
 * The DELETE endpoint clears the pending suggestion — invoked by the
 * Discard button in the diff panel.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getStockItem, setPendingRefresh, updateStockItem } from '$lib/db/stock';
import { getTaxonomyTerm } from '$lib/db/taxonomy';
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
  // Used server-side to map to the planter-plate catalog's seedType enum.
  // Not sent to Claude.
  const seedTypeName = item.typeId ? getTaxonomyTerm(item.typeId)?.name : undefined;

  const response = await refreshStockItem({
    itemId: item.id,
    displayName: item.displayName,
    shortName: item.shortName,
    category: item.category,
    pluginId: item.pluginId,
    cropFamily,
    existingSeedMeta: isObject(existingSeedMeta) ? existingSeedMeta : undefined,
    existingActiveIngredients: Array.isArray(existingActiveIngredients)
      ? existingActiveIngredients
      : undefined,
    existingFormulation: isObject(existingFormulation) ? existingFormulation : undefined,
    seedTypeName
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

  // Phase 17 follow-up — persist the suggestion so it survives modal
  // close. Only store on success (citations present); failures don't
  // pollute the pending state.
  let pendingRefreshAt: number | undefined;
  if (response.result?.hasCitations) {
    try {
      const saved = setPendingRefresh(id, JSON.stringify(response.result));
      pendingRefreshAt = saved.pendingRefreshAt;
    } catch {
      /* non-fatal — the operator still sees the suggestion in this session */
    }
  }

  return json({
    result: response.result,
    pendingRefreshAt,
    meta: {
      model: response.meta.model,
      usdEstimate: response.meta.usdEstimate,
      fallback: response.meta.fallback,
      errorMessage: response.meta.errorMessage
    },
    spend: guard.spend
  });
};

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id) return json({ error: 'missing id' }, { status: 400 });
  const item = getStockItem(id);
  if (!item) return json({ error: 'item not found' }, { status: 404 });
  setPendingRefresh(id, null);
  return json({ ok: true });
};

/**
 * GET /api/stock/[id]/refresh-ai
 *
 * Returns the stored pending AI Refresh suggestion for one item, so the
 * Settings popup can render the per-field diff panel without a full
 * /stock navigation. Returns `{ result: null }` when no pending data.
 */
export const GET: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id) return json({ error: 'missing id' }, { status: 400 });
  const item = getStockItem(id);
  if (!item) return json({ error: 'item not found' }, { status: 404 });
  if (!item.pendingRefreshJson) {
    return json({ result: null, pendingRefreshAt: null });
  }
  try {
    const result = JSON.parse(item.pendingRefreshJson);
    return json({
      result,
      pendingRefreshAt: item.pendingRefreshAt ?? null,
      displayName: item.displayName,
      shortName: item.shortName,
      category: item.category
    });
  } catch {
    return json({ result: null, pendingRefreshAt: null, parseError: true });
  }
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
