import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteStockItemCascade } from '$lib/db/admin';
import {
  getStockItem,
  listLotsForItem,
  listMovementsForItem,
  updateStockItem,
  type StockCategory
} from '$lib/db/stock';
import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
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

const updateSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  /** Phase 15d — manual override for the Haiku-generated short label.
   *  Pass null to clear and fall back to displayName. */
  shortName: z.string().max(40).nullable().optional(),
  category: z.enum(CATEGORIES as [StockCategory, ...StockCategory[]]).optional(),
  defaultUnit: z.enum(ALL_STOCK_UNITS as unknown as [StockUnit, ...StockUnit[]]).optional(),
  pluginId: z.string().nullable().optional(),
  reorderThreshold: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(500).optional(),
  barcode: z.string().max(100).optional(),
  typeId: z.string().nullable().optional(),
  metadataJson: z.string().optional(),
  /** Phase 17 (Track 2 + AI Refresh) — confirmed active ingredients.
   *  null means "explicitly clear the column" (Discard button). */
  activeIngredientsJson: z.string().max(4000).nullable().optional(),
  /** Phase 17 (Track 2 + AI Refresh) — confirmed formulation block.
   *  null means "explicitly clear the column" (Discard button). */
  formulationJson: z.string().max(2000).nullable().optional()
});

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) return json({ error: 'id required' }, { status: 400 });
  const item = getStockItem(params.id);
  if (!item) return json({ error: 'not found' }, { status: 404 });
  return json({
    item,
    lots: listLotsForItem(params.id),
    movements: listMovementsForItem(params.id, 100)
  });
};

export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  if (!event.params.id) return json({ error: 'id required' }, { status: 400 });
  if (!getStockItem(event.params.id)) return json({ error: 'not found' }, { status: 404 });
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  return json({ item: updateStockItem(event.params.id, parsed.data) });
};

/**
 * DELETE /api/stock/:id
 *
 * Cascade-removes stock_lots + stock_movements for this SKU and nulls
 * out fertility_applications.stockItemId references.
 */
export const DELETE: RequestHandler = (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (!event.params.id) return json({ error: 'id required' }, { status: 400 });
  const item = getStockItem(event.params.id);
  if (!item) return json({ error: 'not found' }, { status: 404 });
  return json(deleteStockItemCascade(event.params.id));
};
