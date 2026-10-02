/**
 * Phase 33C (M-47, M-49). The owner dismisses one spread's carryover line
 * with a reason; deleting the dismissal brings the line back. GET: every
 * role. The facts behind the line stay on file either way.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { insertDismissal, listDismissals } from '$lib/db/amendments';
import { getFertilityApplication } from '$lib/db/fertility';
import { requireOwner, requireUser } from '$lib/server/auth';
import { invalidBody } from '$lib/organic/access.server';
import { dismissalCreateSchema } from '$lib/amendments/apiSchemas';
import { readJson, refusal, localIssues } from '$lib/server/amendmentRoutes';
import { t } from '$lib/i18n';

export const _requestSchema = dismissalCreateSchema;

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const blockId = event.url.searchParams.get('blockId') ?? undefined;
  return json({ dismissals: listDismissals({ blockId }) });
};

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const body = await readJson(event.request);
  if (body instanceof Response) return body;
  const parsed = dismissalCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(localIssues(parsed.error.issues, event.locals?.locale));
  const input = parsed.data;
  const application = getFertilityApplication(input.fertilityApplicationId);
  if (!application) return json({ error: 'unknown fertilityApplicationId' }, { status: 400 });
  if (application.blockId !== input.blockId) {
    return refusal(400, 'BLOCK_MISMATCH', t(event.locals?.locale, 'amend.api.blockMismatch'));
  }
  if (!application.amendmentBatchId) {
    return refusal(400, 'NOT_A_SPREAD', t(event.locals?.locale, 'amend.api.notSpread'));
  }
  if (
    listDismissals({ blockId: input.blockId }).some(
      (d) => d.fertilityApplicationId === application.id
    )
  ) {
    return refusal(409, 'ALREADY_DISMISSED', t(event.locals?.locale, 'amend.api.alreadyDismissed'));
  }
  const dismissal = insertDismissal({
    fertilityApplicationId: application.id,
    blockId: application.blockId,
    reason: input.reason,
    createdBy: user.id
  });
  return json({ dismissal }, { status: 201 });
};
