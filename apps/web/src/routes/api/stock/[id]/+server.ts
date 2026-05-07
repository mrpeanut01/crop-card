import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteStockItemCascade } from '$lib/db/admin';
import { getStockItem, listLotsForItem, listMovementsForItem } from '$lib/db/stock';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

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
