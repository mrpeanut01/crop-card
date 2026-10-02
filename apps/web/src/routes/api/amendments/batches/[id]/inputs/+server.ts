/**
 * Phase 33C (M-34 to M-38): add what went into a batch. Owner, helper and
 * custom operator. An animal or group carries its collection window; a
 * batch or stock lot only the day it went in.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import {
  findBatchInput,
  getAmendmentLot,
  getBatch,
  insertBatchInput,
  listBatchInputs
} from '$lib/db/amendments';
import { requireMutator } from '$lib/server/auth';
import { invalidBody } from '$lib/organic/access.server';
import { batchInputCreateSchema } from '$lib/amendments/apiSchemas';
import { batchReaches } from '$lib/amendments/carryover';
import { AMENDMENT_LOT_CATEGORIES } from '$lib/amendments/model';
import { assertAnimalSubject, rejectForeignRefs } from '$lib/server/foreignRefs';
import { loadCarryoverData } from '$lib/server/amendmentChain';
import { batchView, checkDay, dayContext, readJson, refusal } from '$lib/server/amendmentRoutes';

export const _requestSchema = batchInputCreateSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const batch = getBatch(event.params.id ?? '');
  if (!batch) return refusal(404, 'NOT_FOUND', 'That batch is not on file.');
  const body = await readJson(event.request);
  if (body instanceof Response) return body;
  const parsed = batchInputCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;

  if (batch.origin === 'bought') {
    return refusal(
      409,
      'BOUGHT_BATCH_NO_INPUTS',
      'A bought load takes no inputs. To mix it into a home pile, add it as an input of that pile.'
    );
  }
  if (batch.closedAt !== null) {
    return refusal(409, 'BATCH_CLOSED', 'This batch is closed. Reopen it to add more.');
  }

  if (input.inputType === 'animal' || input.inputType === 'group') {
    const bad = rejectForeignRefs(assertAnimalSubject('inputId', input.inputType, input.inputId));
    if (bad) return bad;
  } else if (input.inputType === 'batch') {
    if (!getBatch(input.inputId)) return json({ error: 'unknown inputId' }, { status: 400 });
    if (batchReaches(listBatchInputs(), input.inputId, batch.id)) {
      return refusal(
        409,
        'BATCH_CYCLE',
        'That batch already contains this one, so it cannot also go into it.'
      );
    }
  } else {
    const lot = getAmendmentLot(input.inputId);
    if (!lot) return json({ error: 'unknown inputId' }, { status: 400 });
    if (!(AMENDMENT_LOT_CATEGORIES as readonly string[]).includes(lot.category)) {
      return refusal(
        400,
        'NOT_AMENDMENT_LOT',
        'Only feed, bedding and fertilizer lots can go into a manure or compost batch.'
      );
    }
  }

  const ctx = dayContext();
  const from = checkDay(ctx, input.from, 'from');
  if ('response' in from) return from.response;
  let toAt: number | null = null;
  if (input.to) {
    const to = checkDay(ctx, input.to, 'to');
    if ('response' in to) return to.response;
    if (input.to < input.from) {
      return refusal(400, 'BAD_RANGE', 'The last day comes before the first day.');
    }
    toAt = ctx.endOf(to.day);
  }
  const key = {
    batchId: batch.id,
    inputType: input.inputType,
    inputId: input.inputId,
    fromAt: ctx.startOf(from.day)
  };
  if (findBatchInput(key)) {
    return refusal(409, 'INPUT_EXISTS', 'That was already added to this batch on that day.');
  }
  const saved = insertBatchInput({
    ...key,
    toAt,
    supplierStatement: input.inputType === 'stock-lot' ? (input.supplierStatement ?? null) : null,
    createdBy: user.id
  });
  if (!saved) {
    return refusal(409, 'INPUT_EXISTS', 'That was already added to this batch on that day.');
  }
  const data = await loadCarryoverData();
  return json({ input: saved, batch: batchView(data, batch, ctx.timeZone) }, { status: 201 });
};
