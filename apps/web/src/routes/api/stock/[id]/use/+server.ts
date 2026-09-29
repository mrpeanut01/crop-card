import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { decrementForUse, getStockItem, getStockItemWithBalance } from '$lib/db/stock';
import { feedUseAmount, feedUseNote, isFeedCategory } from '$lib/stock/animalStock';
import { feedUseSchema } from '$lib/stock/apiSchemas';
import { parseBody, unknownSubjectMessage } from '$lib/server/animals';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { assertAnimalSubject, firstUnknownRef } from '$lib/server/foreignRefs';
import { writeRecord } from '$lib/server/recordWrite';

export const _requestSchema = feedUseSchema;

/**
 * Owners and helpers take feed or bedding off stock in pounds (Phase 32D,
 * D0-12). Only the feed and bedding categories; the movement reason is
 * `animal-feed` and the animal or group it went to rides in the movement
 * notes. Replayable from the offline queue. The owner-only
 * /api/stock/movements is untouched.
 */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const id = event.params.id ?? '';
  const item = getStockItem(id);
  if (!item) return json({ error: 'not found' }, { status: 404 });
  if (!isFeedCategory(item.category)) {
    return json(
      { error: 'Only feed and bedding can be used here.', code: 'NOT_FEED' },
      { status: 400 }
    );
  }
  const body = await parseBody(event.request, feedUseSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  if (firstUnknownRef(assertAnimalSubject('subjectId', input.subjectType, input.subjectId))) {
    return json({ error: unknownSubjectMessage, code: 'UNKNOWN_SUBJECT' }, { status: 400 });
  }
  const now = Date.now();
  const occurredAt = input.occurredAt ?? now;
  if (occurredAt > now + MAX_FUTURE_SKEW_MS) {
    return json(
      { error: 'A feed use cannot be dated in the future.', code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  const amount = feedUseAmount(item, input.lb);
  if (!amount.ok) return json({ error: amount.message, code: amount.code }, { status: 409 });

  const subject =
    input.subjectType && input.subjectId ? { type: input.subjectType, id: input.subjectId } : null;
  const result = writeRecord(event, () =>
    decrementForUse({
      stockItemId: item.id,
      amount: amount.amount,
      unit: amount.unit,
      reason: 'animal-feed',
      performedById: user.id,
      occurredAt,
      notes: feedUseNote(subject)
    })
  );
  const warnings =
    result.shortfall > 0
      ? [
          {
            code: 'STOCK_SHORT',
            message: `Only part of that was on hand. Count what is left and fix it on the item page.`
          }
        ]
      : [];
  return json(
    {
      used: { lb: input.lb, amount: amount.amount, unit: amount.unit },
      shortfall: result.shortfall,
      onHand: getStockItemWithBalance(item.id)?.onHand ?? 0,
      warnings
    },
    { status: 201 }
  );
});
