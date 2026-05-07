/**
 * GET  /api/stock        — all SKUs with on-hand balance + low-stock flag
 * POST /api/stock        — owner-only; create a new SKU
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createStockItem, listStockItems, type StockCategory } from '$lib/db/stock';
import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';
import { requireOwner } from '$lib/server/auth';

const CATEGORIES: StockCategory[] = [
  'herbicide',
  'insecticide',
  'fungicide',
  'fertilizer',
  'seed',
  'adjuvant',
  'fuel',
  'part'
];

export const GET: RequestHandler = () => {
  return json({ items: listStockItems() });
};

const createSchema = z.object({
  category: z.enum(CATEGORIES as [StockCategory, ...StockCategory[]]),
  displayName: z.string().min(1).max(120),
  defaultUnit: z.enum(ALL_STOCK_UNITS as unknown as [StockUnit, ...StockUnit[]]),
  pluginId: z.string().optional(),
  reorderThreshold: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  return json({ item: createStockItem(parsed.data) }, { status: 201 });
};
