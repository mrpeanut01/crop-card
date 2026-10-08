import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { insertFertilityApplication, listFertilityApplicationsForBlock } from '$lib/db/fertility';
import { decrementForUse, getStockItem, IncompatibleUnitError } from '$lib/db/stock';
import { appliedAmount, rateBaseUnit } from '$lib/fertility/applicationMath';
import { formatStockQuantity, stockUnitLabel } from '$lib/stock/units';
import type { FertilityApplication } from '$lib/db/fertility';
import { ensureSystemUser, memberNamesByIds } from '$lib/db/users';
import { currentUser, requireOwner } from '$lib/server/auth';
import { assertAmendmentBatch, rejectForeignRefsIn } from '$lib/server/foreignRefs';
import { fertilityApplicationCreateSchema } from '$lib/fertility/apiSchemas';
import { bestEffort, writeRecord } from '$lib/server/recordWrite';
import { closeTaskForRecord } from '$lib/server/recordTaskClose';
import { decideSpread } from '$lib/server/spreadCarryover';
import type { CarryoverAck } from '$lib/amendments/spreadPrompt';

export const _requestSchema = fertilityApplicationCreateSchema;
const inputSchema = fertilityApplicationCreateSchema;
const FUTURE_SLACK_MS = 5 * 60_000;

export interface FertilityStockDraw {
  stockItemId: string;
  drawn: number;
  unit: string | null;
  shortfall: number;
  notes: string[];
}

/** #763: take rate x block acres off the item's on-hand lots, inside the
 *  application's transaction. A draw that can't be worked out or comes up
 *  short never refuses the record; it says why instead. */
function drawStock(
  app: FertilityApplication,
  performedById: string,
  locale: string | null | undefined
): FertilityStockDraw | null {
  if (!app.stockItemId) return null;
  const item = getStockItem(app.stockItemId);
  if (!item) return null;
  const out: FertilityStockDraw = {
    stockItemId: item.id,
    drawn: 0,
    unit: item.defaultUnit,
    shortfall: 0,
    notes: []
  };
  const name = item.displayName;
  if (!rateBaseUnit(app.rateUnit)) {
    out.notes.push(t(locale, 'fert.stock.unitNotStock', { item: name }));
    return out;
  }
  const amount = appliedAmount(app.ratePerAcre, app.rateUnit, getBlock(app.blockId)?.acres);
  if (!amount) {
    out.notes.push(t(locale, 'fert.stock.noSize', { item: name }));
    return out;
  }
  const dec = bestEffort(() =>
    decrementForUse({
      stockItemId: item.id,
      amount: amount.amount,
      unit: amount.unit,
      fertilityApplicationId: app.id,
      reason: 'fertility-application',
      cropId: app.cropId,
      performedById,
      occurredAt: app.occurredAt
    })
  );
  if (!dec.ok) {
    out.notes.push(
      dec.error instanceof IncompatibleUnitError
        ? t(locale, 'fert.stock.unitMismatch', {
            item: name,
            unit: stockUnitLabel(item.defaultUnit, item.category, locale)
          })
        : t(locale, 'fert.stock.failed', { item: name })
    );
    return out;
  }
  const qty = (n: number) =>
    formatStockQuantity(n, item.defaultUnit, { units: 'us', locale: locale ?? undefined });
  out.drawn = dec.value.fulfilled;
  out.shortfall = dec.value.shortfall;
  out.notes.push(t(locale, 'fert.stock.drawn', { amount: qty(out.drawn), item: name }));
  if (out.shortfall > 0) {
    out.notes.push(t(locale, 'fert.stock.short', { item: name, amount: qty(out.shortfall) }));
  }
  return out;
}

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const auth = currentUser(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
      { status: 400 }
    );
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const foreign = rejectForeignRefsIn(
    event.locals?.locale,
    ['blockId', parsed.data.blockId, getBlock],
    ['cropId', parsed.data.cropId, getCrop],
    ['stockItemId', parsed.data.stockItemId, getStockItem],
    assertAmendmentBatch('amendmentBatchId', parsed.data.amendmentBatchId)
  );
  if (foreign) return foreign;
  const performer = auth ?? (await ensureSystemUser());
  const occurredAt = parsed.data.occurredAt ?? Date.now();
  if (occurredAt > Date.now() + FUTURE_SLACK_MS) {
    return json(
      { error: t(event.locals?.locale, 'fert.err.future'), code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  const { confirmCarryover, ...fields } = parsed.data;
  let carryoverAck: CarryoverAck | null = null;
  if (fields.amendmentBatchId) {
    const decision = await decideSpread({
      blockId: fields.blockId,
      batchId: fields.amendmentBatchId,
      confirm: confirmCarryover,
      locale: event.locals?.locale
    });
    if (decision.kind === 'confirm') return json(decision.body, { status: 409 });
    if (decision.kind === 'confirmed') {
      carryoverAck = {
        ...decision.ack,
        confirmedById: performer.id,
        confirmedByName: memberNamesByIds([performer.id]).get(performer.id) ?? 'Someone',
        confirmedAt: Date.now()
      };
    }
  }
  const { persisted, taskClose, stock } = writeRecord(event, () => {
    const persisted = insertFertilityApplication({
      ...fields,
      occurredAt,
      performedById: performer.id,
      carryoverAckJson: carryoverAck ? JSON.stringify(carryoverAck) : undefined
    });
    const stock = drawStock(persisted, performer.id, event.locals?.locale);
    const taskClose = closeTaskForRecord({
      taskId: parsed.data.taskId,
      record: { blockId: fields.blockId, cropId: fields.cropId },
      eventTable: 'fertility_application',
      eventId: persisted.id,
      occurredAt
    });
    return { persisted, taskClose, stock };
  });
  return json({ application: persisted, carryoverAck, taskClose, stock }, { status: 201 });
};

export const GET: RequestHandler = ({ url, locals }) => {
  const blockId = url.searchParams.get('blockId');
  if (!blockId)
    return json({ error: t(locals?.locale, 'api.err.blockIdRequired') }, { status: 400 });
  return json({ applications: listFertilityApplicationsForBlock(blockId) });
};
