/**
 * POST /api/stock/refresh-ai
 *
 * Bulk-refresh stock items via Claude + web_search. Mirrors
 * /api/stock/short-names: serial per-item calls (one web_search budget
 * each) so cost stays observable. The endpoint is preview-only — the UI
 * presents per-item diffs and the operator confirms each before any
 * PATCH /api/stock/[id] persists.
 *
 * Body:
 *   { itemIds?: string[], onlyMissing?: boolean }
 *   - itemIds omitted → all stock items (filtered by onlyMissing).
 *   - onlyMissing default true → skips items that already carry
 *     activeIngredientsJson / formulationJson / metadataJson.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
  listStockItems,
  getStockItem,
  setPendingRefresh,
  listItemsWithPendingRefresh
} from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { refreshStockItem, type StockRefreshResult } from '$lib/server/aiRefreshStock';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import type { CropPlugin } from '$lib/plugins/schemas';

const MAX_ITEMS_PER_BULK = 25;

const bodySchema = z.object({
  itemIds: z.array(z.string().min(1)).max(MAX_ITEMS_PER_BULK).optional(),
  onlyMissing: z.boolean().optional()
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

  const onlyMissing = parsed.data.onlyMissing !== false;
  const all = listStockItems();
  let pool = parsed.data.itemIds
    ? all.filter((i) => parsed.data.itemIds!.includes(i.id))
    : all;

  // Track diagnostics so a 0-processed response can explain WHY.
  const diagnostics: Record<string, { total: number; eligible: number; reasonWhenZero?: string }> = {};
  for (const i of pool) {
    const cat = i.category;
    const slot = (diagnostics[cat] ??= { total: 0, eligible: 0 });
    slot.total++;
  }

  if (onlyMissing) {
    pool = pool.filter((i) => {
      const refreshable = isRefreshable(i);
      if (refreshable) diagnostics[i.category].eligible++;
      return refreshable;
    });
  } else {
    for (const slot of Object.values(diagnostics)) slot.eligible = slot.total;
  }
  // Annotate categories with 0 eligible so the UI can explain.
  for (const [cat, slot] of Object.entries(diagnostics)) {
    if (slot.eligible === 0 && slot.total > 0) {
      slot.reasonWhenZero = reasonForCategory(cat);
    }
  }

  // Bulk cap so a single button click can't trigger 100 web_search calls.
  const overflowed = pool.length > MAX_ITEMS_PER_BULK;
  pool = pool.slice(0, MAX_ITEMS_PER_BULK);

  if (pool.length === 0) {
    return json({
      processed: 0,
      withCitations: 0,
      results: [] as StockRefreshResult[],
      meta: {
        totalUsd: 0,
        totalItems: all.length,
        diagnostics,
        message:
          all.length === 0
            ? 'No stock items in inventory yet — add some via /stock first.'
            : 'No items needed enrichment — every category already carries the key field that AI Refresh would add. Pass {"onlyMissing": false} to refresh anyway.'
      }
    });
  }

  const registry = await getRegistry();
  const cropFamilyOf = (pluginId: string | undefined): string | undefined => {
    if (!pluginId) return undefined;
    const rec = registry.get(pluginId);
    if (!rec || rec.plugin.type !== 'crop') return undefined;
    return (rec.plugin as CropPlugin).cropFamily;
  };

  const results: StockRefreshResult[] = [];
  let totalUsd = 0;
  let totalInput = 0;
  let totalCached = 0;
  let totalOutput = 0;
  let lastModel = 'n/a';
  let withCitations = 0;
  let firstFallback: string | undefined;

  for (const stockId of pool.map((p) => p.id)) {
    // Per-item guard check so a single overrun doesn't burn the whole batch.
    const guard = checkGuard(user.id, 'rationale');
    if (!guard.ok) {
      firstFallback = firstFallback ?? guard.reason;
      break;
    }
    const item = getStockItem(stockId);
    if (!item) continue;
    const existingSeedMeta = safeParseJson(item.metadataJson);
    const existingActive = safeParseJson(item.activeIngredientsJson);
    const existingFormulation = safeParseJson(item.formulationJson);

    const r = await refreshStockItem({
      itemId: item.id,
      displayName: item.displayName,
      shortName: item.shortName,
      category: item.category,
      pluginId: item.pluginId,
      cropFamily: cropFamilyOf(item.pluginId),
      existingSeedMeta: isObject(existingSeedMeta) ? existingSeedMeta : undefined,
      existingActiveIngredients: Array.isArray(existingActive) ? existingActive : undefined,
      existingFormulation: isObject(existingFormulation) ? existingFormulation : undefined
    });

    if (r.result) {
      results.push(r.result);
      if (r.result.hasCitations) {
        withCitations++;
        // Phase 17 follow-up — persist the per-item suggestion so the
        // operator can review/apply later by opening that item in /stock.
        // Without this, bulk results were one-shot list output that
        // disappeared when the operator navigated away.
        try {
          setPendingRefresh(item.id, JSON.stringify(r.result));
        } catch {
          /* non-fatal */
        }
      }
    }
    totalInput += r.meta.inputTokens;
    totalCached += r.meta.cachedInputTokens;
    totalOutput += r.meta.outputTokens;
    totalUsd += r.meta.usdEstimate;
    lastModel = r.meta.model;
    if (!firstFallback) firstFallback = r.meta.fallback;

    recordCall({
      userId: user.id,
      endpoint: 'rationale',
      model: r.meta.model,
      inputTokens: r.meta.inputTokens,
      cachedInputTokens: r.meta.cachedInputTokens,
      outputTokens: r.meta.outputTokens,
      usdEstimate: r.meta.usdEstimate,
      success: !!r.result?.hasCitations,
      errorClass: r.meta.fallback
    });
  }

  return json({
    processed: results.length,
    withCitations,
    overflowed,
    results,
    meta: {
      model: lastModel,
      totalUsd,
      totalInputTokens: totalInput,
      totalCachedTokens: totalCached,
      totalOutputTokens: totalOutput,
      fallback: firstFallback,
      diagnostics
    }
  });
};

