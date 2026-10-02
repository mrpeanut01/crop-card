/**
 * POST /api/tasks/:id/time: save time from the task timer (D-25),
 * replayable from the offline queue as `time-entry`.
 * GET  /api/tasks/:id/time: the time saved on this task (D-26). Owners see
 * every entry with the person's name; everyone else sees the farm total and
 * only their own entries.
 *
 * Phase 33D (D2). Time is not a record the season close-out gates, so
 * neither handler reads `SEASON_CLOSED`.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { taskTimeEntrySchema } from '$lib/tasks/apiSchemas';
import { getTask } from '$lib/db/tasks';
import {
  insertTimeEntry,
  listTimeEntriesForTask,
  placeOfTask,
  type TimeEntryRow
} from '$lib/db/taskTime';
import { memberNamesByIds } from '$lib/db/users';
import { totalMinutes } from '$lib/labour/hours';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { currentUser, type AuthenticatedUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { canAssignTasks } from '$lib/server/taskAssign';
import { assertAssignableUser, firstUnknownRef } from '$lib/server/foreignRefs';
import { hasClientRecordId, withClientRecordId } from '$lib/server/clientRecordId';
import { writeRecord } from '$lib/server/recordWrite';
import {
  timeDeleteVerdict,
  timeEntryInRange,
  type TaskTimeEntryView
} from '$lib/tasks/timeEntries';

export const _requestSchema = taskTimeEntrySchema;

function problem(status: number, error: string, message: string, extra = {}): Response {
  return json({ error, message, ...extra }, { status });
}

function present(
  row: TimeEntryRow,
  user: Pick<AuthenticatedUser, 'id' | 'role'>,
  now: number,
  name?: string
): TaskTimeEntryView {
  return {
    id: row.id,
    userId: row.userId,
    ...(name !== undefined ? { name } : {}),
    startedAt: row.startedAt,
    minutes: row.minutes,
    source: row.source,
    note: row.note,
    createdAt: row.createdAt,
    canDelete: timeDeleteVerdict(row, user, now) === 'ok'
  };
}

export const GET: RequestHandler = (event) => {
  const loc = event.locals.locale;
  const user = currentUser(event);
  if (!user?.activeOwnerId) return problem(401, 'UNAUTHENTICATED', t(loc, 'tasks.timeApi.signIn'));
  const task = getTask(event.params.id ?? '');
  if (!task) return problem(404, 'NOT_FOUND', t(loc, 'tasks.timeApi.noTask'));
  const rows = listTimeEntriesForTask(task.id);
  const now = Date.now();
  const owner = user.role === 'owner';
  const names = owner ? memberNamesByIds(rows.flatMap((r) => (r.userId ? [r.userId] : []))) : null;
  const entries = rows
    .filter((r) => owner || r.userId === user.id)
    .map((r) =>
      present(
        r,
        user,
        now,
        names
          ? ((r.userId && names.get(r.userId)) ?? t(loc, 'tasks.timeApi.formerMember'))
          : undefined
      )
    );
  return json({ totalMinutes: totalMinutes(rows), entries });
};

export const POST: RequestHandler = withClientRecordId(async (event) => {
  const loc = event.locals.locale;
  const user = currentUser(event);
  if (!user?.activeOwnerId) return problem(401, 'UNAUTHENTICATED', t(loc, 'tasks.timeApi.signIn'));
  if (!canMutate(user.role)) {
    return problem(403, 'READ_ONLY', t(loc, 'tasks.timeApi.readOnly'));
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return problem(400, 'INVALID_BODY', t(loc, 'tasks.timeApi.notJson'));
  }
  const parsed = taskTimeEntrySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'INVALID_BODY',
        message: parsed.error.issues[0]?.message ?? t(loc, 'tasks.timeApi.checkFields'),
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const forUser = input.userId ?? user.id;
  if (forUser !== user.id) {
    if (!canAssignTasks(user)) {
      return problem(403, 'OWNER_ONLY', t(loc, 'tasks.timeApi.ownerOnly'), {
        askOwner: true
      });
    }
    const unknown = firstUnknownRef(assertAssignableUser('userId', forUser));
    if (unknown) {
      return problem(400, 'FOREIGN_REF', t(loc, 'tasks.timeApi.notOnFarm'), { field: unknown });
    }
  }
  const task = getTask(event.params.id ?? '');
  if (!task) return problem(404, 'NOT_FOUND', t(loc, 'tasks.timeApi.noTask'));
  const now = Date.now();
  if (!timeEntryInRange(input.startedAt, input.minutes, now)) {
    return problem(400, 'TIME_OUT_OF_RANGE', t(loc, 'tasks.timeApi.outOfRange'));
  }
  const clientRecordId = hasClientRecordId(event.request)
    ? event.request.headers.get(CLIENT_RECORD_HEADER)
    : null;
  const place = placeOfTask(task);
  const saved = writeRecord(event, () =>
    insertTimeEntry({
      taskId: task.id,
      userId: forUser,
      cropId: task.cropId ?? null,
      blockId: place.blockId,
      fieldId: place.fieldId,
      startedAt: input.startedAt,
      minutes: input.minutes,
      source: 'timer',
      note: input.note?.trim() || null,
      clientRecordId
    })
  );
  return json({ entry: present(saved, user, now) }, { status: 201 });
});
