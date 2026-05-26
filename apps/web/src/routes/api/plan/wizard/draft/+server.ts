/**
 * Sprint 3 (#173) — wizard "Save & resume later" endpoint.
 *
 * - POST /api/plan/wizard/draft  → upsert the draft for the active plan
 * - GET  /api/plan/wizard/draft  → fetch the active plan's draft (or null)
 * - DELETE /api/plan/wizard/draft → discard the draft (called on commit or
 *   on explicit "Discard saved progress")
 *
 * planId defaults to `season-${currentYear}` to match plan_revisions /
 * wizardSessions conventions. Callers may pass an override but the wizard
 * always uses the default.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { deleteDraft, draftPayloadSchema, getDraft, saveDraft } from '$lib/wizard/drafts';

const saveSchema = z.object({
  planId: z.string().min(1).optional(),
  step: z.string().min(1),
  payload: draftPayloadSchema
});

function activePlanId(override: string | undefined): string {
  if (override && override.length > 0) return override;
  return `season-${new Date().getUTCFullYear()}`;
}

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });
  if (!canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }

  const planId = activePlanId(parsed.data.planId);
  const draft = saveDraft({
    planId,
    step: parsed.data.step,
    payload: parsed.data.payload,
    createdByUserId: auth.id
  });
  return json({ draft });
};

export const GET: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });
  const planId = activePlanId(event.url.searchParams.get('planId') ?? undefined);
  const draft = getDraft(planId);
  return json({ draft });
};

export const DELETE: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });
  if (!canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const planId = activePlanId(event.url.searchParams.get('planId') ?? undefined);
  const deleted = deleteDraft(planId);
  return json({ deleted });
};
