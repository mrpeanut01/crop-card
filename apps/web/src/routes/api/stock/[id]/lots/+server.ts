/**
 * POST /api/stock/:id/lots — owner receives a new lot for an existing SKU,
 * or records one that is ordered or planned (#475; not on hand yet).
 */

import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getStockItem, IncompatibleUnitError, QUANTITY_STATUSES, receiveLot } from '$lib/db/stock';
import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';
import { requireOwner } from '$lib/server/auth';

const schema = z.object({
  receivedQuantity: z.number().positive(),
  unit: z.enum(ALL_STOCK_UNITS as unknown as [StockUnit, ...StockUnit[]]),
  lotNumber: z.string().max(80).optional(),
  expiresAt: z.number().int().optional(),
  supplier: z.string().max(120).optional(),
  receivedCostCents: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
  quantityStatus: z.enum(QUANTITY_STATUSES).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  if (!event.params.id || !getStockItem(event.params.id)) {
    return json({ error: t(event.locals?.locale, 'stockui.api.unknownItem') }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
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