/**
 * GET /api/stock/refresh-ai
 *
 * Returns the list of stock items with unreviewed AI Refresh suggestions.
 * Each entry summarizes what was captured (which fields, when) so the
 * Settings → Pending Suggestions panel can render a scannable list.
 */
export const GET: RequestHandler = (event) => {
  requireOwner(event);
  const rows = listItemsWithPendingRefresh();
  const summaries: Array<{
    itemId: string;
    displayName: string;
    shortName?: string;
    category: string;
    pendingRefreshAt: number;
    ageMs: number;
    fieldCount: number;
    citationCount: number;
    fieldKeys: string[];
  }> = [];
  const now = Date.now();
  for (const row of rows) {
    const item = getStockItem(row.id);
    if (!item?.pendingRefreshJson) continue;
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(item.pendingRefreshJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const fieldKeys = Object.keys(parsed).filter(
      (k) => !['itemId', 'hasCitations', 'notes', 'citations'].includes(k)
    );
    const citations = Array.isArray(parsed.citations) ? parsed.citations : [];
    summaries.push({
      itemId: row.id,
      displayName: row.displayName,
      shortName: row.shortName,
      category: row.category,
      pendingRefreshAt: row.pendingRefreshAt,
      ageMs: now - row.pendingRefreshAt,
      fieldCount: fieldKeys.length,
      citationCount: citations.length,
      fieldKeys
    });
  }
  summaries.sort((a, b) => b.pendingRefreshAt - a.pendingRefreshAt);
  return json({ pending: summaries });
};

/**
 * DELETE /api/stock/refresh-ai
 *
 * Clears the pending AI Refresh suggestion on every stock item the
 * caller owns. Used by the Settings "Discard all" action.
 */
export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const rows = listItemsWithPendingRefresh();
  let cleared = 0;
  for (const row of rows) {
    try {
      setPendingRefresh(row.id, null);
      cleared++;
    } catch {
      /* per-row failure shouldn't abort the batch */
    }
  }
  return json({ cleared });
};

/**
 * "Refreshable" means the item is missing at least one field the AI
 * Refresh module can populate from web search. We deliberately look at
 * SPECIFIC fields rather than mere presence of a JSON blob — a seed
 * scanned at intake has metadataJson but probably lacks `matureHeightFt`,
 * which is the most valuable field the refresh adds.
 */
function isRefreshable(item: ReturnType<typeof listStockItems>[number]): boolean {
  if (item.category === 'seed') {
    if (!item.metadataJson) return true;
    const m = safeParseJson(item.metadataJson);
    if (!isObject(m)) return true;
    // Seeds become "complete" when they carry mature height + DTM.
    return typeof m.matureHeightFt !== 'number' || typeof m.daysToMaturity !== 'number';
  }
  if (item.category === 'fertilizer') {
    if (!item.formulationJson) return true;
    const f = safeParseJson(item.formulationJson);
    return !isObject(f) || !isObject((f as Record<string, unknown>).npk);
  }
  if (['herbicide', 'insecticide', 'fungicide'].includes(item.category)) {
    if (!item.activeIngredientsJson) return true;
    const a = safeParseJson(item.activeIngredientsJson);
    if (!Array.isArray(a) || a.length === 0) return true;
    // Refreshable when at least one active ingredient has no chemistryClass.
    return a.some((row) => {
      if (!isObject(row)) return true;
      const r = row as Record<string, unknown>;
      return typeof r.chemistryClass !== 'string';
    });
  }
  // adjuvant/fuel/part — no refresh schema today.
  return false;
}

function reasonForCategory(cat: string): string {
  if (cat === 'seed') return 'every seed already has matureHeightFt + daysToMaturity';
  if (cat === 'fertilizer') return 'every fertilizer already has an N-P-K analysis';
  if (['herbicide', 'insecticide', 'fungicide'].includes(cat)) {
    return 'every chem product already has chemistryClass on its active ingredients';
  }
  return 'category not eligible for AI Refresh';
}

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
