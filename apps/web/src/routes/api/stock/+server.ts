/**
 * GET  /api/stock        — all SKUs with on-hand balance + low-stock flag
 * POST /api/stock        — owner-only; create a new SKU
 */

import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createStockItem, listStockItems, type StockCategory } from '$lib/db/stock';
import { getTaxonomyTerm } from '$lib/db/taxonomy';
import { STOCK_CATEGORIES } from '$lib/stock/categories';
import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefsIn } from '$lib/server/foreignRefs';
import { checkAnimalStockWrite } from '$lib/server/animalStockRules';

export const GET: RequestHandler = () => {
  return json({ items: listStockItems() });
};

const createSchema = z
  .object({
    category: z.enum(STOCK_CATEGORIES as [StockCategory, ...StockCategory[]]),
    displayName: z.string().min(1).max(120),
    /** Phase 15d — terse label (≤40 chars) for crowded UI. Pre-filled by the
     *  label scan when present; null/undefined means fall back to displayName. */
    shortName: z.string().max(40).optional(),
    defaultUnit: z.enum(ALL_STOCK_UNITS as unknown as [StockUnit, ...StockUnit[]]),
    pluginId: z.string().optional(),
    reorderThreshold: z.number().nonnegative().optional(),
    notes: z.string().max(500).optional(),
    barcode: z.string().max(100).optional(),
    typeId: z.string().optional(),
    metadataJson: z.string().optional(),
    /** Phase 17 (Track 2) — AI-extracted active-ingredients JSON. */
    activeIngredientsJson: z.string().max(4000).optional(),
    /** Phase 17 (Track 2) — AI-extracted formulation JSON. */
    formulationJson: z.string().max(2000).optional()
  })
  .refine((data) => data.category !== 'seed' || (!!data.pluginId && data.pluginId.length > 0), {
    message: 'seed items require a non-empty pluginId',
    path: ['pluginId']
  });

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const foreign = rejectForeignRefsIn(event.locals?.locale, [
    'typeId',
    parsed.data.typeId,
    getTaxonomyTerm
  ]);
  if (foreign) return foreign;
  const refused = await checkAnimalStockWrite(parsed.data);
  if (refused) return refused;
  return json({ item: createStockItem(parsed.data) }, { status: 201 });
};
