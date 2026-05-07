/**
 * POST /api/stock/:id/lots — owner receives a new lot for an existing SKU.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getStockItem, IncompatibleUnitError, receiveLot } from '$lib/db/stock';
import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';
import { requireOwner } from '$lib/server/auth';

const schema = z.object({
  receivedQuantity: z.number().positive(),
  unit: z.enum(ALL_STOCK_UNITS as unknown as [StockUnit, ...StockUnit[]]),
  lotNumber: z.string().max(80).optional(),
  expiresAt: z.number().int().optional(),
  supplier: z.string().max(120).optional(),
  receivedCostCents: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  if (!event.params.id || !getStockItem(event.params.id)) {
    return json({ error: 'unknown stock item' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const lot = receiveLot({
      stockItemId: event.params.id,
      ...parsed.data,
      performedById: user.id
    });
    return json({ lot }, { status: 201 });
  } catch (e) {
    if (e instanceof IncompatibleUnitError) {
      return json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
};
