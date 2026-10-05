/**
 * PATCH  /api/stock/:id/lots/:lotId — owner moves an ordered or planned lot
 *        between those states, or marks it received (on hand).
 * DELETE /api/stock/:id/lots/:lotId — owner drops a single lot + its movements.
 */

import { t } from '$lib/i18n';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteStockLotCascade } from '$lib/db/admin';
import {
  listLotsForItem,
  LotStatusError,
  QUANTITY_STATUSES,
  setLotQuantityStatus
} from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';

const patchSchema = z.object({
  quantityStatus: z.enum(QUANTITY_STATUSES),
  receivedQuantity: z.number().positive().optional()
});

export const PATCH: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const { id, lotId } = event.params;
  if (!id || !lotId) throw error(400, 'lotId required');
  if (!listLotsForItem(id).some((l) => l.id === lotId)) {
    return json({ error: t(event.locals?.locale, 'stockui.api.lotNotFound') }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const lot = setLotQuantityStatus({ lotId, ...parsed.data, performedById: user.id });
    return json({ lot });
  } catch (e) {
    if (e instanceof LotStatusError) return json({ error: e.message }, { status: 409 });
    throw e;
  }
};

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const { id, lotId } = event.params;
  if (!id || !lotId) throw error(400, 'lotId required');
  if (!listLotsForItem(id).some((l) => l.id === lotId)) {
    return json({ error: t(event.locals?.locale, 'stockui.api.lotNotFound') }, { status: 404 });
  }
  return json(deleteStockLotCascade(lotId));
};
