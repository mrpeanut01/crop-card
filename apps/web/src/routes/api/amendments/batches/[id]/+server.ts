/**
 * Phase 33C (M-36): rename, note, close or reopen a batch, and for a bought
 * load change the supplier and what the supplier said. Owner, helper and
 * custom operator. There is no batch delete.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getBatch, updateBatch, type BatchPatch } from '$lib/db/amendments';
import { requireMutator, requireUser } from '$lib/server/auth';
import { invalidBody } from '$lib/organic/access.server';
import { batchPatchSchema } from '$lib/amendments/apiSchemas';
import { loadCarryoverData } from '$lib/server/amendmentChain';
import { batchView, checkDay, dayContext, readJson, refusal } from '$lib/server/amendmentRoutes';

export const _requestSchema = batchPatchSchema;

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const batch = getBatch(event.params.id ?? '');
  if (!batch) return refusal(404, 'NOT_FOUND', 'That batch is not on file.');
  const data = await loadCarryoverData();
  return json({ batch: batchView(data, batch, dayContext().timeZone) });
};

export const PATCH: RequestHandler = async (event) => {
  requireMutator(event);
  const batch = getBatch(event.params.id ?? '');
  if (!batch) return refusal(404, 'NOT_FOUND', 'That batch is not on file.');
  const body = await readJson(event.request);
  if (body instanceof Response) return body;
  const parsed = batchPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;
  if (
    batch.origin !== 'bought' &&
    (input.supplier !== undefined || input.supplierStatement !== undefined)
  ) {
    return refusal(400, 'NOT_BOUGHT', 'Only a bought load has a supplier.');
  }
  const ctx = dayContext();
  const patch: BatchPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  if (input.supplier !== undefined) patch.supplier = input.supplier ?? null;
  if (input.supplierStatement !== undefined) patch.supplierStatement = input.supplierStatement;
  if (input.closedOn !== undefined) {
    if (input.closedOn === null) patch.closedAt = null;
    else {
      const closed = checkDay(ctx, input.closedOn, 'closedOn');
      if ('response' in closed) return closed.response;
      const closedAt = ctx.endOf(closed.day);
      if (closedAt <= batch.startedAt) {
        return refusal(400, 'BAD_RANGE', 'A batch cannot close before it started.');
      }
      patch.closedAt = closedAt;
    }
  }
  const saved = updateBatch(batch.id, patch);
  if (!saved) return refusal(404, 'NOT_FOUND', 'That batch is not on file.');
  const data = await loadCarryoverData();
  return json({ batch: batchView(data, saved, ctx.timeZone) });
};
