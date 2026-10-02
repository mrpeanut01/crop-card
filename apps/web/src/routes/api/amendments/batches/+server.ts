/**
 * Phase 33C amendment batches (M-36, M-40). GET: every role, each batch with
 * its carryover state computed on read. POST: owner, helper and custom
 * operator. Never gated by the season close-out; online only; free.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { insertBatch } from '$lib/db/amendments';
import { requireMutator, requireUser } from '$lib/server/auth';
import { invalidBody } from '$lib/organic/access.server';
import { batchCreateSchema } from '$lib/amendments/apiSchemas';
import { loadCarryoverData } from '$lib/server/amendmentChain';
import { batchView, checkDay, dayContext, readJson } from '$lib/server/amendmentRoutes';

export const _requestSchema = batchCreateSchema;

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const data = await loadCarryoverData();
  const { timeZone } = dayContext();
  return json({ batches: data.batches.map((b) => batchView(data, b, timeZone)) });
};

export const POST: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const body = await readJson(event.request);
  if (body instanceof Response) return body;
  const parsed = batchCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;
  const ctx = dayContext();
  const started = checkDay(ctx, input.startedOn, 'startedOn');
  if ('response' in started) return started.response;
  const batch = insertBatch({
    kind: input.kind,
    name: input.name,
    origin: input.origin,
    supplier: input.supplier ?? null,
    supplierStatement: input.supplierStatement ?? null,
    startedAt: ctx.startOf(started.day),
    notes: input.notes ?? null,
    createdBy: user.id
  });
  const data = await loadCarryoverData();
  return json({ batch: batchView(data, batch, ctx.timeZone) }, { status: 201 });
};
