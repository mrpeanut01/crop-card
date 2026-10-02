/**
 * Phase 33C pea or bean tests (M-48, M-49). POST: owner, helper and custom
 * operator record a test of a batch or a block. GET: every role. A test is
 * a fact the person reports; it never clears a block on its own.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { insertBioassay, listBioassays } from '$lib/db/amendments';
import { requireMutator, requireUser } from '$lib/server/auth';
import { invalidBody } from '$lib/organic/access.server';
import { bioassayCreateSchema } from '$lib/amendments/apiSchemas';
import { assertAmendmentBatch, assertBlock, rejectForeignRefs } from '$lib/server/foreignRefs';
import { checkDay, dayContext, readJson } from '$lib/server/amendmentRoutes';

export const _requestSchema = bioassayCreateSchema;

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const blockId = event.url.searchParams.get('blockId') ?? undefined;
  const batchId = event.url.searchParams.get('batchId') ?? undefined;
  return json({ bioassays: listBioassays({ blockId, batchId }) });
};

export const POST: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const body = await readJson(event.request);
  if (body instanceof Response) return body;
  const parsed = bioassayCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;
  const foreign = rejectForeignRefs(
    assertAmendmentBatch('batchId', input.batchId),
    assertBlock('blockId', input.blockId)
  );
  if (foreign) return foreign;
  const ctx = dayContext();
  const tested = checkDay(ctx, input.testedOn, 'testedOn');
  if ('response' in tested) return tested.response;
  const bioassay = insertBioassay({
    batchId: input.batchId ?? null,
    blockId: input.blockId ?? null,
    testedAt: ctx.startOf(tested.day),
    result: input.result,
    note: input.note ?? null,
    createdBy: user.id
  });
  return json({ bioassay }, { status: 201 });
};
