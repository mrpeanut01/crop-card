import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { insertFertilityApplication, listFertilityApplicationsForBlock } from '$lib/db/fertility';
import { getStockItem } from '$lib/db/stock';
import { ensureSystemUser, memberNamesByIds } from '$lib/db/users';
import { currentUser, requireOwner } from '$lib/server/auth';
import { assertAmendmentBatch, rejectForeignRefs } from '$lib/server/foreignRefs';
import { fertilityApplicationCreateSchema } from '$lib/fertility/apiSchemas';
import { writeRecord } from '$lib/server/recordWrite';
import { closeTaskForRecord } from '$lib/server/recordTaskClose';
import { decideSpread } from '$lib/server/spreadCarryover';
import type { CarryoverAck } from '$lib/amendments/spreadPrompt';

export const _requestSchema = fertilityApplicationCreateSchema;
const inputSchema = fertilityApplicationCreateSchema;

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const auth = currentUser(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const foreign = rejectForeignRefs(
    ['blockId', parsed.data.blockId, getBlock],
    ['cropId', parsed.data.cropId, getCrop],
    ['stockItemId', parsed.data.stockItemId, getStockItem],
    assertAmendmentBatch('amendmentBatchId', parsed.data.amendmentBatchId)
  );
  if (foreign) return foreign;
  const performer = auth ?? (await ensureSystemUser());
  const occurredAt = parsed.data.occurredAt ?? Date.now();
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
  const { persisted, taskClose } = writeRecord(event, () => {
    const persisted = insertFertilityApplication({
      ...fields,
      occurredAt,
      performedById: performer.id,
      carryoverAckJson: carryoverAck ? JSON.stringify(carryoverAck) : undefined
    });
    const taskClose = closeTaskForRecord({
      taskId: parsed.data.taskId,
      record: { blockId: fields.blockId, cropId: fields.cropId },
      eventTable: 'fertility_application',
      eventId: persisted.id,
      occurredAt
    });
    return { persisted, taskClose };
  });
  return json({ application: persisted, carryoverAck, taskClose }, { status: 201 });
};

export const GET: RequestHandler = ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  if (!blockId) return json({ error: 'blockId required' }, { status: 400 });
  return json({ applications: listFertilityApplicationsForBlock(blockId) });
};
