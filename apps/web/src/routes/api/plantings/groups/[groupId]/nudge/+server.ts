import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { listGroupMembers, nudgeCompanionPlanting } from '$lib/db/crops';
import { completeTask, getTask } from '$lib/db/tasks';
import { requireOwner } from '$lib/server/auth';

const nudgeSchema = z.object({
  companionCropId: z.string().min(1),
  deltaDays: z.number().int().min(-30).max(30).refine((v) => v !== 0, {
    message: 'deltaDays must be non-zero'
  }),
  /** Optional: complete the companion-check task in the same call. */
  completeCheckTaskId: z.string().min(1).optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const groupId = event.params.groupId;
  if (!groupId) return json({ error: 'missing groupId' }, { status: 400 });

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = nudgeSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const members = listGroupMembers(groupId);
  if (members.length === 0) return json({ error: 'unknown group' }, { status: 404 });
  if (!members.some((m) => m.id === parsed.data.companionCropId && m.groupRole === 'companion')) {
    return json({ error: 'crop is not a companion of this group' }, { status: 400 });
  }

  try {
    const result = nudgeCompanionPlanting(parsed.data.companionCropId, parsed.data.deltaDays);

    if (parsed.data.completeCheckTaskId) {
      const t = getTask(parsed.data.completeCheckTaskId);
      if (t && !t.completedAt && !t.abortedAt) {
        completeTask(parsed.data.completeCheckTaskId);
      }
    }

    return json({ groupId, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'nudge failed';
    return json({ error: message }, { status: 400 });
  }
};
