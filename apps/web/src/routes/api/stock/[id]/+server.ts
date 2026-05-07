import { json, type RequestHandler } from '@sveltejs/kit';
import { getStockItem, listLotsForItem, listMovementsForItem } from '$lib/db/stock';

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
