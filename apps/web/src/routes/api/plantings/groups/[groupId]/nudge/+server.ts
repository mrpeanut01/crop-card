import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { listGroupMembers, nudgeCompanionPlanting } from '$lib/db/crops';
import { completeTask, getTask } from '$lib/db/tasks';
import { requireOwner } from '$lib/server/auth';
import { t } from '$lib/i18n';

const nudgeSchema = z.object({
  companionCropId: z.string().min(1),
  deltaDays: z
    .number()
    .int()
    .min(-30)
    .max(30)
    .refine((v) => v !== 0, {
      message: 'deltaDays must be non-zero'
    }),
  /** Optional: complete the companion-check task in the same call. */
  completeCheckTaskId: z.string().min(1).optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const groupId = event.params.groupId;
  if (!groupId)
    return json({ error: t(event.locals?.locale, 'api.errB.missingGroupId') }, { status: 400 });

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = nudgeSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const members = listGroupMembers(groupId);
  if (members.length === 0)
    return json({ error: t(event.locals?.locale, 'api.errB.unknownGroup') }, { status: 404 });
  if (!members.some((m) => m.id === parsed.data.companionCropId && m.groupRole === 'companion')) {
    return json({ error: t(event.locals?.locale, 'api.errB.notCompanion') }, { status: 400 });
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
