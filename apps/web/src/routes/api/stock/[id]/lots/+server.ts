/**
 * POST /api/stock/:id/lots — owner receives a new lot for an existing SKU,
 * or records one that is ordered or planned (#475; not on hand yet).
 */

import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { getStockItem, IncompatibleUnitError, receiveLot } from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';
import { stockLotCreateSchema } from '$lib/stock/apiSchemas';
import { HAY_LOT_CATEGORIES } from '$lib/amendments/model';
import { assertHayCutting, rejectForeignRefs } from '$lib/server/foreignRefs';

export const _requestSchema = stockLotCreateSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const item = event.params.id ? getStockItem(event.params.id) : undefined;
  if (!item) {
    return json({ error: t(event.locals?.locale, 'stockui.api.unknownItem') }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = stockLotCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  if (parsed.data.sourceHayCuttingId) {
    if (!(HAY_LOT_CATEGORIES as readonly string[]).includes(item.category)) {
      return json(
        {
          error: 'NOT_FEED_LOT',
          message: t(event.locals?.locale, 'api.errB.notFeedLot')
        },
        { status: 400 }
      );
    }
    const bad = rejectForeignRefs(
      assertHayCutting('sourceHayCuttingId', parsed.data.sourceHayCuttingId)
    );
    if (bad) return bad;
  }
  try {
    const lot = receiveLot({
      stockItemId: item.id,
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
